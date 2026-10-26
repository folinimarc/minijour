import { afterEach, expect, it, vi } from 'vitest';
import * as A from '@automerge/automerge';
import { createDay, editDay } from '../src/domain/day';
import { Journal } from '../src/domain/journal';
import { encodePhotoDeletions } from '../src/domain/photos';
import { changePhotoOptions, createPreferences } from '../src/domain/preferences';
import { LocalStore } from '../src/storage/local';
import { SyncEngine } from '../src/sync/engine';
import { addDay, MemoryCloud } from './helpers';

const devices: Journal[] = [];
async function device() {
  const journal = new Journal(await LocalStore.open(crypto.randomUUID()), crypto.randomUUID());
  devices.push(journal);
  return journal;
}
function gate() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function days(cloud: MemoryCloud, count: number) {
  for (let i = 1; i <= count; i++) {
    const date = `2026-10-${String(i).padStart(2, '0')}`;
    await cloud.upload(`/days/${date}/${crypto.randomUUID()}.automerge`, A.save(editDay(createDay(date), `Memory ${i}`)));
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  devices.splice(0).forEach(journal => { journal.close(); journal.local.close(); });
});

it('downloads checkpoints across days four at a time and reuses them on the next round', async () => {
  const cloud = new MemoryCloud();
  await days(cloud, 11);
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  const started: string[] = [];
  const pending = new Map<string, ReturnType<typeof gate>>();
  const download = cloud.download.bind(cloud);
  const spy = vi.spyOn(cloud, 'download').mockImplementation(async path => {
    started.push(path);
    const request = gate();
    pending.set(path, request);
    await request.promise;
    pending.delete(path);
    return download(path);
  });
  const syncing = engine.sync();
  await vi.waitFor(() => expect(started).toHaveLength(4));
  expect(pending.size).toBe(4);
  await addDay(journal, '2026-10-01');
  await journal.edit('2026-10-01', 'Written while downloading.');
  // Complete out of order; a single freed slot starts exactly one more file.
  pending.get(started[2])!.resolve();
  await vi.waitFor(() => expect(started).toHaveLength(5));
  expect(pending.size).toBe(4);
  while (started.length < 11) {
    const before = started.length;
    [...pending.values()].reverse().forEach(request => request.resolve());
    await vi.waitFor(() => expect(started.length).toBeGreaterThan(before));
    expect(pending.size).toBeLessThanOrEqual(4);
  }
  pending.forEach(request => request.resolve());
  await syncing;
  expect(journal.days.size).toBe(11);
  for (let i = 1; i <= 11; i++) expect(journal.days.get(`2026-10-${String(i).padStart(2, '0')}`)!.text).toContain(`Memory ${i}`);
  expect(journal.days.get('2026-10-01')!.text).toContain('Written while downloading.');
  spy.mockClear();
  await engine.sync();
  expect(spy).not.toHaveBeenCalled();
});

it('stops scheduling after a failure, drains in-flight work, and reuses successful downloads on retry', async () => {
  const cloud = new MemoryCloud();
  await days(cloud, 7);
  const journal = await device();
  const engine = new SyncEngine(journal, cloud);
  const pending: ReturnType<typeof gate>[] = [];
  const successful: string[] = [];
  const download = cloud.download.bind(cloud);
  const spy = vi.spyOn(cloud, 'download').mockImplementation(async path => {
    const request = gate();
    pending.push(request);
    await request.promise;
    successful.push(path);
    return download(path);
  });
  let settled = false;
  const syncing = engine.sync().then(() => { settled = true; }, error => { settled = true; return error; });
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  pending[0].reject(new Error('Network unavailable'));
  // A microtask turn lets the failure reach the queue while others stay blocked.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(spy).toHaveBeenCalledTimes(4);
  pending.slice(1).forEach(request => request.resolve());
  expect(await syncing).toEqual(new Error('Network unavailable'));
  expect(spy).toHaveBeenCalledTimes(4);
  expect(journal.days.size).toBe(0);
  spy.mockClear().mockImplementation(download);
  await engine.sync();
  expect(spy).toHaveBeenCalledTimes(4);
  expect(spy.mock.calls.every(([path]) => !successful.includes(path))).toBe(true);
  expect(journal.days.size).toBe(7);
});

