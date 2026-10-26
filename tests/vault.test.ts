import { afterEach, expect, it } from 'vitest';
import { EncryptedFiles } from '../src/crypto/vault';
import { SyncEngine } from '../src/sync/engine';
import { Journal } from '../src/domain/journal';
import { LocalStore } from '../src/storage/local';
import { addDay, MemoryCloud } from './helpers';

const PASSWORD = 'four random words remembered';
const PATH = `/days/2026-10-24/${crypto.randomUUID()}.automerge`;
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const journals: Journal[] = [];
async function device() {
  const local = await LocalStore.open(crypto.randomUUID());
  const journal = new Journal(local, crypto.randomUUID());
  journals.push(journal);
  await journal.load();
  await addDay(journal, '2026-10-24');
  return journal;
}
afterEach(() => journals.splice(0).forEach(journal => { journal.close(); journal.local.close(); }));

it('encrypts paths and bytes, restores with the password, and uses a fresh nonce on every write', async () => {
  const cloud = new MemoryCloud();
  const vault = await EncryptedFiles.create(cloud, PASSWORD);
  await vault.upload(PATH, bytes('A private memory.'));
  const name = [...cloud.files.keys()].find(path => path !== '/vault.json')!;
  const first = cloud.files.get(name)!.bytes.slice();
  expect(name).toMatch(/^\/objects\/[a-f0-9]+\.bin$/);
  expect(name.split('/').at(-1)!.length).toBeLessThan(255);
  expect(text(first)).not.toContain('A private memory.');
  expect([...cloud.files.keys()].join()).not.toContain('2026-10-24');
  expect(text(cloud.files.get('/vault.json')!.bytes)).not.toContain(PASSWORD);
  await vault.upload(PATH, bytes('A private memory.'));
  expect(cloud.files.get(name)!.bytes).not.toEqual(first);
  expect(cloud.files.size).toBe(2);
  const other = await EncryptedFiles.unlock(cloud, (await EncryptedFiles.inspect(cloud))!, PASSWORD);
  expect((await other.list())[0].path).toBe(PATH);
  expect(text(await other.download(PATH))).toBe('A private memory.');
});

it('rejects wrong passwords and damaged headers without changing any cloud data', async () => {
  const cloud = new MemoryCloud();
  await EncryptedFiles.create(cloud, PASSWORD);
  const original = cloud.files.get('/vault.json')!.bytes.slice();
  const header = (await EncryptedFiles.inspect(cloud))!;
  await expect(EncryptedFiles.unlock(cloud, header, 'wrong password')).rejects.toThrow('Could not unlock');
  expect(cloud.files.get('/vault.json')!.bytes).toEqual(original);
  await cloud.upload('/vault.json', bytes(JSON.stringify({ ...header, version: 99, memorySize: 2 ** 40 })));
  await expect(EncryptedFiles.inspect(cloud)).rejects.toThrow('Unsupported');
  cloud.files.delete('/vault.json'); await cloud.upload('/objects/orphan.bin', bytes('orphan'));
  await expect(EncryptedFiles.create(cloud, PASSWORD)).rejects.toThrow('no vault header');
});

it('detects changed contents, swapped ciphertext, and modified encrypted names', async () => {
  const cloud = new MemoryCloud();
  const vault = await EncryptedFiles.create(cloud, PASSWORD);
  await vault.upload(PATH, bytes('first'));
  const photo = `/photos/${crypto.randomUUID()}.jpg`;
  await vault.upload(photo, bytes('second'));
  await vault.list();
  const names = [...cloud.files.keys()].filter(path => path !== '/vault.json');
  const original = cloud.files.get(names[0])!.bytes.slice();
  await cloud.upload(names[0], cloud.files.get(names[1])!.bytes);
  await expect(vault.download(PATH)).rejects.toThrow('verified');
  const corrupted = original.slice(); corrupted[20] ^= 1;
  await cloud.upload(names[0], corrupted);
  await expect(vault.download(PATH)).rejects.toThrow('verified');
  cloud.files.delete(names[0]);
  const renamed = names[0].replace('/objects/', '/objects/00');
  await cloud.upload(renamed, original);
  await expect(vault.list()).rejects.toThrow('filename');
});

