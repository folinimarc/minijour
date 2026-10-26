import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import * as A from '@automerge/automerge';
import { loadDay } from '../domain/day';
import { mergeDocuments } from '../domain/documents';
import { loadPreferences } from '../domain/preferences';
import { PHOTO_NAME, referencedPhotos } from '../domain/photos';

export const VAULT_KEY_SETTING = 'cloud-vault-key';
const PHOTO_DELETIONS = 'photo-deletions-v1';
const CLOUD_OWNER = 'cloud-journal-owner';
const PREFERENCES = 'journal-preferences';
export type CloudIdentity = { providerId: string; appId: string; accountId: string };

// Dropbox uses its original storage key; other adapters use a provider prefix.
const connectionKey = (providerId: string) => providerId === 'dropbox' ? 'dropbox-connection' : `cloud-connection:${providerId}`;

interface Database extends DBSchema {
  days: { key: string; value: Uint8Array };
  photos: { key: string; value: Blob };
  settings: { key: string; value: unknown };
}

/** IndexedDB is the durable on-device copy. Credentials and keys stay here;
 * backups explicitly include permanent photo deletion metadata. */
export class LocalStore {
  private constructor(private db: IDBPDatabase<Database>) {}

  static async open(name = 'minijour-v1'): Promise<LocalStore> {
    const db = await openDB<Database>(name, 1, {
      upgrade(db) {
        db.createObjectStore('days');
        db.createObjectStore('photos');
        db.createObjectStore('settings');
      },
    });
    return new LocalStore(db);
  }

  async days(): Promise<Map<string, Uint8Array>> {
    const tx = this.db.transaction('days');
    const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
    await tx.done;
    return new Map(keys.map((key, i) => [key, values[i]]));
  }

  async saveDay(date: string, bytes: Uint8Array): Promise<Uint8Array> {
    // A read/write transaction serializes different tabs. Each save merges with
    // what is already on disk, so a stale tab cannot overwrite another's work.
    const incoming = loadDay(bytes);
    const tx = this.db.transaction('days', 'readwrite');
    const existing = await tx.store.get(date);
    const merged = existing ? mergeDocuments(loadDay(existing), incoming) : incoming;
    const saved = A.save(merged);
    await tx.store.put(saved, date);
    await tx.done;
    return saved;
  }

  async preferences(): Promise<Uint8Array | undefined> { return this.setting<Uint8Array>(PREFERENCES); }
  async savePreferences(bytes: Uint8Array): Promise<Uint8Array> {
    const incoming = loadPreferences(bytes);
    const tx = this.db.transaction('settings', 'readwrite');
    const existing = await tx.store.get(PREFERENCES) as Uint8Array | undefined;
    const merged = existing ? mergeDocuments(loadPreferences(existing), incoming) : incoming;
    const saved = A.save(merged);
    await tx.store.put(saved, PREFERENCES);
    await tx.store.delete('photo-options');
    await tx.done;
    return saved;
  }

  async photoNames(): Promise<string[]> { return this.db.getAllKeys('photos'); }
  async photo(name: string): Promise<Blob | undefined> { return this.db.get('photos', name); }
  async savePhoto(name: string, blob: Blob): Promise<boolean> {
    const tx = this.db.transaction(['photos', 'settings'], 'readwrite');
    const deleted = await tx.objectStore('settings').get(PHOTO_DELETIONS) as string[] | undefined;
    if (deleted?.includes(name)) { await tx.done; return false; }
    await tx.objectStore('photos').put(blob, name);
    await tx.done;
    return true;
  }
  async photoDeletions(): Promise<Set<string>> {
    return new Set(await this.setting<string[]>(PHOTO_DELETIONS));
  }

  async deletePhotos(names: Iterable<string>, options: { onlyUnused?: boolean } = {}): Promise<string[]> {
    const candidates = [...new Set(names)];
    if (!candidates.every(name => PHOTO_NAME.test(name))) throw new Error('Invalid photo name.');
    // Serialize with photo saves AND edits in other tabs. A reference added
    // after the confirmation opened must still protect that photo at deletion.
    const tx = this.db.transaction(['photos', 'settings', 'days'], 'readwrite');
    const settings = tx.objectStore('settings');
    const deleted = new Set(await settings.get(PHOTO_DELETIONS) as string[] | undefined);
    const references = options.onlyUnused
      ? referencedPhotos((await tx.objectStore('days').getAll()).map(bytes => loadDay(bytes).text)) : new Set<string>();
    const changed: string[] = [];
    for (const name of candidates) {
      if (references.has(name)) continue;
      const photo = await tx.objectStore('photos').get(name);
      if (!deleted.has(name) || photo) changed.push(name);
      deleted.add(name);
      await tx.objectStore('photos').delete(name);
    }
    if (changed.length) await settings.put([...deleted].sort(), PHOTO_DELETIONS);
    await tx.done;
    return changed;
  }
  async setting<T>(key: string): Promise<T | undefined> {
    return await this.db.get('settings', key) as T | undefined;
  }
  async setSetting(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('settings', 'readwrite');
    await tx.store.put(value, key);
    await tx.done;
  }
  async removeSetting(key: string): Promise<void> {
    const tx = this.db.transaction('settings', 'readwrite');
    await tx.store.delete(key);
    await tx.done;
  }

  async rememberVaultKey(value: unknown): Promise<void> {
    // A password derivation can finish after another tab disconnects. Check
    // the connection and save in one transaction, so it cannot restore a key.
    const tx = this.db.transaction('settings', 'readwrite');
    const owner = await tx.store.get(CLOUD_OWNER) as CloudIdentity | undefined;
    if (!owner || !await tx.store.get(connectionKey(owner.providerId))) {
      await tx.done;
      throw new Error('Cloud storage was disconnected. Reconnect before remembering the cloud key.');
    }
    await tx.store.put(value, VAULT_KEY_SETTING);
    await tx.done;
  }

  async cloudOwner(): Promise<CloudIdentity | undefined> {
    return this.setting<CloudIdentity>(CLOUD_OWNER);
  }

  async cloudConnection<T>(providerId: string): Promise<T | undefined> {
    return this.setting<T>(connectionKey(providerId));
  }

  async disconnectCloud(providerId: string): Promise<void> {
    const tx = this.db.transaction('settings', 'readwrite');
    await tx.store.delete(connectionKey(providerId));
    await tx.store.delete(VAULT_KEY_SETTING);
    await tx.done;
  }

  async saveCloudConnection(
    identity: CloudIdentity, connection: unknown, options: { requireExisting?: boolean } = {},
  ): Promise<void> {
    // Keep ownership after disconnect. Check and bind in ONE transaction so
    // concurrent authorization in two tabs cannot associate two accounts.
    const tx = this.db.transaction('settings', 'readwrite');
    const owner = await tx.store.get(CLOUD_OWNER) as CloudIdentity | undefined;
    const previous = await tx.store.get(connectionKey(identity.providerId));
    if (options.requireExisting && !previous) {
      await tx.done;
      throw new Error('Cloud storage was disconnected. Reconnect to continue syncing.');
    }
    if (owner && (owner.providerId !== identity.providerId || owner.accountId !== identity.accountId || owner.appId !== identity.appId)) {
      await tx.done;
      throw new Error('This journal belongs to a different cloud provider, account, or app. Reconnect the original account, or use a separate browser profile for another journal. Your entries have not been uploaded.');
    }
    await tx.store.put(identity, CLOUD_OWNER);
    await tx.store.put(connection, connectionKey(identity.providerId));
    await tx.done;
  }
  close(): void { this.db.close(); }
}
