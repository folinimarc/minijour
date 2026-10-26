import * as A from '@automerge/automerge';
import automergeWasm from '@automerge/automerge/automerge.wasm?url';
import { localDate } from './domain/day';
import { Journal } from './domain/journal';
import { LocalStore } from './storage/local';
import { configuredProviders, finishCloudConnection } from './sync/providers';
import { setupCloudSettings } from './ui/cloud-settings';
import { setupPhotoCleanup } from './ui/photo-cleanup';
import { setupStorageBanner } from './ui/storage-banner';
import { protectStorage } from './storage/persistence';
import { Autosave } from './storage/autosave';
import type { SyncEngine } from './sync/engine';
import { JournalView } from './ui/journal-view';
import { setupDateNavigation } from './ui/date-navigation';
import { PhotoUrls } from './ui/photos';
import { setupPhotoSettings } from './ui/photo-settings';
import { mountShell } from './ui/shell';
import { setupPhotoInput } from './ui/photo-input';
import { setupSettingsDialog } from './ui/settings-dialog';
import { setupBackupControls } from './ui/backup-controls';
import { setupPwa } from './ui/pwa';
import { renderStorageStatus, storageStatus } from './ui/storage-status';
import './style.css';

const ui = mountShell();
// The editor owns its opening position, including reloads and PWA launches.
history.scrollRestoration = 'manual';

function notify(error: unknown): void {
  ui.noticeText.textContent = error instanceof Error ? error.message : String(error);
  ui.notice.hidden = false;
}
ui.dismissNotice.onclick = () => { ui.notice.hidden = true; };

