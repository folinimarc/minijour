import { afterEach, expect, it, vi } from 'vitest';
import * as A from '@automerge/automerge';
import * as day from '../src/domain/day';
import * as documents from '../src/domain/documents';
import { Journal } from '../src/domain/journal';
import { LocalStore } from '../src/storage/local';
import { SyncEngine } from '../src/sync/engine';
import { addDay, MemoryCloud } from './helpers';

const DATE = '2026-10-24';
const devices: Journal[] = [];
async function device() {
  const journal = new Journal(await LocalStore.open(crypto.randomUUID()), crypto.randomUUID());
  devices.push(journal);
  return journal;
}
const path = () => `/days/${DATE}/${crypto.randomUUID()}.automerge`;
const checkpoint = (text: string) => A.save(day.editDay(day.createDay(DATE), text));
afterEach(() => {
  vi.restoreAllMocks();
  devices.splice(0).forEach(journal => { journal.close(); journal.local.close(); });
});

it('reuses decoded checkpoints and merged remote days without downloading, decoding, merging, or uploading them again', async () => {
  const cloud = new MemoryCloud();
  await cloud.upload(path(), checkpoint('First memory.'));
  await cloud.upload(path(), checkpoint('Second memory.'));
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  await engine.sync();
  const uploads = cloud.uploads;
  const download = vi.spyOn(cloud, 'download');
  const load = vi.spyOn(day, 'loadDay');
  const merge = vi.spyOn(documents, 'mergeDocuments');
  // Provider listing order is not significant.
  const list = cloud.list.bind(cloud);
  vi.spyOn(cloud, 'list').mockImplementation(async () => (await list()).reverse());
  await engine.sync(); await engine.sync();
  expect(journal.days.get(DATE)!.text).toContain('First memory.');
  expect(journal.days.get(DATE)!.text).toContain('Second memory.');
  expect(download).not.toHaveBeenCalled();
  expect(load.mock.calls.length).toBe(0);
  expect(merge.mock.calls.length).toBe(0);
  expect(cloud.uploads).toBe(uploads);
});

it('fetches revised and new checkpoints while reusing unchanged ones', async () => {
  const cloud = new MemoryCloud();
  const firstPath = path();
  let first = day.editDay(day.createDay(DATE), 'First memory.');
  await cloud.upload(firstPath, A.save(first));
  await cloud.upload(path(), checkpoint('Second memory.'));
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  await engine.sync();
  const download = vi.spyOn(cloud, 'download');
  first = day.editDay(first, 'First memory. More words.');
  await cloud.upload(firstPath, A.save(first));
  const thirdPath = path();
  await cloud.upload(thirdPath, checkpoint('Third memory.'));
  await engine.sync();
  expect(download.mock.calls.map(([path]) => path).sort()).toEqual([firstPath, thirdPath].sort());
  const text = journal.days.get(DATE)!.text;
  expect(text).toContain('More words.');
  expect(text).toContain('Second memory.');
  expect(text).toContain('Third memory.');
  download.mockClear();
  const load = vi.spyOn(day, 'loadDay');
  await engine.sync();
  expect(download).not.toHaveBeenCalled();
  expect(load.mock.calls.length).toBe(0);
});

it('does not let editing the local journal change the cached remote state', async () => {
  const cloud = new MemoryCloud();
  await cloud.upload(path(), checkpoint('An older memory.'));
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  await engine.sync();
  await journal.edit(DATE, 'An older memory. Added locally.');
  const uploads = cloud.uploads;
  await engine.sync();
  expect(cloud.uploads).toBe(uploads + 1);
  const fresh = await device();
  await new SyncEngine(fresh, cloud).sync();
  expect(fresh.days.get(DATE)!.text).toBe('An older memory. Added locally.');
});

it('rebuilds a day when a checkpoint disappears rather than pretending its history is still remote', async () => {
  const cloud = new MemoryCloud();
  const removed = path();
  await cloud.upload(removed, checkpoint('First memory.'));
  await cloud.upload(path(), checkpoint('Second memory.'));
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  await engine.sync();
  await cloud.remove(removed);
  const uploads = cloud.uploads;
  await engine.sync();
  // The missing history still exists locally and must be published again.
  expect(cloud.uploads).toBe(uploads + 1);
  const fresh = await device();
  await new SyncEngine(fresh, cloud).sync();
  expect(fresh.days.get(DATE)!.text).toContain('First memory.');
  expect(fresh.days.get(DATE)!.text).toContain('Second memory.');
});

it('retries a failed local save even when the decoded remote document is cached and already known', async () => {
  const cloud = new MemoryCloud();
  await cloud.upload(path(), checkpoint('Keep this memory.'));
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  vi.spyOn(journal.local, 'saveDay').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(engine.sync()).rejects.toThrow('Storage unavailable');
  expect(journal.hasUnsavedChanges).toBe(true);
  const download = vi.spyOn(cloud, 'download');
  await engine.sync();
  expect(download).not.toHaveBeenCalled();
  expect(journal.hasUnsavedChanges).toBe(false);
  expect(journal.saveError).toBeUndefined();
  const stored = (await journal.local.days()).get(DATE)!;
  expect(day.loadDay(stored).text).toBe('Keep this memory.');
});

it('does not retain a failed checkpoint download or invalid decoded bytes', async () => {
  const cloud = new MemoryCloud();
  const remotePath = path();
  const bytes = checkpoint('A valid memory.');
  await cloud.upload(remotePath, bytes);
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  const download = vi.spyOn(cloud, 'download')
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
  await expect(engine.sync()).rejects.toThrow('Network unavailable');
  await expect(engine.sync()).rejects.toThrow();
  await engine.sync();
  expect(download).toHaveBeenCalledTimes(3);
  expect(journal.days.get(DATE)!.text).toBe('A valid memory.');
});

it('keeps an uploaded cache snapshot separate from typing that happens during the upload', async () => {
  const cloud = new MemoryCloud();
  const journal = await device();
  await addDay(journal, DATE);
  await journal.edit(DATE, 'First memory.');
  const upload = cloud.upload.bind(cloud);
  vi.spyOn(cloud, 'upload').mockImplementationOnce(async (path, bytes) => {
    journal.stage(DATE, day.editDay(A.clone(journal.days.get(DATE)!), 'First memory. More words.'));
    return upload(path, bytes);
  });
  const engine = new SyncEngine(journal, cloud);
  await engine.sync();
  expect(journal.hasUnsavedChanges).toBe(true);
  await journal.flush();
  await engine.sync();
  expect(cloud.uploads).toBe(2);
  const fresh = await device();
  await new SyncEngine(fresh, cloud).sync();
  expect(fresh.days.get(DATE)!.text).toBe('First memory. More words.');
});

it('starts a fresh cache when a new sync engine opens the journal', async () => {
  const cloud = new MemoryCloud();
  await cloud.upload(path(), checkpoint('An existing memory.'));
  const journal = await device();
  await new SyncEngine(journal, cloud).sync();
  const download = vi.spyOn(cloud, 'download');
  await new SyncEngine(journal, cloud).sync();
  expect(download).toHaveBeenCalledTimes(1);
  expect(journal.days.get(DATE)!.text).toBe('An existing memory.');
});
