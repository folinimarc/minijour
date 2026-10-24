import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import * as A from '@automerge/automerge';
import { loadDay, mergeDays } from '../domain/day';

export type Photo = { name: string; blob: Blob };

interface Database extends DBSchema {
  days: { key: string; value: Uint8Array };
  photos: { key: string; value: Blob };
  settings: { key: string; value: unknown };
}

/** IndexedDB is the durable, on-device copy. Settings are never exported. */
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
  async savePhoto(name: string, blob: Blob): Promise<void> {
    const tx = this.db.transaction('photos', 'readwrite');
    await tx.store.put(blob, name);
    await tx.done;
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

  async saveDropboxConnection<T extends { appKey: string; accountId: string }>(connection: T): Promise<void> {
    // Keep ownership after disconnect. Check and bind in ONE transaction so
    // concurrent authorization in two tabs cannot associate two accounts.
    const tx = this.db.transaction('settings', 'readwrite');
    const owner = await tx.store.get('dropbox-journal-owner') as { appKey: string; accountId: string } | undefined;
    const previous = await tx.store.get('dropbox-connection') as { appKey: string; accountId: string } | undefined;
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
