import { afterEach, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { Journal } from '../src/domain/journal';
import { decodePhotoDeletions, encodePhotoDeletions, referencedPhotos } from '../src/domain/photos';
import { LocalStore } from '../src/storage/local';
import { unusedPhotos } from '../src/storage/photo-cleanup';
import { exportJournal, importJournal } from '../src/storage/backup';
import { SyncEngine } from '../src/sync/engine';
import { MemoryCloud } from './helpers';

const DATE = '2026-10-24';
const photoName = () => `${crypto.randomUUID()}.jpg`;
const journals: Journal[] = [];
async function device(database = crypto.randomUUID()) {
  const journal = new Journal(await LocalStore.open(database), crypto.randomUUID());
  journals.push(journal);
  await journal.load(); await journal.ensureDay(DATE);
  return journal;
}
async function photo(journal: Journal, name = photoName()) {
  await journal.local.savePhoto(name, new Blob(['photo bytes']));
  return name;
}
async function backup(journal: Journal) { return new File([await exportJournal(journal)], 'journal.zip'); }
afterEach(() => journals.splice(0).forEach(journal => { journal.close(); journal.local.close(); }));

it('recognizes photo paths conservatively across Markdown styles and all days', async () => {
  const journal = await device();
  const first = await photo(journal), second = await photo(journal), third = await photo(journal);
  await journal.edit(DATE, `![photo](photos/${first} "A title")\n[attachment]: photos/${second}\n\`photos/${third}\``);
  expect(referencedPhotos([journal.days.get(DATE)!.text])).toEqual(new Set([first, second, third]));
  await journal.ensureDay('2026-10-25');
  await journal.edit('2026-10-25', `![again](photos/${first})`);
  await journal.edit(DATE, 'Removed from the first day.');
  expect((await unusedPhotos(journal)).map(file => file.name).sort()).toEqual([second, third].sort());
  // Editing alone leaves the file available for undo.
  expect(await journal.local.photo(second)).toBeDefined();
  expect(await journal.local.photoDeletions()).toEqual(new Set());
});

it('rechecks other tabs and deletes only the reviewed IDs, preserving new references and new photos', async () => {
  const database = crypto.randomUUID();
  const first = await device(database);
  const remove = await photo(first), keep = await photo(first);
  const plan = await unusedPhotos(first);
  expect(plan).toHaveLength(2);
  expect(plan.reduce((sum, file) => sum + file.size, 0)).toBe(22);
  const other = await device(database);
  await other.ensureDay('2026-10-25');
  await other.edit('2026-10-25', `![keep](photos/${keep})`);
  const newer = await photo(other);
  expect(await first.deletePhotos(plan.map(file => file.name), { onlyUnused: true })).toEqual([remove]);
  expect(await first.local.photo(remove)).toBeUndefined();
  expect(await first.local.photo(keep)).toBeDefined();
  expect(await first.local.photo(newer)).toBeDefined();
});

it('atomically records permanent deletion and rejects stale saves from another tab', async () => {
  const journal = await device();
  const name = await photo(journal);
  await Promise.all([journal.local.savePhoto(name, new Blob(['stale copy'])), journal.deletePhotos([name])]);
  expect(await journal.local.photo(name)).toBeUndefined();
  expect(await journal.local.savePhoto(name, new Blob(['restore']))).toBe(false);
  expect(await journal.local.photoDeletions()).toEqual(new Set([name]));
  expect(await journal.deletePhotos([name])).toEqual([]);
});

it('exports only current photo references and preserves deletion records when restoring a backup', async () => {
  const original = await device();
  const keep = await photo(original), orphan = await photo(original), deleted = await photo(original);
  await original.edit(DATE, `![keep](photos/${keep})`);
  await original.deletePhotos([deleted]);
  const file = await backup(original);
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  expect(Object.keys(entries).filter(path => path.startsWith('photos/'))).toEqual([`photos/${keep}`]);
  expect(decodePhotoDeletions(entries['minijour/photo-deletions.json'])).toEqual([deleted]);
  expect(await original.local.photo(orphan)).toBeDefined(); // Export isn't cleanup.
  const restored = await device();
  await importJournal(restored, file);
  expect(await restored.local.photo(keep)).toBeDefined();
  expect(await restored.local.photoDeletions()).toEqual(new Set([deleted]));
});

it('accepts legacy backups but never restores a photo permanently deleted on this journal', async () => {
  const journal = await device();
  const name = await photo(journal);
  await journal.edit(DATE, `![photo](photos/${name})`);
  const entries = unzipSync(new Uint8Array(await (await backup(journal)).arrayBuffer()));
  delete entries['minijour/photo-deletions.json']; // Backups from older versions.
  delete entries['minijour/format.json'];
  const legacy = new File([new Uint8Array(zipSync(entries))], 'old.zip');
  await journal.edit(DATE, 'Removed photo.');
  await journal.deletePhotos([name]);
  const fresh = await device();
  await importJournal(fresh, await backup(journal));
  await importJournal(fresh, legacy);
  expect(await fresh.local.photo(name)).toBeUndefined();
  const untouched = await device();
  await importJournal(untouched, legacy);
  expect(await untouched.local.photo(name)).toBeDefined();
});

it('validates backup deletion metadata before importing any data', async () => {
  const source = await device();
  const name = await photo(source);
  await source.edit(DATE, `![photo](photos/${name})`);
  const entries = unzipSync(new Uint8Array(await (await backup(source)).arrayBuffer()));
  entries['minijour/photo-deletions.json'] = strToU8('{"version":1,"photos":["../not-a-photo"]}');
  const target = await device();
  await expect(importJournal(target, new File([new Uint8Array(zipSync(entries))], 'bad.zip'))).rejects.toThrow('Invalid photo deletion');
  expect(await target.local.photoNames()).toEqual([]);
  expect(target.days.get(DATE)!.text).toBe('');
});

it('syncs permanent deletion before removing cloud bytes, and an offline device cannot resurrect them', async () => {
  const cloud = new MemoryCloud(); const phone = await device(), laptop = await device();
  const name = await photo(phone);
  await phone.edit(DATE, `![photo](photos/${name})`);
  const first = new SyncEngine(phone, cloud), second = new SyncEngine(laptop, cloud);
  await first.sync(); await second.sync();
  await phone.edit(DATE, 'Removed the photo.'); await first.sync();
  expect(cloud.files.has(`/photos/${name}`)).toBe(true);
  await phone.deletePhotos([name], { onlyUnused: true });
  const calls: string[] = [];
  const upload = cloud.upload.bind(cloud), remove = cloud.remove.bind(cloud);
  cloud.upload = async (path, bytes) => { calls.push(`upload:${path}`); return upload(path, bytes); };
  cloud.remove = async path => { calls.push(`remove:${path}`); await remove(path); };
  await first.sync();
  expect(calls.indexOf(`upload:/deleted-photos/${name}.json`)).toBeLessThan(calls.indexOf(`remove:/photos/${name}`));
  expect(cloud.files.has(`/photos/${name}`)).toBe(false);
  await laptop.ensureDay('2026-10-25');
  await laptop.edit('2026-10-25', `Offline photo reference: ![photo](photos/${name})`);
  await second.sync(); await first.sync();
  expect(await laptop.local.photo(name)).toBeUndefined();
  expect(laptop.days.get('2026-10-25')!.text).toContain(name);
  expect(cloud.files.has(`/photos/${name}`)).toBe(false);
  const fresh = await device(); await new SyncEngine(fresh, cloud).sync();
  expect(await fresh.local.photoDeletions()).toEqual(new Set([name]));
  expect(await fresh.local.photoNames()).toEqual([]);
});

it('retries failed record publication and deletion, and reclaims a late stale upload', async () => {
  const cloud = new MemoryCloud(), journal = await device();
  const name = await photo(journal); const engine = new SyncEngine(journal, cloud);
  await engine.sync(); await journal.deletePhotos([name]);
  const upload = cloud.upload.bind(cloud), remove = cloud.remove.bind(cloud);
  cloud.upload = async () => { throw new Error('Upload failed'); };
  await expect(engine.sync()).rejects.toThrow('Upload failed');
  expect(cloud.files.has(`/photos/${name}`)).toBe(true);
  cloud.upload = upload;
  cloud.remove = async () => { throw new Error('Delete failed'); };
  await expect(engine.sync()).rejects.toThrow('Delete failed');
  expect(cloud.files.has(`/deleted-photos/${name}.json`)).toBe(true);
  expect(cloud.files.has(`/photos/${name}`)).toBe(true);
  cloud.remove = remove; await engine.sync();
  expect(cloud.files.has(`/photos/${name}`)).toBe(false);
  await cloud.upload(`/photos/${name}`, strToU8('late stale upload'));
  await engine.sync();
  expect(cloud.files.has(`/photos/${name}`)).toBe(false);
});

it('rejects a mismatched cloud deletion record without deleting photos or publishing changes', async () => {
  const journal = await device(), cloud = new MemoryCloud();
  const keep = await photo(journal);
  await cloud.upload(`/deleted-photos/${keep}.json`, encodePhotoDeletions([photoName()]));
  const writes = cloud.uploads;
  await expect(new SyncEngine(journal, cloud).sync()).rejects.toThrow('does not match');
  expect(await journal.local.photo(keep)).toBeDefined();
  expect(cloud.uploads).toBe(writes);
});

it('does not persist a download that finishes after local permanent deletion', async () => {
  const cloud = new MemoryCloud(), source = await device(), target = await device();
  const name = await photo(source); await new SyncEngine(source, cloud).sync();
  const download = cloud.download.bind(cloud);
  cloud.download = async path => {
    if (path === `/photos/${name}`) await target.deletePhotos([name]);
    return download(path);
  };
  const engine = new SyncEngine(target, cloud); await engine.sync();
  expect(await target.local.photo(name)).toBeUndefined();
  await engine.sync();
  expect(cloud.files.has(`/photos/${name}`)).toBe(false);
});

it('ignores deletion files in legacy plaintext imports, while retaining known local deletions', async () => {
  const legacy = new MemoryCloud(), source = await device(), target = await device();
  const keep = await photo(source), deleted = await photo(source);
  await source.edit(DATE, `![keep](photos/${keep}) ![old](photos/${deleted})`);
  await new SyncEngine(source, legacy).sync();
  // Plaintext legacy data must not be able to inject new permanent deletions.
  await legacy.upload(`/deleted-photos/${keep}.json`, encodePhotoDeletions([keep]));
  await target.deletePhotos([deleted]);
  const writes = legacy.uploads;
  await new SyncEngine(target, legacy).importOnly();
  expect(await target.local.photo(keep)).toBeDefined();
  expect(await target.local.photo(deleted)).toBeUndefined();
  expect(await target.local.photoDeletions()).toEqual(new Set([deleted]));
  expect(legacy.uploads).toBe(writes);
});
