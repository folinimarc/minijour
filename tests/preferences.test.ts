import * as A from '@automerge/automerge';
import { afterEach, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { Journal } from '../src/domain/journal';
import { createDay, editDay } from '../src/domain/day';
import { heads, mergeDocuments } from '../src/domain/documents';
import { createPreferences, changePhotoOptions, loadPreferences, type Preferences } from '../src/domain/preferences';
import { DEFAULT_PHOTO_OPTIONS } from '../src/domain/photos';
import { LocalStore } from '../src/storage/local';
import { exportJournal, importJournal } from '../src/storage/backup';
import { SyncEngine } from '../src/sync/engine';
import { EncryptedFiles } from '../src/crypto/vault';
import { MemoryCloud } from './helpers';
import * as preferences from '../src/domain/preferences';

const originals = { optimize: false, maxDimension: 640 };
const optimized = { optimize: true, maxDimension: 1200 };
const devices: Journal[] = [];
async function device(database = crypto.randomUUID()) {
  const journal = new Journal(await LocalStore.open(database), crypto.randomUUID());
  devices.push(journal); await journal.load(); return journal;
}
afterEach(() => {
  vi.restoreAllMocks();
  devices.splice(0).forEach(journal => { journal.close(); journal.local.close(); });
});

it('does not persist, back up, or upload defaults as a preference', async () => {
  const journal = await device(), cloud = new MemoryCloud();
  expect(journal.photoOptions).toEqual(DEFAULT_PHOTO_OPTIONS);
  await new SyncEngine(journal, cloud).sync();
  expect(await journal.local.preferences()).toBeUndefined();
  expect(cloud.files.size).toBe(0);
  const files = unzipSync(new Uint8Array(await (await exportJournal(journal)).arrayBuffer()));
  expect(files['minijour/preferences.automerge']).toBeUndefined();
  expect(journal.days.size).toBe(0);
});

it('adopts encrypted cloud preferences on a new device without uploading its defaults', async () => {
  const cloud = new MemoryCloud(), source = await device(), target = await device();
  const vault = await EncryptedFiles.create(cloud, 'a password for preferences');
  await source.setPhotoOptions(originals);
  await new SyncEngine(source, vault).sync();
  const uploads = cloud.uploads;
  const otherVault = await EncryptedFiles.unlock(cloud, (await EncryptedFiles.inspect(cloud))!, 'a password for preferences');
  await new SyncEngine(target, otherVault).sync();
  expect(target.photoOptions).toEqual(originals);
  expect(cloud.uploads).toBe(uploads);
  expect(target.days.size).toBe(0);
  expect((await otherVault.list()).map(file => file.path)).toEqual([expect.stringMatching(/^\/preferences\/.+\.automerge$/)]);
  expect([...cloud.files.keys()].some(path => path.includes('preferences'))).toBe(false);
});

it('converges offline changes to one complete flag-and-dimension pair, including a stale device', async () => {
  const cloud = new MemoryCloud(), first = await device(), second = await device(), stale = await device();
  const a = new SyncEngine(first, cloud), b = new SyncEngine(second, cloud), c = new SyncEngine(stale, cloud);
  await first.setPhotoOptions(originals); await a.sync(); await b.sync(); await c.sync();
  const otherChoice = { optimize: false, maxDimension: 6400 };
  await first.setPhotoOptions(optimized); await second.setPhotoOptions(otherChoice);
  await Promise.all([a.sync(), b.sync()]); await a.sync(); await b.sync(); await c.sync();
  expect([optimized, otherChoice]).toContainEqual(first.photoOptions);
  expect(second.photoOptions).toEqual(first.photoOptions);
  expect(stale.photoOptions).toEqual(first.photoOptions);
  expect(heads(first.preferences)).toBe(heads(second.preferences));
  const uploads = cloud.uploads;
  await c.sync(); await a.sync();
  expect(cloud.uploads).toBe(uploads);
});

it('serializes preference saves from two tabs without losing either change history', async () => {
  const database = crypto.randomUUID(), first = await device(database), second = await device(database);
  await Promise.all([first.setPhotoOptions(originals), second.setPhotoOptions(optimized)]);
  await first.refreshPreferences(); await second.refreshPreferences();
  expect(first.photoOptions).toEqual(second.photoOptions);
  expect([originals, optimized]).toContainEqual(first.photoOptions);
  expect(heads(first.preferences)).toBe(heads(second.preferences));
  expect(heads(loadPreferences((await first.local.preferences())!))).toBe(heads(first.preferences));
});

it('keeps overlapping preference changes from one journal mergeable', async () => {
  const journal = await device();
  await Promise.all([journal.setPhotoOptions(originals), journal.setPhotoOptions(optimized)]);
  await journal.refreshPreferences();
  expect([originals, optimized]).toContainEqual(journal.photoOptions);
  expect(A.getAllChanges(journal.preferences)).toHaveLength(2);
});

it('keeps failed settings writes out of the active policy and retries a cached cloud preference', async () => {
  const cloud = new MemoryCloud(), source = await device(), target = await device();
  await source.setPhotoOptions(originals); await new SyncEngine(source, cloud).sync();
  const save = vi.spyOn(target.local, 'savePreferences').mockRejectedValueOnce(new Error('Storage full.'));
  const engine = new SyncEngine(target, cloud);
  await expect(engine.sync()).rejects.toThrow('Storage full');
  expect(target.photoOptions).toEqual(DEFAULT_PHOTO_OPTIONS);
  expect(await target.local.preferences()).toBeUndefined();
  await engine.sync();
  expect(target.photoOptions).toEqual(originals);
  const previous = heads(target.preferences);
  save.mockRejectedValueOnce(new Error('Storage full again.'));
  await expect(target.setPhotoOptions(optimized)).rejects.toThrow('Storage full again');
  expect(target.photoOptions).toEqual(originals);
  expect(heads(target.preferences)).toBe(previous);
});

it('keeps a newer preference pending when an older checkpoint is uploading', async () => {
  const cloud = new MemoryCloud(), journal = await device();
  await journal.setPhotoOptions(originals);
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const upload = cloud.upload.bind(cloud);
  vi.spyOn(cloud, 'upload').mockImplementationOnce(async (path, bytes) => {
    reached(); await held; return upload(path, bytes);
  });
  const engine = new SyncEngine(journal, cloud), syncing = engine.sync();
  await waiting; await journal.setPhotoOptions(optimized); release(); await syncing;
  expect(loadPreferences([...cloud.files.values()][0].bytes).photoOptions).toEqual(originals);
  expect(journal.photoOptions).toEqual(optimized);
  await engine.sync();
  expect(loadPreferences([...cloud.files.values()][0].bytes).photoOptions).toEqual(optimized);
});

it('keeps a locally saved choice through a failed upload and retries it', async () => {
  const journal = await device(), target = await device(), cloud = new MemoryCloud();
  await journal.setPhotoOptions(originals);
  vi.spyOn(cloud, 'upload').mockRejectedValueOnce(new Error('Offline.'));
  const engine = new SyncEngine(journal, cloud);
  await expect(engine.sync()).rejects.toThrow('Offline');
  expect(journal.photoOptions).toEqual(originals);
  expect(loadPreferences((await journal.local.preferences())!).photoOptions).toEqual(originals);
  await engine.sync(); await new SyncEngine(target, cloud).sync();
  expect(target.photoOptions).toEqual(originals);
});

it('does not clear a text save error when a preference saves successfully', async () => {
  const journal = await device();
  journal.stage('2026-10-26', editDay(createDay('2026-10-26'), 'An unsaved memory.'));
  vi.spyOn(journal.local, 'saveDay').mockRejectedValueOnce(new Error('Text could not save.'));
  await expect(journal.flush()).rejects.toThrow('Text could not save');
  await journal.setPhotoOptions(originals);
  expect(journal.saveError?.message).toBe('Text could not save.');
  expect(journal.hasUnsavedChanges).toBe(true);
  await journal.flush();
  expect(journal.saveError).toBeUndefined();
});

it('reuses unchanged decoded preference checkpoints and refreshes a revised checkpoint', async () => {
  const journal = await device(), target = await device(), cloud = new MemoryCloud();
  const source = new SyncEngine(journal, cloud), remote = new SyncEngine(target, cloud);
  await journal.setPhotoOptions(originals); await source.sync(); await remote.sync();
  const load = vi.spyOn(preferences, 'loadPreferences'), download = vi.spyOn(cloud, 'download');
  await remote.sync(); await remote.sync();
  expect(load).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  await journal.setPhotoOptions(optimized); await source.sync(); await remote.sync();
  expect(target.photoOptions).toEqual(optimized);
  expect(download).toHaveBeenCalledTimes(1);
});

it('retries invalid checkpoint bytes instead of keeping a failed decode in the cache', async () => {
  const source = await device(), target = await device(), cloud = new MemoryCloud();
  await source.setPhotoOptions(originals); await new SyncEngine(source, cloud).sync();
  vi.spyOn(cloud, 'download').mockResolvedValueOnce(A.save(A.from({ unknown: true })));
  const engine = new SyncEngine(target, cloud);
  await expect(engine.sync()).rejects.toThrow('Invalid journal preferences');
  expect(target.photoOptions).toEqual(DEFAULT_PHOTO_OPTIONS);
  await engine.sync();
  expect(target.photoOptions).toEqual(originals);
});

it('preserves preference history in backups, while a backup without preferences leaves the current choice alone', async () => {
  const source = await device(), restored = await device(), empty = await device();
  await source.setPhotoOptions(originals); await source.setPhotoOptions(optimized);
  const file = new File([await exportJournal(source)], 'journal.zip');
  await importJournal(restored, file);
  expect(restored.photoOptions).toEqual(optimized);
  expect(heads(restored.preferences)).toBe(heads(source.preferences));
  await importJournal(restored, new File([await exportJournal(empty)], 'empty.zip'));
  expect(restored.photoOptions).toEqual(optimized);
  expect(restored.days.size).toBe(0);
});

it('rejects invalid preferences before importing other backup content, including hidden invalid conflicts', async () => {
  const invalid = A.save(A.from({ photoOptions: { optimize: true, maxDimension: 0 } }));
  expect(() => loadPreferences(invalid)).toThrow('Invalid journal preferences');
  const good = changePhotoOptions(createPreferences(), originals);
  const conflict = mergeDocuments(good, A.load<Preferences>(invalid));
  expect(() => loadPreferences(A.save(conflict))).toThrow('Invalid journal preferences');
  const source = await device(), target = await device();
  const files = unzipSync(new Uint8Array(await (await exportJournal(source)).arrayBuffer()));
  files['minijour/preferences.automerge'] = new Uint8Array(invalid);
  const deletes = vi.spyOn(target, 'deletePhotos');
  await expect(importJournal(target, new File([new Uint8Array(zipSync(files))], 'invalid.zip'))).rejects.toThrow('Invalid journal preferences');
  expect(deletes).not.toHaveBeenCalled();
  expect(await target.local.preferences()).toBeUndefined();
});

it('carries an existing device-local choice into the journal without creating entries', async () => {
  const local = await LocalStore.open(crypto.randomUUID());
  await local.setSetting('photo-options', originals);
  const journal = new Journal(local, crypto.randomUUID()); devices.push(journal);
  await journal.load();
  expect(journal.photoOptions).toEqual(originals);
  expect(await local.setting('photo-options')).toBeUndefined();
  expect(await local.preferences()).toBeInstanceOf(Uint8Array);
  expect(journal.days.size).toBe(0);
  const previous = heads(journal.preferences);
  await journal.load();
  expect(heads(journal.preferences)).toBe(previous);
});

it('keeps the journal accessible and preserves the existing choice if its conversion cannot save', async () => {
  const local = await LocalStore.open(crypto.randomUUID());
  await local.setSetting('photo-options', originals);
  vi.spyOn(local, 'savePreferences').mockRejectedValueOnce(new Error('Storage full.'));
  const journal = new Journal(local, crypto.randomUUID()); devices.push(journal);
  await journal.load();
  expect(journal.photoOptions).toEqual(originals);
  expect(await local.setting('photo-options')).toEqual(originals);
  expect(journal.saveError?.message).toBe('Storage full.');
  const exported = unzipSync(new Uint8Array(await (await exportJournal(journal)).arrayBuffer()));
  expect(loadPreferences(exported['minijour/preferences.automerge']).photoOptions).toEqual(originals);
  await journal.setPhotoOptions(originals);
  expect(journal.saveError).toBeUndefined();
});