it('creates one vault when devices race, and never replaces a vault with a different password', async () => {
  const cloud = new MemoryCloud();
  const [first, second] = await Promise.all([
    EncryptedFiles.create(cloud, PASSWORD), EncryptedFiles.create(cloud, PASSWORD),
  ]);
  expect(first.descriptor).toBe(second.descriptor);
  await first.upload(PATH, bytes('shared memory'));
  await second.list();
  expect(text(await second.download(PATH))).toBe('shared memory');
  const header = cloud.files.get('/vault.json')!.bytes.slice();
  await expect(EncryptedFiles.create(cloud, 'a different long password')).rejects.toThrow('Could not unlock');
  expect(cloud.files.get('/vault.json')!.bytes).toEqual(header);
  const fresh = new MemoryCloud();
  const attempts = await Promise.allSettled([
    EncryptedFiles.create(fresh, PASSWORD), EncryptedFiles.create(fresh, 'another unrelated password'),
  ]);
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(fresh.files.size).toBe(1);
});

it('stores a non-exportable remembered key and requires an exact vault match', async () => {
  const cloud = new MemoryCloud();
  const vault = await EncryptedFiles.create(cloud, PASSWORD);
  const journal = await device();
  await journal.local.setSetting('key', { descriptor: vault.descriptor, key: vault.key });
  const saved = await journal.local.setting<{ descriptor: string; key: CryptoKey }>('key');
  const header = (await EncryptedFiles.inspect(cloud))!;
  const restored = EncryptedFiles.remembered(cloud, header, saved)!;
  await expect(crypto.subtle.exportKey('raw', restored.key)).rejects.toThrow();
  await restored.upload(PATH, bytes('restored'));
  expect(EncryptedFiles.remembered(cloud, { ...header, id: crypto.randomUUID() }, saved)).toBeUndefined();
  cloud.files.delete('/vault.json');
  await expect(restored.list()).rejects.toThrow('no vault header');
});

it('converges offline edits and photos through encrypted storage', async () => {
  const cloud = new MemoryCloud();
  const firstVault = await EncryptedFiles.create(cloud, PASSWORD);
  const secondVault = await EncryptedFiles.unlock(cloud, (await EncryptedFiles.inspect(cloud))!, PASSWORD);
  const phone = await device(); const laptop = await device();
  const first = new SyncEngine(phone, firstVault); const second = new SyncEngine(laptop, secondVault);
  const photo = `${crypto.randomUUID()}.jpg`;
  await phone.local.savePhoto(photo, new Blob(['private photo']));
  await phone.edit('2026-10-24', `Phone memory. ![Photo](photos/${photo})`);
  await laptop.edit('2026-10-24', 'Laptop memory.');
  await Promise.all([first.sync(), second.sync()]);
  await first.sync(); await second.sync();
  expect(phone.days.get('2026-10-24')!.text).toBe(laptop.days.get('2026-10-24')!.text);
  expect(phone.days.get('2026-10-24')!.text).toContain('Laptop memory.');
  expect(await (await laptop.local.photo(photo))!.text()).toBe('private photo');
});

it('encrypts deletion records and removes all opaque copies of a concurrently uploaded photo', async () => {
  const cloud = new MemoryCloud();
  const first = await EncryptedFiles.create(cloud, PASSWORD);
  const second = await EncryptedFiles.unlock(cloud, (await EncryptedFiles.inspect(cloud))!, PASSWORD);
  const name = `${crypto.randomUUID()}.jpg`, path = `/photos/${name}`;
  await first.list(); await second.list();
  await first.upload(path, bytes('photo')); await second.upload(path, bytes('photo'));
  expect(cloud.files.size).toBe(3); // Header and two different encrypted names.
  await first.list();
  await first.upload(`/deleted-photos/${name}.json`, bytes(JSON.stringify({ version: 1, photos: [name] })));
  await first.remove(path);
  expect(cloud.files.size).toBe(2); // Only the header and encrypted deletion record.
  const listed = await second.list();
  expect(listed.map(file => file.path)).toEqual([`/deleted-photos/${name}.json`]);
  for (const [opaque, contents] of cloud.files) {
    expect(opaque).not.toContain(name);
    expect(text(contents.bytes)).not.toContain(name);
  }
  await first.remove(path); // Already absent is a successful removal.
});
