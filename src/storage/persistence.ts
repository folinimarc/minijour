import type { LocalStore } from './local';

/** Ask once, after a successful save. Protection never prevents manual clearing. */
export function protectStorage(local: LocalStore): () => void {
  let attempted = false;
  return () => {
    if (attempted) return;
    attempted = true;
    void (async () => {
      const storage = navigator.storage;
      if (typeof storage?.persist !== 'function' || typeof storage.persisted !== 'function') return;
      if (await local.setting<boolean>('storage-persistence-requested')) return;
      await local.setSetting('storage-persistence-requested', true);
      if (!await storage.persisted()) await storage.persist();
    })().catch(() => { /* Persistence is optional; ordinary saves still work. */ });
  };
}
