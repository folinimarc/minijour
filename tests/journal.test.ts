import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '@automerge/automerge';
import { createDay, editDay, localDate, markdown } from '../src/domain/day';
import { heads, mergeDocuments } from '../src/domain/documents';
import { Journal } from '../src/domain/journal';
import { LocalStore } from '../src/storage/local';
import { exportJournal, importJournal } from '../src/storage/backup';
import { SyncEngine } from '../src/sync/engine';
import { DropboxFiles } from '../src/sync/dropbox';
import { addDay, MemoryCloud } from './helpers';
import { strFromU8, unzipSync, zipSync } from 'fflate';

const DATE = '2026-10-24';
function saveConnection(journal: Journal, value: { appKey: string; accountId: string }, options = {}) {
  return journal.local.saveCloudConnection({ providerId: 'dropbox', appId: value.appKey, accountId: value.accountId }, value, options);
}

const stores: LocalStore[] = [];
const journals: Journal[] = [];
async function device(name = crypto.randomUUID()) {
  const local = await LocalStore.open(name);
  stores.push(local);
  const journal = new Journal(local, crypto.randomUUID());
  journals.push(journal);
  await journal.load();
  await addDay(journal, DATE);
  return journal;
}
afterEach(() => {
  journals.splice(0).forEach(journal => journal.close());
  stores.splice(0).forEach(store => store.close());
});

