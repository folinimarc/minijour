/// <reference types="vite-plugin-pwa/client" />
import * as A from '@automerge/automerge';
import automergeWasm from '@automerge/automerge/automerge.wasm?url';
import { registerSW } from 'virtual:pwa-register';
import { localDate } from './domain/day';
import { Journal } from './domain/journal';
import { LocalStore } from './storage/local';
import { exportJournal, importJournal } from './storage/backup';
import { configuredProviders, finishCloudConnection } from './sync/providers';
import { setupCloudSettings } from './ui/cloud-settings';
import { setupPhotoCleanup } from './ui/photo-cleanup';
import { setupStorageBanner } from './ui/storage-banner';
import { protectStorage } from './storage/persistence';
import { SyncEngine } from './sync/engine';
import { JournalView } from './ui/journal-view';
import { setupDateNavigation } from './ui/date-navigation';
import { PhotoUrls, preparePhoto } from './ui/photos';
import { mountShell } from './ui/shell';
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
  let syncError = false;
  let lastSync: Date | undefined;
  let dirty = true;
  let engine: SyncEngine | undefined;
  let cloudName: string | undefined;
  const providers = configuredProviders();
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let nextDay: ReturnType<typeof setTimeout>;
  let photoTarget: { date: string; anchor: A.Cursor; head: A.Cursor } | undefined;

  await journal.load();
  const afterSave = protectStorage(local);
  const bannerConnection = await setupStorageBanner(ui, local, providers.length > 0, notify);
  const view = new JournalView(ui.journal, journal, urls, {
    afterSave, notify, canFocus: () => !ui.dialog.open && !ui.dateSidebar.open,
  });
  const editors = view.editors;
  setupDateNavigation(ui, view, notify);
  let justConnected = false;
  try { justConnected = await finishCloudConnection(local, providers); } catch (error) { notify(error); }

  function updateStatus(): void {
    ui.status.classList.toggle('has-error', !!journal.saveError || syncError);
    ui.status.classList.toggle('is-busy', journal.pending > 0 || syncing || cleaning);
    ui.statusText.textContent = journal.saveError ? 'Could not save on this device'
      : journal.pending ? 'Saving…'
      : cleaning ? 'Saved on device · updating photos…'
      : syncing ? 'Saved on device · syncing…'
      : syncError ? 'Saved on device · sync needs attention'
      : !navigator.onLine ? 'Saved on device · offline'
      : !cloudConnected ? 'Saved on this device'
      : !engine ? 'Cloud storage locked'
      : lastSync && !dirty ? `Saved to ${cloudName}`
      : 'Saved on device · waiting to sync';
    ui.sync.disabled = syncing || cleaning;
    ui.sync.textContent = syncing ? 'Syncing…' : 'Sync now';
  }

  async function sync(strict = false): Promise<void> {
    if (cleaning && !strict) return;
    if (!engine || !navigator.onLine) {
      updateStatus();
      if (strict) throw new Error('Cloud sync is unavailable. No photos were deleted.');
      return;
    }
    if (syncing) {
      try { await engine.sync(); } catch (error) { if (strict) throw error; }
      return;
    }
    syncing = true;
    updateStatus();
    try {
      await engine.sync();
      syncError = false;
      lastSync = new Date();
      dirty = false;
    } catch (error) {
      syncError = true;
      notify(error);
      if (strict) throw error;
    } finally { syncing = false; updateStatus(); }
  }

  function scheduleSync(): void {
    dirty = true;
    if (!engine || cleaning) return;
    if (syncing) { void engine.sync().catch(() => {}); return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { void sync(); }, 1500);
  }

  journal.subscribe(event => {
    if (event.date) {
      view.receive(event.date, event.origin);
      scheduleSync();
    } else if (event.photos) {
      urls.clear();
      view.refreshPhotos();
      scheduleSync();
    }
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

  // Follow delayed photo layout and keyboard resize only until the person acts.
  const stopOpeningScroll = () => view.stopFollowing();
  for (const event of ['pointerdown', 'keydown', 'touchmove', 'wheel']) {
    document.addEventListener(event, stopOpeningScroll, { capture: true, passive: true });
  }
  const revealOpening = () => view.revealOpening();
  ui.journal.addEventListener('load', revealOpening, true);
  window.visualViewport?.addEventListener('resize', revealOpening);

  ui.settingsButton.onclick = () => {
    closePhotoMenu();
    ui.dialog.append(ui.notice); ui.dialog.showModal();
  };
  ui.closeSettings.onclick = () => ui.dialog.close();
  ui.dialog.addEventListener('click', event => { if (event.target === ui.dialog && event.clientX) {
    const box = ui.dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) ui.dialog.close();
  } });
  ui.dialog.addEventListener('close', () => { document.body.append(ui.notice); editors.get(view.activeDate)?.view.focus(); });
  ui.export.onclick = () => { void (async () => {
    ui.export.disabled = true;
    try {
      const blob = await exportJournal(journal);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `minijour-${localDate()}.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { ui.export.disabled = false; }
  })().catch(notify); };
  ui.restore.onclick = () => ui.restoreInput.click();
  ui.restoreInput.onchange = () => { void (async () => {
    const file = ui.restoreInput.files?.[0];
    ui.restoreInput.value = '';
    if (!file) return;
    await importJournal(journal, file);
    scheduleSync();
    notify('Backup restored. Its entries have been combined with your journal.');
  })().catch(notify); };

  function closePhotoMenu(): void {
    ui.photoMenu.hidden = true;
    ui.photoButton.setAttribute('aria-expanded', 'false');
  }
  ui.photoButton.onpointerdown = event => { event.preventDefault(); };
  ui.photoButton.onclick = () => {
    if (!ui.photoMenu.hidden) { closePhotoMenu(); return; }
    const editor = view.expandActive();
    const selection = editor.view.state.selection.main;
    photoTarget = {
      date: view.activeDate,
      anchor: A.getCursor(editor.doc, ['text'], selection.anchor),
      head: A.getCursor(editor.doc, ['text'], selection.head),
    };
    ui.photoMenu.hidden = false;
    ui.photoButton.setAttribute('aria-expanded', 'true');
  };
  ui.cameraButton.onclick = () => { closePhotoMenu(); ui.cameraInput.click(); };
  ui.chooseButton.onclick = () => { closePhotoMenu(); ui.photoInput.click(); };
  document.addEventListener('pointerdown', event => {
    if (!(event.target as HTMLElement).closest('.photo-tools')) closePhotoMenu();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePhotoMenu(); });

  async function addPhoto(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !photoTarget) return;
    ui.photoButton.disabled = true;
    try {
      const photo = await preparePhoto(file);
      await local.savePhoto(photo.name, photo.blob);
      const editor = editors.get(photoTarget.date)!;
      const anchor = A.getCursorPosition(editor.doc, ['text'], photoTarget.anchor);
      const head = A.getCursorPosition(editor.doc, ['text'], photoTarget.head);
      const from = Math.min(anchor, head), to = Math.max(anchor, head);
      const before = editor.view.state.doc.sliceString(0, from);
      const prefix = before.length && !before.endsWith('\n') ? '\n' : '';
      const insert = `${prefix}![Photo](photos/${photo.name})\n`;
      editor.view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
      journal.photosChanged();
      scheduleSync();
      editor.view.focus();
    } finally { ui.photoButton.disabled = false; }
  }
  ui.cameraInput.onchange = () => { void addPhoto(ui.cameraInput).catch(notify); };
  ui.photoInput.onchange = () => { void addPhoto(ui.photoInput).catch(notify); };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void openToday(false).then(() => sync()).catch(notify);
    } else {
      closePhotoMenu();
      void sync();
    }
  });
  window.addEventListener('online', () => { void sync(); });
  window.addEventListener('offline', updateStatus);
  window.addEventListener('beforeunload', event => {
    if (journal.pending || journal.saveError) { event.preventDefault(); event.returnValue = ''; }
  });
  setInterval(() => { if (document.visibilityState === 'visible') void sync(); }, 30_000);

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
    ui.install.onclick = () => { void install.prompt().then(() => install.userChoice).then(() => { ui.install.hidden = true; }); };
  });
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
  await setupCloudSettings(ui, journal, providers, {
    busy: () => syncing || cleaning,
    activity: value => { cloudWorking = value; },
    change: (next, name) => {
      clearTimeout(syncTimer);
      engine = next; cloudName = name; syncError = false; lastSync = undefined; dirty = true;
      updateStatus();
    },
    connection: value => {
      cloudConnected = value; bannerConnection(value); updateStatus();
      view.revealOpening();
    },
    sync, notify,
  });
  if (justConnected) ui.settingsButton.click();

  void sync();
}

void start().catch(error => {
  ui.statusText.textContent = 'Could not open your journal';
  ui.status.classList.add('has-error');
  ui.journal.setAttribute('aria-busy', 'false');
  ui.photoButton.disabled = true;
  notify(error instanceof Error ? new Error(`${error.message} Try reloading. Your stored data has not been reset.`) : error);
});
