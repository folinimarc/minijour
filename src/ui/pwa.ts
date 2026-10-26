import { registerSW } from 'virtual:pwa-register';
import type { Journal } from '../domain/journal';
import type { JournalUI } from './shell';

/** Browser installation and service-worker updates stay outside journal logic. */
export function setupPwa(ui: JournalUI, journal: Journal, notify: (error: unknown) => void): void {
  // Updates wait for a reload: replacing an open editor while typing is unsafe.
  const updateSW = registerSW({ onNeedRefresh() { ui.update.hidden = false; }, onRegisterError: () => {
    notify('Offline installation did not finish. Keep this tab open and try reloading when online.');
  } });
  ui.update.onclick = () => { void journal.flush().then(() => updateSW(true)).catch(notify); };
  type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    const install = event as InstallPrompt;
    ui.install.hidden = false;
    ui.install.onclick = () => { void install.prompt().then(() => install.userChoice).then(() => { ui.install.hidden = true; }).catch(notify); };
  });
}
