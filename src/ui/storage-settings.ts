import type { Journal } from '../domain/journal';
import type { mountShell } from './shell';

const NOTICE_SHOWN = 'storage-persistence-notice-shown';
const REQUESTED = 'storage-persistence-requested';
const ADVICE = 'Your journal is saved on this device, but the browser may clear it to free space. Keep a downloaded backup or enable cloud sync.';
type Protection = 'protected' | 'unprotected' | 'unsupported' | 'unknown';

/** Persistence protects against automatic eviction; ordinary saves still use IndexedDB. */
export async function setupStorageSettings(
  ui: ReturnType<typeof mountShell>, journal: Journal, notify: (message: string) => void,
) {
  const storage = navigator.storage;
  const supported = typeof storage?.persist === 'function' && typeof storage?.persisted === 'function';
  let protection: Protection = supported ? 'unknown' : 'unsupported';
  let working = false;
  let attempted = false;
  let checkVersion = 0;
  const show = () => {
    ui.storageStatus.textContent = protection === 'protected' ? 'Protected from automatic cleanup'
      : protection === 'unprotected' ? 'Not protected from automatic cleanup'
      : protection === 'unsupported' ? 'Storage protection is not supported in this browser'
      : 'Could not check storage protection';
    ui.storageHelp.textContent = protection === 'protected'
      ? 'Clearing browser data still removes your journal. Keep a backup even when storage is protected.'
      : 'Writing still saves in this browser. Keep a downloaded backup or enable cloud sync. Your browser decides whether to grant storage protection.';
    ui.requestStorage.hidden = !supported || protection === 'protected';
    ui.requestStorage.disabled = working;
    ui.requestStorage.textContent = working ? 'Requesting…' : 'Request persistent storage';
  };
  const refresh = async () => {
    if (!supported || working) return;
    const version = ++checkVersion;
    let result: Protection;
    try { result = await storage.persisted() ? 'protected' : 'unprotected'; }
    catch { result = 'unknown'; }
    if (version !== checkVersion) return;
    protection = result;
    show();
  };
  const request = async (automatic: boolean) => {
    if (working) return;
    working = true; checkVersion++; show();
    try {
      // After a declined request, let the person choose when to retry.
      if (automatic && await journal.local.setting<boolean>(REQUESTED)) return;
      await journal.local.setSetting(REQUESTED, true);
      const shown = await journal.local.setting<boolean>(NOTICE_SHOWN);
      if (supported) {
        try {
          const granted = await storage.persisted() || await storage.persist();
          protection = granted ? 'protected' : 'unprotected';
        }
        catch { protection = 'unknown'; }
      }
      if (protection !== 'protected' && !shown && !journal.saveError && ui.notice.hidden) {
        notify(ADVICE);
        await journal.local.setSetting(NOTICE_SHOWN, true);
      }
    } finally { working = false; show(); }
  };
  // Preference failures must not replace a real journal save error.
  const runRequest = (automatic: boolean) => { void request(automatic).catch(() => { protection = 'unknown'; show(); }); };
  ui.requestStorage.onclick = () => runRequest(false);
  show(); await refresh();
  return {
    refresh,
    afterEdit: () => {
      if (attempted || protection === 'protected') return;
      attempted = true;
      runRequest(true);
    },
  };
}