describe('Automerge journal model', () => {
  it('stages successive editor versions even when their older views share Automerge internals', async () => {
    const journal = await device();
    const first = editDay(journal.days.get(DATE)!, 'First words.');
    journal.stage(DATE, first);
    const second = editDay(journal.days.get(DATE)!, 'First words. More words.');
    journal.stage(DATE, second);
    expect(journal.days.get(DATE)!.text).toBe('First words. More words.');
    await journal.flush();
    expect((await journal.local.days()).get(DATE)).toBeDefined();
    const stored = A.load<{ text: string }>((await journal.local.days()).get(DATE)!);
    expect(stored.text).toBe('First words. More words.');
  });

  it('holds multiple edits in memory and writes only changed dates when flushed', async () => {
    const journal = await device();
    const save = vi.spyOn(journal.local, 'saveDay');
    journal.stage(DATE, editDay(A.clone(journal.days.get(DATE)!), 'First'));
    journal.stage(DATE, editDay(A.clone(journal.days.get(DATE)!), 'First, then more.'));
    expect(journal.days.get(DATE)!.text).toBe('First, then more.');
    expect(journal.hasUnsavedChanges).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await journal.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(journal.hasUnsavedChanges).toBe(false);
    await journal.flush();
    expect(save).toHaveBeenCalledTimes(1);
    const reopened = new Journal(journal.local, crypto.randomUUID()); journals.push(reopened);
    await reopened.load();
    expect(reopened.days.get(DATE)!.text).toBe('First, then more.');
  });

  it('does not mark edits made during a save as durable until the next batch', async () => {
    const journal = await device();
    const save = journal.local.saveDay.bind(journal.local);
    let finish!: () => void;
    vi.spyOn(journal.local, 'saveDay').mockImplementationOnce(async (date, bytes) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return save(date, bytes);
    });
    journal.stage(DATE, editDay(A.clone(journal.days.get(DATE)!), 'First'));
    const saving = journal.flush();
    journal.stage(DATE, editDay(A.clone(journal.days.get(DATE)!), 'First, then more.'));
    finish(); await saving;
    expect(journal.hasUnsavedChanges).toBe(true);
    expect(journal.days.get(DATE)!.text).toBe('First, then more.');
    const reopened = new Journal(journal.local, crypto.randomUUID()); journals.push(reopened);
    await reopened.load();
    expect(reopened.days.get(DATE)!.text).toBe('First');
    await journal.flush(); await reopened.load();
    expect(reopened.days.get(DATE)!.text).toBe('First, then more.');
    expect(journal.hasUnsavedChanges).toBe(false);
  });

  it('retains failed batches for retry, including newer typing', async () => {
    const journal = await device();
    vi.spyOn(journal.local, 'saveDay').mockRejectedValueOnce(new Error('Storage full'));
    journal.stage(DATE, editDay(A.clone(journal.days.get(DATE)!), 'Keep this.'));
    await expect(journal.flush()).rejects.toThrow('Storage full');
    expect(journal.hasUnsavedChanges).toBe(true);
    journal.stage(DATE, editDay(A.clone(journal.days.get(DATE)!), 'Keep this. And this.'));
    await journal.flush();
    expect(journal.hasUnsavedChanges).toBe(false);
    expect(journal.saveError).toBeUndefined();
    const reopened = new Journal(journal.local, crypto.randomUUID()); journals.push(reopened);
    await reopened.load();
    expect(reopened.days.get(DATE)!.text).toBe('Keep this. And this.');
  });

  it('starts independently created days from identical history', () => {
    expect(heads(createDay(DATE))).toBe(heads(createDay(DATE)));
    expect(heads(createDay('2026-10-25'))).not.toBe(heads(createDay(DATE)));
  });

  it('preserves independent first edits on two offline devices with one date header', () => {
    const phone = editDay(createDay(DATE), 'Saw a fox.\n');
    const laptop = editDay(createDay(DATE), 'A long walk.\n');
    const merged = mergeDocuments(phone, laptop);
    expect(merged.text).toContain('Saw a fox.');
    expect(merged.text).toContain('A long walk.');
    expect(mergeDocuments(laptop, phone).text).toBe(merged.text);
    expect(markdown(new Map([[DATE, merged]])).match(/# 2026-10-24/g)).toHaveLength(1);
  });

  it('uses the device local calendar day', () => {
    expect(localDate(new Date(2026, 9, 24, 0, 5))).toBe(DATE);
    expect(localDate(new Date(2026, 9, 24, 23, 59))).toBe(DATE);
  });

  it('preserves edits from two tabs saving stale copies through one database', async () => {
    const database = crypto.randomUUID();
    const first = await device(database);
    const second = await device(database);
    await Promise.all([first.edit(DATE, 'Phone'), second.edit(DATE, 'Laptop')]);
    const reopened = await device(database);
    expect(reopened.days.get(DATE)!.text).toContain('Phone');
    expect(reopened.days.get(DATE)!.text).toContain('Laptop');
  });

  it('preserves emoji positions in stable photo insertion anchors', () => {
    const doc = editDay(createDay(DATE), 'Hello 🦊 world');
    const cursor = A.getCursor(doc, ['text'], 'Hello 🦊'.length);
    const changed = editDay(A.clone(doc), 'Hi! Hello 🦊 world');
    expect(A.getCursorPosition(changed, ['text'], cursor)).toBe('Hi! Hello 🦊'.length);
  });
});

describe('Dropbox-shaped file sync', () => {
  it('forgets connection and remembered key together, and rejects an unlock finishing after disconnect', async () => {
    const journal = await device();
    await saveConnection(journal, { appKey: 'app', accountId: 'original' });
    await journal.local.rememberVaultKey({ key: 'test-key' });
    await Promise.all([
      journal.local.rememberVaultKey({ key: 'finishing-unlock' }),
      DropboxFiles.disconnect(journal.local),
    ]);
    expect(await journal.local.setting('dropbox-connection')).toBeUndefined();
    expect(await journal.local.setting('cloud-vault-key')).toBeUndefined();
    await expect(journal.local.rememberVaultKey({ key: 'late-key' })).rejects.toThrow('disconnected');
    expect(await journal.local.setting('cloud-vault-key')).toBeUndefined();
  });
  it('retains journal ownership after disconnect and rejects another account before saving its tokens', async () => {
    const journal = await device();
    const original = { appKey: 'app', accountId: 'original' };
    await saveConnection(journal, original);
    await DropboxFiles.disconnect(journal.local);
    await expect(saveConnection(journal, { appKey: 'app', accountId: 'other' })).rejects.toThrow('different cloud provider');
    expect(await journal.local.setting('dropbox-connection')).toBeUndefined();
    // A late token refresh from another tab cannot undo a disconnect.
    await expect(saveConnection(journal, original, { requireExisting: true })).rejects.toThrow('disconnected');
    expect(await journal.local.setting('dropbox-connection')).toBeUndefined();
    await saveConnection(journal, original);
    expect(await journal.local.setting('dropbox-connection')).toEqual(original);
  });

  it('serializes competing Dropbox authorizations and rejects a different app', async () => {
    const fresh = await device();
    const attempts = await Promise.allSettled([
      saveConnection(fresh, { appKey: 'app', accountId: 'first' }),
      saveConnection(fresh, { appKey: 'app', accountId: 'second' }),
    ]);
    expect(attempts.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    await expect(saveConnection(fresh, { appKey: 'other-app', accountId: 'first' })).rejects.toThrow();
  });

  it('merges offline changes and consolidates the converged history', async () => {
    const cloud = new MemoryCloud();
    const phone = await device();
    const laptop = await device();
    const phoneSync = new SyncEngine(phone, cloud);
    const laptopSync = new SyncEngine(laptop, cloud);
    await phone.edit(DATE, 'Morning walk.');
    await phoneSync.sync();
    await laptopSync.sync();
    await phone.edit(DATE, 'Morning walk.\nSaw a fox.');
    await laptop.edit(DATE, 'Long morning walk.');
    await Promise.all([phoneSync.sync(), laptopSync.sync()]);
    await phoneSync.sync();
    await laptopSync.sync();
    expect(phone.days.get(DATE)!.text).toBe(laptop.days.get(DATE)!.text);
    expect(phone.days.get(DATE)!.text).toContain('Long morning walk.');
    expect(phone.days.get(DATE)!.text).toContain('Saw a fox.');
    expect(cloud.files.size).toBe(1);
    const uploads = cloud.uploads;
    await new SyncEngine(phone, cloud).sync();
    expect(cloud.uploads).toBe(uploads); // Opening an app doesn't duplicate all days.
  });

  it('uploads and restores photos before publishing their Markdown references', async () => {
    const cloud = new MemoryCloud();
    const phone = await device();
    const name = `${crypto.randomUUID()}.jpg`;
    await phone.local.savePhoto(name, new Blob(['photo'], { type: 'image/jpeg' }));
    await phone.edit(DATE, `![Photo](photos/${name})`);
    await new SyncEngine(phone, cloud).sync();
    expect([...cloud.files.keys()][0]).toBe(`/photos/${name}`);
    const laptop = await device();
    await new SyncEngine(laptop, cloud).sync();
    expect(await (await laptop.local.photo(name))!.text()).toBe('photo');
    expect(laptop.days.get(DATE)!.text).toContain(name);
  });

  it('keeps offline edits after a failed upload and retries safely', async () => {
    const cloud = new MemoryCloud();
    const phone = await device();
    await phone.edit(DATE, 'Keep this memory.');
    const upload = cloud.upload.bind(cloud);
    cloud.upload = async () => { throw new Error('Network unavailable'); };
    const engine = new SyncEngine(phone, cloud);
    await expect(engine.sync()).rejects.toThrow('Network unavailable');
    expect(phone.days.get(DATE)!.text).toBe('Keep this memory.');
    cloud.upload = upload;
    await engine.sync();
    expect(cloud.files.size).toBe(1);
  });

  it('does not discard typing that happens during a remote download', async () => {
    const cloud = new MemoryCloud();
    const laptop = await device();
    await laptop.edit(DATE, 'Laptop memory.');
    await new SyncEngine(laptop, cloud).sync();
    const phone = await device();
    const download = cloud.download.bind(cloud);
    cloud.download = async path => {
      await phone.edit(DATE, 'Phone memory.');
      return download(path);
    };
    await new SyncEngine(phone, cloud).sync();
    expect(phone.days.get(DATE)!.text).toContain('Laptop memory.');
    expect(phone.days.get(DATE)!.text).toContain('Phone memory.');
  });
});

it('exports a portable backup and restores history, photos, and offline changes', async () => {
  const original = await device();
  await original.edit(DATE, 'Original memory.');
  const name = `${crypto.randomUUID()}.jpg`;
  await original.local.savePhoto(name, new Blob(['photo'], { type: 'image/jpeg' }));
  await original.edit(DATE, `Original memory. ![Photo](photos/${name})`);
  await original.local.setSetting('dropbox-connection', { accessToken: 'DO-NOT-EXPORT' });
  const backup = await exportJournal(original);
  const restored = await device();
  await restored.edit(DATE, 'Another memory.');
  await importJournal(restored, new File([backup], 'journal.zip'));
  expect(restored.days.get(DATE)!.text).toContain('Original memory.');
  expect(restored.days.get(DATE)!.text).toContain('Another memory.');
  expect(await (await restored.local.photo(name))!.text()).toBe('photo');
  expect(await restored.local.setting('dropbox-connection')).toBeUndefined();
});

it('omits blank dates from Markdown while keeping their editing history restorable', async () => {
  const journal = await device();
  await journal.edit(DATE, 'An older entry that was cleared.');
  await journal.edit(DATE, ' \n\t');
  await addDay(journal, '2026-10-25');
  expect(markdown(journal.days)).toBe('');
  const name = `${crypto.randomUUID()}.jpg`;
  await addDay(journal, '2026-10-26');
  await journal.edit('2026-10-26', `![Photo](photos/${name})`);
  const exported = await exportJournal(journal);
  const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
  expect(strFromU8(files['journal.md'])).toBe(`# 2026-10-26\n\n![Photo](photos/${name})\n`);
  expect(files[`minijour/${DATE}.automerge`]).toBeDefined();
  expect(files['minijour/2026-10-25.automerge']).toBeDefined();
  const restored = await device();
  await importJournal(restored, new File([exported], 'blank-history.zip'));
  expect(heads(restored.days.get(DATE)!)).toEqual(heads(journal.days.get(DATE)!));
  expect(restored.days.get(DATE)!.text).toBe(' \n\t');
});

it('exports and restores a journal with no saved dates without creating an empty day', async () => {
  const local = await LocalStore.open(crypto.randomUUID()); stores.push(local);
  const empty = new Journal(local, crypto.randomUUID()); journals.push(empty);
  const backup = await exportJournal(empty);
  const files = unzipSync(new Uint8Array(await backup.arrayBuffer()));
  expect(Object.keys(files).filter(path => path.endsWith('.automerge'))).toEqual([]);
  expect(strFromU8(files['journal.md'])).toBe('');
  expect(JSON.parse(strFromU8(files['minijour/format.json']))).toEqual({ version: 1 });
  await importJournal(empty, new File([backup], 'empty.zip'));
  expect(empty.days.size).toBe(0);
  expect((await local.days()).size).toBe(0);
  const written = await device(); await written.edit(DATE, 'Keep my entry.');
  await importJournal(written, new File([backup], 'empty.zip'));
  expect(written.days.get(DATE)!.text).toBe('Keep my entry.');
});

it('rejects unsupported backup metadata before importing entries', async () => {
  const source = await device(); await source.edit(DATE, 'Do not import this.');
  const files = unzipSync(new Uint8Array(await (await exportJournal(source)).arrayBuffer()));
  files['minijour/format.json'] = new TextEncoder().encode('{"version":99}');
  const target = await device();
  await expect(importJournal(target, new File([new Uint8Array(zipSync(files))], 'future.zip'))).rejects.toThrow('Unsupported minijour backup');
  expect(target.days.get(DATE)!.text).toBe('');
});
