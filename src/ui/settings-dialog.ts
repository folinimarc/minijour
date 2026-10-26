import type { JournalUI } from './shell';
import type { JournalView } from './journal-view';

/** Own the settings modal and return focus before the next user action. */
export function setupSettingsDialog(ui: JournalUI, view: JournalView, closePhotoMenu: () => void): void {
  ui.settingsButton.onclick = () => {
    closePhotoMenu();
    ui.dialog.append(ui.notice); ui.dialog.showModal();
  };
  ui.statusButton.onclick = () => { ui.settingsButton.click(); ui.dialog.scrollTop = 0; };
  // Return to writing immediately; a queued close event must not steal later focus.
  const closeSettings = () => {
    ui.dialog.close(); document.body.append(ui.notice);
    view.focusActive();
  };
  ui.closeSettings.onclick = closeSettings;
  ui.dialog.oncancel = event => { event.preventDefault(); closeSettings(); };
  ui.dialog.addEventListener('click', event => {
    if (event.target !== ui.dialog || !event.clientX) return;
    const box = ui.dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeSettings();
  });
}
