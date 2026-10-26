import { afterEach, expect, it, vi } from 'vitest';
import * as A from '@automerge/automerge';
import { createDay, editDay, loadDay } from '../src/domain/day';
import { heads } from '../src/domain/documents';
import { Journal } from '../src/domain/journal';
import { changePhotoOptions, createPreferences, loadPreferences } from '../src/domain/preferences';
import { LocalStore } from '../src/storage/local';
import { SyncEngine } from '../src/sync/engine';
import { MissingRemoteFile } from '../src/sync/cloud';
import { addDay, MemoryCloud } from './helpers';

const DATE = '2026-10-24';
const devices: Journal[] = [];
async function device() {
  const journal = new Journal(await LocalStore.open(crypto.randomUUID()), crypto.randomUUID());
  devices.push(journal);
  return journal;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const dayFiles = (cloud: MemoryCloud) => [...cloud.files].filter(([path]) => path.startsWith('/days/'));
const preferenceFiles = (cloud: MemoryCloud) => [...cloud.files].filter(([path]) => path.startsWith('/preferences/'));
afterEach(() => {
  vi.restoreAllMocks();
  devices.splice(0).forEach(journal => { journal.close(); journal.local.close(); });
});

it('keeps one immutable snapshot per day and preference document across repeated app sessions', async () => {
  const cloud = new MemoryCloud(), journal = await device();
  const upload = cloud.upload.bind(cloud);
  vi.spyOn(cloud, 'upload').mockImplementation(async (path, bytes) => {
    expect(cloud.files.has(path)).toBe(false);
    return upload(path, bytes);
  });
  await addDay(journal, DATE);
  for (let i = 1; i <= 8; i++) {
    await journal.edit(DATE, `Memory ${i}.`);
    await journal.setPhotoOptions({ optimize: i % 2 === 0, maxDimension: 1000 + i });
    await new SyncEngine(journal, cloud).sync();
    expect(dayFiles(cloud)).toHaveLength(1);
    expect(preferenceFiles(cloud)).toHaveLength(1);
    expect(loadDay(dayFiles(cloud)[0][1].bytes).text).toBe(`Memory ${i}.`);
    expect(loadPreferences(preferenceFiles(cloud)[0][1].bytes).photoOptions).toEqual(journal.photoOptions);
  }
  const uploads = cloud.uploads;
  await new SyncEngine(journal, cloud).sync();
  expect(cloud.uploads).toBe(uploads);
});

it('consolidates existing snapshots even without a new edit and preserves their complete histories', async () => {
  const cloud = new MemoryCloud(), journal = await device();
  const first = editDay(createDay(DATE), 'First branch.');
  const second = editDay(createDay(DATE), 'Second branch.');
  for (const doc of [first, second]) await cloud.upload(`/days/${DATE}/${crypto.randomUUID()}.automerge`, A.save(doc));
  const originals = dayFiles(cloud).map(([path]) => path);
  const upload = cloud.upload.bind(cloud), remove = cloud.remove.bind(cloud);
  let replacement: string | undefined;
  vi.spyOn(cloud, 'upload').mockImplementation(async (path, bytes) => {
    expect(originals.every(original => cloud.files.has(original))).toBe(true);
    const file = await upload(path, bytes);
    replacement = path;
    return file;
  });
  vi.spyOn(cloud, 'remove').mockImplementation(async path => {
    expect(replacement && cloud.files.has(replacement)).toBe(true);
    return remove(path);
  });
  await new SyncEngine(journal, cloud).sync();
  expect(dayFiles(cloud)).toHaveLength(1);
  const merged = loadDay(dayFiles(cloud)[0][1].bytes);
  expect(A.view(merged, A.getHeads(first)).text).toBe('First branch.');
  expect(A.view(merged, A.getHeads(second)).text).toBe('Second branch.');
});

it('retains clearing history so an unchanged offline device cannot resurrect a deleted entry', async () => {
  const cloud = new MemoryCloud(), phone = await device(), offline = await device();
  await addDay(phone, DATE); await phone.edit(DATE, 'An entry that will be deleted.');
  const phoneSync = new SyncEngine(phone, cloud), offlineSync = new SyncEngine(offline, cloud);
  await phoneSync.sync(); await offlineSync.sync();
  const beforeDeletion = A.getHeads(phone.days.get(DATE)!);
  await phone.edit(DATE, ''); await phoneSync.sync();
  expect(dayFiles(cloud)).toHaveLength(1);
  const cleared = loadDay(dayFiles(cloud)[0][1].bytes);
  expect(cleared.text).toBe('');
  expect(A.view(cleared, beforeDeletion).text).toBe('An entry that will be deleted.');
  await offlineSync.sync();
  expect(offline.days.get(DATE)!.text).toBe('');
  expect(dayFiles(cloud)).toHaveLength(1);
});

it('retries partially completed preference cleanup and retains both settings histories', async () => {
  const cloud = new MemoryCloud(), journal = await device();
  const first = changePhotoOptions(createPreferences(), { optimize: false, maxDimension: 3200 });
  const second = changePhotoOptions(createPreferences(), { optimize: true, maxDimension: 2400 });
  for (const doc of [first, second]) await cloud.upload(`/preferences/${crypto.randomUUID()}.automerge`, A.save(doc));
  const remove = cloud.remove.bind(cloud);
  vi.spyOn(cloud, 'remove').mockImplementationOnce(remove).mockRejectedValueOnce(new Error('Interrupted cleanup'));
  const engine = new SyncEngine(journal, cloud);
  await expect(engine.sync()).rejects.toThrow('Interrupted cleanup');
  expect(preferenceFiles(cloud)).toHaveLength(2); // One old file and the replacement.
  await engine.sync();
  expect(preferenceFiles(cloud)).toHaveLength(1);
  const merged = loadPreferences(preferenceFiles(cloud)[0][1].bytes);
  expect(A.view(merged, A.getHeads(first)).photoOptions).toEqual(first.photoOptions);
  expect(A.view(merged, A.getHeads(second)).photoOptions).toEqual(second.photoOptions);
});

it.each(['before upload', 'lost upload response', 'during removal'] as const)('recovers from failure %s without losing the previous history', async failure => {
  const cloud = new MemoryCloud(), journal = await device();
  await addDay(journal, DATE); await journal.edit(DATE, 'Keep the original.');
  const engine = new SyncEngine(journal, cloud);
  await engine.sync();
  const original = dayFiles(cloud)[0][0];
  await journal.edit(DATE, 'Keep the original. And this addition.');
  const upload = cloud.upload.bind(cloud);
  if (failure === 'before upload') vi.spyOn(cloud, 'upload').mockRejectedValueOnce(new Error('Interrupted'));
  if (failure === 'lost upload response') vi.spyOn(cloud, 'upload').mockImplementationOnce(async (path, bytes) => {
    await upload(path, bytes); throw new Error('Interrupted');
  });
  if (failure === 'during removal') vi.spyOn(cloud, 'remove').mockRejectedValueOnce(new Error('Interrupted'));
  await expect(engine.sync()).rejects.toThrow('Interrupted');
  expect(cloud.files.has(original)).toBe(true);
  await engine.sync();
  expect(dayFiles(cloud)).toHaveLength(1);
  expect(loadDay(dayFiles(cloud)[0][1].bytes).text).toBe('Keep the original. And this addition.');
  const fresh = await device(); await new SyncEngine(fresh, cloud).sync();
  expect(fresh.days.get(DATE)!.text).toBe(journal.days.get(DATE)!.text);
});

it('leaves concurrent uploads intact and eventually consolidates both devices into one snapshot', async () => {
  const cloud = new MemoryCloud(), phone = await device(), laptop = await device();
  await addDay(phone, DATE); await phone.edit(DATE, 'Common entry.');
  const a = new SyncEngine(phone, cloud), b = new SyncEngine(laptop, cloud);
  await a.sync(); await b.sync();
  await phone.edit(DATE, 'Phone addition. Common entry.');
  await laptop.edit(DATE, 'Common entry. Laptop addition.');
  const ready = gate();
  const upload = cloud.upload.bind(cloud);
  let started = 0;
  vi.spyOn(cloud, 'upload').mockImplementation(async (path, bytes) => {
    if (++started <= 2) await ready.promise;
    return upload(path, bytes);
  });
  const syncing = Promise.all([a.sync(), b.sync()]);
  await vi.waitFor(() => expect(started).toBe(2));
  ready.release(); await syncing;
  // Both replacements survived: neither device deleted an unseen snapshot.
  expect(dayFiles(cloud)).toHaveLength(2);
  await a.sync(); await b.sync();
  expect(dayFiles(cloud)).toHaveLength(1);
  expect(phone.days.get(DATE)!.text).toContain('Phone addition.');
  expect(phone.days.get(DATE)!.text).toContain('Laptop addition.');
  expect(heads(phone.days.get(DATE)!)).toBe(heads(laptop.days.get(DATE)!));
});

it('re-lists once if another device consolidates a snapshot between listing and download', async () => {
  const cloud = new MemoryCloud(), phone = await device(), fresh = await device();
  await addDay(phone, DATE); await phone.edit(DATE, 'Before consolidation.');
  const a = new SyncEngine(phone, cloud); await a.sync();
  const download = cloud.download.bind(cloud), list = vi.spyOn(cloud, 'list');
  vi.spyOn(cloud, 'download').mockImplementationOnce(async path => {
    await phone.edit(DATE, 'After consolidation.'); await a.sync();
    return download(path); // The old snapshot was removed by the other engine.
  });
  await new SyncEngine(fresh, cloud).sync();
  expect(list).toHaveBeenCalledTimes(3); // Fresh round, peer round, fresh retry.
  expect(fresh.days.get(DATE)!.text).toBe('After consolidation.');
  expect(dayFiles(cloud)).toHaveLength(1);
});

it('bounds retries when cloud files keep disappearing', async () => {
  const cloud = new MemoryCloud(), journal = await device();
  const path = `/days/${DATE}/${crypto.randomUUID()}.automerge`;
  await cloud.upload(path, A.save(editDay(createDay(DATE), 'A memory.')));
  const list = vi.spyOn(cloud, 'list');
  vi.spyOn(cloud, 'download').mockRejectedValue(new MissingRemoteFile(path));
  await expect(new SyncEngine(journal, cloud).sync()).rejects.toBeInstanceOf(MissingRemoteFile);
  expect(list).toHaveBeenCalledTimes(2);
  expect(cloud.files.has(path)).toBe(true);
});

it('does not remove any snapshots if a remote document cannot be validated', async () => {
  const cloud = new MemoryCloud(), journal = await device();
  await cloud.upload(`/days/${DATE}/${crypto.randomUUID()}.automerge`, A.save(editDay(createDay(DATE), 'A memory.')));
  await cloud.upload(`/days/${DATE}/${crypto.randomUUID()}.automerge`, new Uint8Array([1, 2, 3]));
  const remove = vi.spyOn(cloud, 'remove'), uploads = cloud.uploads;
  await expect(new SyncEngine(journal, cloud).sync()).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
  expect(cloud.uploads).toBe(uploads);
  expect(dayFiles(cloud)).toHaveLength(2);
});
