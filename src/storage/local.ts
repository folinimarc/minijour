import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import * as A from '@automerge/automerge';
import { loadDay, mergeDays } from '../domain/day';
import { PHOTO_NAME, referencedPhotos } from '../domain/photos';

export type Photo = { name: string; blob: Blob };
export const VAULT_KEY_SETTING = 'cloud-vault-key';
const PHOTO_DELETIONS = 'photo-deletions-v1';

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
    const merged = existing ? mergeDays(loadDay(existing), incoming) : incoming;
    const saved = A.save(merged);
    await tx.store.put(saved, date);
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
    if (!await tx.store.get('dropbox-connection')) {
      await tx.done;
      throw new Error('Dropbox was disconnected. Reconnect before remembering the cloud key.');
    }
    await tx.store.put(value, VAULT_KEY_SETTING);
    await tx.done;
  }

  async disconnectDropbox(): Promise<void> {
    const tx = this.db.transaction('settings', 'readwrite');
    await tx.store.delete('dropbox-connection');
    await tx.store.delete(VAULT_KEY_SETTING);
    await tx.done;
  }

  async saveDropboxConnection<T extends { appKey: string; accountId: string }>(
    connection: T, options: { requireExisting?: boolean } = {},
  ): Promise<void> {
    // Keep ownership after disconnect. Check and bind in ONE transaction so
    // concurrent authorization in two tabs cannot associate two accounts.
    const tx = this.db.transaction('settings', 'readwrite');
    const owner = await tx.store.get('dropbox-journal-owner') as { appKey: string; accountId: string } | undefined;
    const previous = await tx.store.get('dropbox-connection') as { appKey: string; accountId: string } | undefined;
    if (options.requireExisting && !previous) {
      await tx.done;
      throw new Error('Dropbox was disconnected. Reconnect to continue syncing.');
    }
    const bound = owner ?? previous; // Preserve connections made by older builds.
    if (bound && (bound.accountId !== connection.accountId || bound.appKey !== connection.appKey)) {
      await tx.done;
      throw new Error('This journal belongs to a different Dropbox account or app. Reconnect the original account, or use a separate browser profile for another journal. Your entries have not been uploaded.');
    }
    await tx.store.put({ appKey: connection.appKey, accountId: connection.accountId }, 'dropbox-journal-owner');
    await tx.store.put(connection, 'dropbox-connection');
    await tx.done;
  }
  close(): void { this.db.close(); }
}