it('applies parallel preference and deletion downloads before pulling days or photos', async () => {
  const cloud = new MemoryCloud();
  const options = { optimize: false, maxDimension: 3200 };
  for (let i = 0; i < 6; i++) {
    await cloud.upload(`/preferences/${crypto.randomUUID()}.automerge`, A.save(changePhotoOptions(createPreferences(), options)));
    const name = `${crypto.randomUUID()}.jpg`;
    await cloud.upload(`/photos/${name}`, new Uint8Array([1]));
    await cloud.upload(`/deleted-photos/${name}.json`, encodePhotoDeletions([name]));
  }
  await days(cloud, 1);
  const journal = await device();
  const active = new Set<string>();
  const peaks = new Map<string, number>();
  const download = cloud.download.bind(cloud);
  vi.spyOn(cloud, 'download').mockImplementation(async path => {
    const phase = path.split('/')[1];
    expect([...active].every(current => current.split('/')[1] === phase)).toBe(true);
    if (phase !== 'preferences') expect(journal.photoOptions).toEqual(options);
    if (phase === 'days') expect((await journal.local.photoDeletions()).size).toBe(6);
    expect(phase).not.toBe('photos');
    active.add(path);
    peaks.set(phase, Math.max(peaks.get(phase) ?? 0, active.size));
    await new Promise(resolve => setTimeout(resolve, 0));
    active.delete(path);
    return download(path);
  });
  await new SyncEngine(journal, cloud).sync();
  expect(peaks.get('preferences')).toBe(4);
  expect(peaks.get('deleted-photos')).toBe(4);
  expect(journal.days.size).toBe(1);
  expect(await journal.local.photoNames()).toEqual([]);
});

it('downloads photos in parallel, skips deleted photos, and respects deletion during a download', async () => {
  const cloud = new MemoryCloud();
  const names = Array.from({ length: 8 }, () => `${crypto.randomUUID()}.jpg`);
  for (const name of names) await cloud.upload(`/photos/${name}`, new Uint8Array([1, 2, 3]));
  await cloud.upload(`/deleted-photos/${names[0]}.json`, encodePhotoDeletions([names[0]]));
  const journal = await device();
  const ready = gate();
  let active = 0, peak = 0;
  const download = cloud.download.bind(cloud);
  const spy = vi.spyOn(cloud, 'download').mockImplementation(async path => {
    if (!path.startsWith('/photos/')) return download(path);
    active++;
    peak = Math.max(peak, active);
    await ready.promise;
    active--;
    return download(path);
  });
  const engine = new SyncEngine(journal, cloud);
  const syncing = engine.sync();
  await vi.waitFor(() => expect(active).toBe(4));
  await journal.deletePhotos([names[1]]);
  ready.resolve();
  await syncing;
  expect(peak).toBe(4);
  expect(spy.mock.calls.some(([path]) => path === `/photos/${names[0]}`)).toBe(false);
  expect(await journal.local.photoNames()).toEqual(expect.arrayContaining(names.slice(2)));
  expect(await journal.local.photo(names[1])).toBeUndefined();
  spy.mockClear();
  await engine.sync();
  expect(spy).not.toHaveBeenCalled();
  expect(cloud.files.has(`/photos/${names[1]}`)).toBe(false);
});

it('notifies the journal about photos saved before another download failed and retries only missing photos', async () => {
  const cloud = new MemoryCloud();
  const names = Array.from({ length: 3 }, () => `${crypto.randomUUID()}.jpg`);
  for (const name of names) await cloud.upload(`/photos/${name}`, new Uint8Array([1]));
  const journal = await device();
  const changed = vi.spyOn(journal, 'photosChanged');
  const download = cloud.download.bind(cloud);
  const spy = vi.spyOn(cloud, 'download').mockImplementation(async path => {
    if (path === `/photos/${names[1]}`) throw new Error('Photo unavailable');
    return download(path);
  });
  const engine = new SyncEngine(journal, cloud);
  await expect(engine.sync()).rejects.toThrow('Photo unavailable');
  expect(await journal.local.photoNames()).toHaveLength(2);
  expect(changed).toHaveBeenCalledTimes(1);
  spy.mockClear().mockImplementation(download);
  await engine.sync();
  expect(spy.mock.calls).toEqual([[`/photos/${names[1]}`]]);
  expect(await journal.local.photoNames()).toHaveLength(3);
  expect(changed).toHaveBeenCalledTimes(2);
});