async function start(): Promise<void> {
  await A.initializeWasm(automergeWasm);
  const local = await LocalStore.open();
  const journal = new Journal(local);
  const urls = new PhotoUrls(local);
  let today = localDate();
  let syncing = false;
  let cleaning = false;
  let cloudWorking = false;
  let cloudConnected = false;
  let cloudAvailable = false;
  let syncError = false;
  let dirty = true;
  let changeRevision = 0;
  let runningSync: Promise<void> | undefined;
  let engine: SyncEngine | undefined;
  let cloudName: string | undefined;
  const providers = configuredProviders();
  let nextDay: ReturnType<typeof setTimeout>;

  const autosave = new Autosave(saveBatch,
    () => journal.hasUnsavedChanges || !!engine && dirty && !cleaning, notify);

  await journal.load();
  if (journal.saveError) notify(journal.saveError);
  const photoSettingsConnection = setupPhotoSettings(ui, journal, notify);
  const afterSave = protectStorage(local);
  const bannerConnection = await setupStorageBanner(ui, local, providers.length > 0, notify);
  const view = new JournalView(ui.journal, journal, urls, {
    edited: () => autosave.edited(), notify, canFocus: () => !ui.dialog.open && !ui.dateSidebar.open,
  });
  setupDateNavigation(ui, view, notify);
  let justConnected = false;
  try { justConnected = await finishCloudConnection(local, providers); } catch (error) { notify(error); }

  function updateStatus(): void {
    renderStorageStatus(ui, storageStatus({
      saveError: !!journal.saveError, saving: journal.pending > 0, unsaved: journal.hasUnsavedChanges,
      cleaning, syncing, syncError, connected: cloudConnected, available: cloudAvailable,
      unlocked: !!engine, cloudWorking, online: navigator.onLine, synced: !dirty, cloudName,
    }));
    ui.sync.disabled = syncing || cleaning;
    ui.sync.textContent = syncing ? 'Syncing…' : 'Sync now';
  }

  async function sync(strict = false): Promise<void> {
    if (cleaning && !strict) return;
    // Explicit sync also includes edits still waiting for the automatic batch.
    await journal.flush();
    await syncCloud(strict);
  }

  async function syncCloud(strict = false): Promise<void> {
    if (cleaning && !strict) return;
    if (!engine || !navigator.onLine) {
      updateStatus();
      if (strict) throw new Error('Cloud sync is unavailable. No photos were deleted.');
      return;
    }
    if (syncing) {
      // Join the current request without asking the engine for another round.
      if (strict) await runningSync;
      return;
    }
    syncing = true;
    const revision = changeRevision;
    updateStatus();
    try {
      runningSync = engine.sync();
      await runningSync;
      syncError = false;
      dirty = revision !== changeRevision;
    } catch (error) {
      syncError = true;
      notify(error);
      if (strict) throw error;
    } finally {
      syncing = false; runningSync = undefined; updateStatus();
      if (dirty && !syncError) autosave.changed();
    }
  }

  // Cloud requests run independently: slow uploads must not block local saves.
  async function saveBatch(force = false): Promise<void> {
    await journal.flush();
    // Typing can resume while the local write is awaiting IndexedDB. Do not
    // start its automatic cloud phase until that newer typing has paused too.
    if (!force && (!autosave.isIdle || journal.hasUnsavedChanges)) return;
    if (dirty && !syncing) void syncCloud().catch(notify);
  }

  function scheduleSync(): void {
    dirty = true;
    changeRevision++;
    autosave.changed();
  }

  journal.subscribe(event => {
    if (event.saved) afterSave();
    if (event.error) autosave.retry();
    if (event.date) {
      view.receive(event.date, event.origin);
      scheduleSync();
    } else if (event.photos) {
      urls.clear();
      view.refreshPhotos();
      scheduleSync();
    }
    if (event.preferences) scheduleSync();
    updateStatus();
  });

  async function openToday(focus = true): Promise<void> {
    const date = localDate();
    // Midnight advances ordinary daily writing, without interrupting a date
    // deliberately opened in the past or future.
    if (focus || (date !== today && view.activeDate === today)) {
      if (date !== today) view.discardBlank(today);
      view.openDate(date, true);
    }
    today = date;
    view.onDatesChange();
    clearTimeout(nextDay);
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    nextDay = setTimeout(() => { void openToday(false).catch(notify); }, midnight.getTime() - Date.now() + 100);
  }

  // Opening a writing surface does not save a new, empty day.
  try { await openToday(); } catch (error) { notify(error); }
  ui.journal.setAttribute('aria-busy', 'false');
  updateStatus();

  // Photo dimensions can arrive before the image loads. Follow changes to the
  // journal's height, and keyboard resize, only until the person acts.
  const stopOpeningScroll = () => view.stopFollowing();
  for (const event of ['pointerdown', 'keydown', 'touchmove', 'wheel']) {
    document.addEventListener(event, stopOpeningScroll, { capture: true, passive: true });
  }
  const revealOpening = () => view.revealOpening();
  const openingLayout = new ResizeObserver(revealOpening);
  openingLayout.observe(ui.journal);
  window.visualViewport?.addEventListener('resize', revealOpening);

  const closePhotoMenu = setupPhotoInput(ui, journal, view, notify);
  setupSettingsDialog(ui, view, closePhotoMenu);
  setupBackupControls(ui, journal, notify);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void openToday(false).then(scheduleSync).catch(notify);
    } else {
      closePhotoMenu();
      void saveBatch(true).catch(notify);
    }
  });
  window.addEventListener('online', scheduleSync);
  window.addEventListener('offline', updateStatus);
  window.addEventListener('beforeunload', event => {
    if (journal.pending || journal.saveError) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { void saveBatch(true).catch(notify); });
  setInterval(() => { if (engine && document.visibilityState === 'visible') scheduleSync(); }, 30_000);

  setupPwa(ui, journal, notify);
  setupPhotoCleanup(ui, journal, {
    cloudReady: () => !!engine,
    cloudBusy: () => cloudWorking,
    sync: () => sync(true),
    busy: value => {
      cleaning = value; updateStatus();
      if (!value && dirty) scheduleSync();
    },
    notify,
  });
  ui.datesButton.disabled = false;
  ui.settingsButton.disabled = false;
  ui.statusButton.disabled = false;
  await setupCloudSettings(ui, journal, providers, {
    busy: () => syncing || cleaning,
    activity: value => { cloudWorking = value; },
    change: (next, name) => {
      engine = next; cloudName = name; syncError = false; dirty = true;
      updateStatus();
    },
    connection: (value, available) => {
      cloudConnected = value; cloudAvailable = available;
      bannerConnection(value); photoSettingsConnection(value); updateStatus();
      view.revealOpening();
    },
    sync, requestSync: scheduleSync, notify,
  });
  if (justConnected) ui.settingsButton.click();

  scheduleSync();
}

void start().catch(error => {
  renderStorageStatus(ui, { icon: 'device-alert', text: 'Could not open your journal', warning: true });
  ui.journal.setAttribute('aria-busy', 'false');
  ui.photoButton.disabled = true;
  notify(error instanceof Error ? new Error(`${error.message} Try reloading. Your stored data has not been reset.`) : error);
});
