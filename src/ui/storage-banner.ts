import type { LocalStore } from '../storage/local';
import type { JournalUI } from './shell';

const DISMISSED = 'local-storage-banner-dismissed';

/** Local advice, dismissed on this browser only and excluded from backups. */
export async function setupStorageBanner(
  ui: JournalUI, local: LocalStore, hasProviders: boolean,
  notify: (error: unknown) => void,
): Promise<(connected: boolean) => void> {
  let dismissed = await local.setting<boolean>(DISMISSED).catch(() => false) === true;
  let connected = false;
  const render = () => { ui.storageBanner.hidden = dismissed || connected; };
  ui.storageAdvice.textContent = hasProviders
    ? 'Connect your own cloud for encrypted backup and sync in'
    : 'Keep a copy by downloading a backup in';
  ui.storageSettings.onclick = () => ui.settingsButton.click();
  ui.dismissStorageBanner.onclick = () => {
    ui.dismissStorageBanner.disabled = true;
    void local.setSetting(DISMISSED, true).then(() => {
      dismissed = true;
      render();
      ui.settingsButton.focus({ preventScroll: true });
    }).catch(notify).finally(() => { ui.dismissStorageBanner.disabled = false; });
  };
  // Wait until connection lookup finishes before showing local-only advice.
  return value => { connected = value; render(); };
}
