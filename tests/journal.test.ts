import { afterEach, describe, expect, it } from 'vitest';
import * as A from '@automerge/automerge';
import { createDay, editDay, heads, localDate, markdown, mergeDays } from '../src/domain/day';
import { Journal } from '../src/domain/journal';
import { LocalStore } from '../src/storage/local';
import { exportJournal, importJournal } from '../src/storage/backup';
import { SyncEngine } from '../src/sync/engine';
import { DropboxFiles } from '../src/sync/dropbox';
import { MemoryCloud } from './helpers';
import { strFromU8, unzipSync } from 'fflate';

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
  await journal.ensureDay(DATE);
  return journal;
}
afterEach(() => {
  journals.splice(0).forEach(journal => journal.close());
  stores.splice(0).forEach(store => store.close());
});

describe('Automerge journal model', () => {
  it('starts independently created days from identical history', () => {
    expect(heads(createDay(DATE))).toBe(heads(createDay(DATE)));
    expect(heads(createDay('2026-10-25'))).not.toBe(heads(createDay(DATE)));
  });

  it('preserves independent first edits on two offline devices with one date header', () => {
    const phone = editDay(createDay(DATE), 'Saw a fox.\n');
    const laptop = editDay(createDay(DATE), 'A long walk.\n');
    const merged = mergeDays(phone, laptop);
    expect(merged.text).toContain('Saw a fox.');
    expect(merged.text).toContain('A long walk.');
    expect(mergeDays(laptop, phone).text).toBe(merged.text);
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

  it('preserves ownership from legacy connections and serializes two competing authorizations', async () => {
    const journal = await device();
    await journal.local.setSetting('dropbox-connection', { appKey: 'app', accountId: 'legacy' });
    await DropboxFiles.open(journal.local);
    await DropboxFiles.disconnect(journal.local);
    await expect(saveConnection(journal, { appKey: 'app', accountId: 'other' })).rejects.toThrow();

    const fresh = await device();
    const attempts = await Promise.allSettled([
      saveConnection(fresh, { appKey: 'app', accountId: 'first' }),
      saveConnection(fresh, { appKey: 'app', accountId: 'second' }),
    ]);
    expect(attempts.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    await expect(saveConnection(fresh, { appKey: 'other-app', accountId: 'first' })).rejects.toThrow();
  });

  it('merges offline changes and converges without overwriting writers', async () => {
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
    expect(cloud.files.size).toBe(2);
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
  await journal.ensureDay('2026-10-25');
  expect(markdown(journal.days)).toBe('');
  const name = `${crypto.randomUUID()}.jpg`;
  await journal.ensureDay('2026-10-26');
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
