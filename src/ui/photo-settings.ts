import { isPhotoOptions } from '../domain/photos';
import type { Journal } from '../domain/journal';
import type { JournalUI } from './shell';

/** Journal preferences affect new photos; existing photo bytes never change. */
export function setupPhotoSettings(ui: JournalUI, journal: Journal, notify: (error: unknown) => void): (connected: boolean) => void {
  let working = false;
  let deferred = false;
  const show = () => {
    if (working) return;
    const options = journal.photoOptions;
    ui.optimizePhotos.checked = options.optimize;
    ui.optimizePhotos.disabled = false;
    ui.photoMaxDimension.value = String(options.maxDimension);
    ui.photoMaxDimension.disabled = !options.optimize;
    ui.photoOptionsHelp.textContent = options.optimize
      ? 'Resize larger photos and save as JPEG at 85% quality. Applies to new photos.'
      : 'Keep original files unchanged, including metadata. Applies to new photos. Some formats may need downloading to view.';
  };
  const save = async () => {
    if (working) return;
    const next = {
      optimize: ui.optimizePhotos.checked,
      maxDimension: ui.optimizePhotos.checked ? ui.photoMaxDimension.valueAsNumber : journal.photoOptions.maxDimension,
    };
    if (!isPhotoOptions(next)) { ui.photoMaxDimension.reportValidity(); return; }
    working = true;
    ui.optimizePhotos.disabled = true; ui.photoMaxDimension.disabled = true;
    try { await journal.setPhotoOptions(next); }
    catch (error) { notify(error); }
    finally { working = false; show(); }
  };
  ui.optimizePhotos.onchange = () => { void save(); };
  ui.photoMaxDimension.onchange = () => { void save(); };
  ui.photoMaxDimension.onblur = () => { if (deferred) { deferred = false; show(); } };
  journal.subscribe(event => {
    // Incoming preferences must not replace an unfinished numeric edit.
    if (!event.preferences) return;
    if (document.activeElement === ui.photoMaxDimension) deferred = true;
    else show();
  });
  const refresh = async () => {
    ui.optimizePhotos.disabled = true; ui.photoMaxDimension.disabled = true;
    try { await journal.refreshPreferences(); }
    catch (error) { notify(error); }
    finally { show(); }
  };
  ui.settingsButton.addEventListener('click', () => { void refresh(); });
  ui.dialog.addEventListener('close', show);
  show();
  return connected => {
    ui.photoOptionsScope.textContent = connected
      ? 'Syncs across your devices when cloud access is unlocked and online.'
      : 'Saved with your journal on this device.';
  };
}
