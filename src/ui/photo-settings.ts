import { DEFAULT_PHOTO_OPTIONS, isPhotoOptions, type PhotoOptions } from '../domain/photos';
import type { LocalStore } from '../storage/local';
import type { mountShell } from './shell';

const OPTIONS = 'photo-options';
export async function loadPhotoOptions(local: LocalStore): Promise<PhotoOptions> {
  const saved = await local.setting<unknown>(OPTIONS);
  return isPhotoOptions(saved) ? saved : { ...DEFAULT_PHOTO_OPTIONS };
}

/** Device preferences affect new uploads; existing photo bytes never change. */
export async function setupPhotoSettings(ui: ReturnType<typeof mountShell>, local: LocalStore, notify: (error: unknown) => void): Promise<void> {
  let options = await loadPhotoOptions(local);
  const show = () => {
    ui.optimizePhotos.checked = options.optimize;
    ui.optimizePhotos.disabled = false;
    ui.photoMaxDimension.value = String(options.maxDimension);
    ui.photoMaxDimension.disabled = !options.optimize;
    ui.photoOptionsHelp.textContent = options.optimize
      ? 'Resize larger photos and save as JPEG at 85% quality. Applies to new photos on this device.'
      : 'Keep original files unchanged, including metadata. Applies to new photos on this device. Some formats may need downloading to view.';
  };
  const save = async () => {
    const next = {
      optimize: ui.optimizePhotos.checked,
      maxDimension: ui.optimizePhotos.checked ? ui.photoMaxDimension.valueAsNumber : options.maxDimension,
    };
    if (!isPhotoOptions(next)) { ui.photoMaxDimension.reportValidity(); return; }
    ui.optimizePhotos.disabled = true; ui.photoMaxDimension.disabled = true;
    try { await local.setSetting(OPTIONS, next); options = next; }
    catch (error) { notify(error); }
    finally { show(); }
  };
  ui.optimizePhotos.onchange = () => { void save(); };
  ui.photoMaxDimension.onchange = () => { void save(); };
  ui.settingsButton.addEventListener('click', () => { void (async () => {
    ui.optimizePhotos.disabled = true; ui.photoMaxDimension.disabled = true;
    try { options = await loadPhotoOptions(local); }
    catch (error) { notify(error); }
    finally { show(); }
  })(); });
  ui.dialog.addEventListener('close', show);
  show();
}
