import type { Journal } from '../domain/journal';
import { unusedPhotos, type UnusedPhoto } from '../storage/photo-cleanup';
import type { mountShell } from './shell';

/** Explicit review/confirm keeps ordinary Markdown editing reversible. */
export function setupPhotoCleanup(
  ui: ReturnType<typeof mountShell>, journal: Journal,
  options: {
    cloudBusy: () => boolean; cloudReady: () => boolean;
    sync: () => Promise<void>; busy: (value: boolean) => void; notify: (error: unknown) => void;
  },
): void {
  let plan: UnusedPhoto[] | undefined;
  let working = false;
  const reset = () => { plan = undefined; ui.photoCleanupReview.hidden = true; };
  ui.cancelPhotoCleanup.onclick = reset;
  ui.dialog.addEventListener('close', reset);

  const prepare = async () => {
    if (options.cloudBusy()) throw new Error('Wait for the current Dropbox operation to finish before cleaning up photos.');
    const bound = await journal.local.setting('dropbox-journal-owner') || await journal.local.setting('dropbox-connection');
    if (!bound) return;
    if (!navigator.onLine) throw new Error('Go online before cleaning up a journal linked to Dropbox. Other devices may have photo references to keep.');
    if (!options.cloudReady()) throw new Error('Connect and unlock your original Dropbox account before cleaning up photos.');
    await options.sync(); // Failure must prevent deletion, not silently use stale data.
  };
  const run = async (action: () => Promise<void>) => {
    if (working) return;
    working = true; options.busy(true);
    ui.reviewPhotos.disabled = true; ui.confirmPhotoCleanup.disabled = true;
    try { await action(); } catch (error) { options.notify(error); }
    finally {
      working = false; options.busy(false);
      ui.reviewPhotos.disabled = false; ui.confirmPhotoCleanup.disabled = false;
    }
  };
  ui.reviewPhotos.onclick = () => { void run(async () => {
    reset(); ui.notice.hidden = true;
    await prepare();
    const candidates = await unusedPhotos(journal);
    if (!ui.dialog.open) return;
    if (!candidates.length) { options.notify('No unused photos found.'); return; }
    plan = candidates;
    const bytes = candidates.reduce((total, photo) => total + photo.size, 0);
    const size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    ui.photoCleanupSummary.textContent = `${candidates.length} unused ${candidates.length === 1 ? 'photo' : 'photos'} · ${size} on this device.`;
    ui.photoCleanupReview.hidden = false;
    ui.photoCleanupReview.scrollIntoView({ block: 'nearest' });
    ui.confirmPhotoCleanup.focus();
  }); };
  ui.confirmPhotoCleanup.onclick = () => {
    const selected = plan;
    if (!selected) return;
    void run(async () => {
      ui.notice.hidden = true;
      await prepare();
      // Cancel/closing settings while the preflight sync was waiting must
      // cancel this plan. Once committing starts, hide the old confirmation.
      if (plan !== selected || !ui.dialog.open) return;
      reset();
      // Only delete the reviewed IDs; new references are checked transactionally.
      const removed = await journal.deletePhotos(selected.map(photo => photo.name), { onlyUnused: true });
      try { if (options.cloudReady()) await options.sync(); }
      catch {
        options.notify('Photos were removed on this device. Dropbox cleanup is pending and will retry when sync succeeds.');
        return;
      }
      options.notify(removed.length ? `Permanently removed ${removed.length} unused ${removed.length === 1 ? 'photo' : 'photos'}.`
        : 'No photos removed. They are now referenced or were already cleaned up.');
    });
  };
}
