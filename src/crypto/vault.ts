import { argon2id } from 'hash-wasm';
import type { CloudFiles, VaultStorage, RemoteFile } from '../sync/cloud';

// Version 1 deliberately fixes the KDF cost. Untrusted cloud metadata cannot
// ask the browser to allocate arbitrary memory or perform unbounded work.
type Header = { version: 1; id: string; salt: string; wrappedKey: string };
export type RememberedVault = { descriptor: string; key: CryptoKey };
const HEADER = '/vault.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const logicalPath = /^\/(?:days\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]{36}\.automerge|photos\/[a-f0-9-]{36}\.jpg|deleted-photos\/[a-f0-9-]{36}\.jpg\.json)$/;
const objectPath = /^\/objects\/([a-f0-9]{2,240})\.bin$/;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f0-9]{2})+$/.test(value)) throw new Error('Invalid encrypted journal format.');
  return Uint8Array.from(value.match(/../g)!, pair => parseInt(pair, 16));
}
function aad(id: string, purpose: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`minijour:v1:${id}:${purpose}`);
}
async function encrypt(key: CryptoKey, bytes: Uint8Array, context: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: context }, key, new Uint8Array(bytes),
  ));
  const result = new Uint8Array(iv.length + ciphertext.length);
  result.set(iv); result.set(ciphertext, iv.length);
  return result;
}
async function decrypt(key: CryptoKey, bytes: Uint8Array, context: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (bytes.length < 28) throw new Error('Encrypted file is incomplete.');
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(bytes.slice(0, 12)), additionalData: context }, key, new Uint8Array(bytes.slice(12)),
  ));
}
async function passwordKey(password: string, salt: string): Promise<CryptoKey> {
  const bytes = await argon2id({ password, salt: unhex(salt), iterations: 3,
    memorySize: 65536, parallelism: 1, hashLength: 32, outputType: 'binary' });
  try { return await crypto.subtle.importKey('raw', new Uint8Array(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']); }
  finally { bytes.fill(0); }
}

/** Encrypts the file contract; the sync engine only sees ordinary logical paths.
 * Password -> Argon2id -> wrapping key -> random 256-bit journal key.
 * AES-GCM authenticates each filename and file, with separate purposes as AAD.
 * Hex names survive Dropbox's lowercased paths. No dates appear in cloud names.
 */
export class EncryptedFiles implements CloudFiles {
  private names = new Map<string, string[]>();
  readonly descriptor: string;
  private constructor(private cloud: VaultStorage, private header: Header, readonly key: CryptoKey) {
    this.descriptor = JSON.stringify(header);
  }

  static async inspect(cloud: VaultStorage, files?: RemoteFile[]): Promise<Header | undefined> {
    files ??= await cloud.list();
    if (!files.some(file => file.path === HEADER)) {
      if (files.length) throw new Error('The encrypted Dropbox folder has no vault header. Restore its vault.json before syncing.');
      return undefined;
    }
    const bytes = await cloud.download(HEADER);
    if (bytes.length > 2048) throw new Error('Invalid encrypted journal header.');
    const header = JSON.parse(decoder.decode(bytes)) as Header;
    if (header?.version !== 1 || !/^[a-f0-9-]{36}$/.test(header.id)
      || !/^[a-f0-9]{32}$/.test(header.salt) || !/^[a-f0-9]{120}$/.test(header.wrappedKey)) {
      throw new Error('Unsupported or damaged encrypted journal header.');
    }
    return header;
  }

  static async unlock(cloud: VaultStorage, header: Header, password: string): Promise<EncryptedFiles> {
    const wrappingKey = await passwordKey(password, header.salt);
    let raw: Uint8Array;
    try { raw = await decrypt(wrappingKey, unhex(header.wrappedKey), aad(header.id, `key:${header.salt}`)); }
    catch { throw new Error('Could not unlock Dropbox. Check your password; damaged encryption metadata can also cause this error.'); }
    try {
      const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
      return new EncryptedFiles(cloud, header, key);
    } finally { raw.fill(0); }
  }

  static remembered(cloud: VaultStorage, header: Header, saved?: RememberedVault): EncryptedFiles | undefined {
    if (saved?.descriptor !== JSON.stringify(header) || saved.key?.algorithm.name !== 'AES-GCM') return undefined;
    return new EncryptedFiles(cloud, header, saved.key);
  }

  static async create(cloud: VaultStorage, password: string): Promise<EncryptedFiles> {
    if (password.length < 12) throw new Error('Use at least 12 characters for your cloud password. A few random words work well.');
    const existing = await this.inspect(cloud);
    if (existing) return this.unlock(cloud, existing, password);
    const header: Header = { version: 1, id: crypto.randomUUID(),
      salt: hex(crypto.getRandomValues(new Uint8Array(16))), wrappedKey: '' };
    const wrappingKey = await passwordKey(password, header.salt);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    let key: CryptoKey;
    try {
      header.wrappedKey = hex(await encrypt(wrappingKey, raw, aad(header.id, `key:${header.salt}`)));
      key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    finally { raw.fill(0); }
    // Never overwrite the first device's key, including simultaneous setup and
    // retries after a response was lost. The winning header is authoritative.
    await cloud.create(HEADER, encoder.encode(JSON.stringify(header)));
    const winner = await this.inspect(cloud);
    if (!winner) throw new Error('Dropbox did not save the encryption header. Please try again.');
    if (JSON.stringify(winner) === JSON.stringify(header)) return new EncryptedFiles(cloud, winner, key);
    return this.unlock(cloud, winner, password);
  }

  async list(): Promise<RemoteFile[]> {
    const files = await this.cloud.list();
    const current = await EncryptedFiles.inspect(this.cloud, files);
    if (JSON.stringify(current) !== this.descriptor) throw new Error('The cloud encryption header changed. Lock cloud access and unlock again before syncing.');
    const names = new Map<string, string[]>();
    const result: RemoteFile[] = [];
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      if (file.path === HEADER) continue;
      const match = objectPath.exec(file.path);
      if (!match) throw new Error('Unexpected file in the encrypted journal folder. Sync stopped.');
      let path: string;
      try { path = decoder.decode(await decrypt(this.key, unhex(match[1]), aad(this.header.id, 'name'))); }
      catch { throw new Error('An encrypted filename could not be verified. Sync stopped; local entries are safe.'); }
      if (!logicalPath.test(path)) throw new Error('Invalid path inside an encrypted filename.');
      // Concurrent uploads of the same immutable photo can produce two opaque
      // names. Choose one consistently. Day writers always have distinct UUIDs.
      const copies = names.get(path);
      if (copies) { copies.push(file.path); continue; }
      names.set(path, [file.path]);
      result.push({ path, revision: file.revision });
    }
    this.names = names;
    return result;
  }

  async download(path: string): Promise<Uint8Array> {
    const name = this.names.get(path)?.[0];
    if (!name) throw new Error('Encrypted file was not listed. Retry sync.');
    try { return await decrypt(this.key, await this.cloud.download(name), aad(this.header.id, `file:${name}`)); }
    catch { throw new Error('An encrypted file could not be downloaded or verified. Sync stopped; local entries are safe.'); }
  }

  async upload(path: string, bytes: Uint8Array): Promise<RemoteFile> {
    if (!logicalPath.test(path)) throw new Error('Unsupported journal file path.');
    let name = this.names.get(path)?.[0];
    if (!name) {
      name = `/objects/${hex(await encrypt(this.key, encoder.encode(path), aad(this.header.id, 'name')))}.bin`;
      this.names.set(path, [name]);
    }
    const result = await this.cloud.upload(name, await encrypt(this.key, bytes, aad(this.header.id, `file:${name}`)));
    return { path, revision: result.revision };
  }

  async remove(path: string): Promise<void> {
    // A photo can have several opaque names after simultaneous first uploads.
    // Removing only the selected download copy would leave the others behind.
    for (const name of this.names.get(path) ?? []) await this.cloud.remove(name);
    this.names.delete(path);
  }
}
