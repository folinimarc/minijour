/// <reference types="vite-plugin-pwa/client" />
import * as A from '@automerge/automerge';
import automergeWasm from '@automerge/automerge/automerge.wasm?url';
import { registerSW } from 'virtual:pwa-register';
import { localDate } from './domain/day';
import { Journal } from './domain/journal';
import { LocalStore } from './storage/local';
import { exportJournal, importJournal } from './storage/backup';
import { finishDropboxConnection } from './sync/dropbox';
import { setupCloudSettings } from './ui/cloud-settings';
import { SyncEngine } from './sync/engine';
import { DayEditor } from './ui/editor';
import { PhotoUrls, preparePhoto } from './ui/photos';
import { mountShell } from './ui/shell';
import './style.css';

const ui = mountShell();

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
  const editors = new Map<string, DayEditor>();
  let activeDate = localDate();
  let syncing = false;
  let syncError = false;
  let lastSync: Date | undefined;
  let dirty = true;
  let engine: SyncEngine | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let nextDay: ReturnType<typeof setTimeout>;
  let photoTarget: { date: string; anchor: A.Cursor; head: A.Cursor } | undefined;
  let requestPersistent = false;

  await journal.load();
  let justConnected = false;
  try { justConnected = await finishDropboxConnection(local); } catch (error) { notify(error); }

  function updateStatus(): void {
    ui.status.classList.toggle('has-error', !!journal.saveError || syncError);
    ui.status.classList.toggle('is-busy', journal.pending > 0 || syncing);
    ui.statusText.textContent = journal.saveError ? 'Could not save on this device'
      : journal.pending ? 'Saving…'
      : !navigator.onLine ? 'Saved on device · offline'
      : syncing ? 'Saved on device · syncing…'
      : syncError ? 'Saved on device · sync needs attention'
      : engine && lastSync && !dirty ? 'Saved to Dropbox'
      : 'Saved on this device';
    ui.sync.disabled = syncing;
    ui.sync.textContent = syncing ? 'Syncing…' : 'Sync now';
  }

  async function sync(): Promise<void> {
    if (!engine || !navigator.onLine) { updateStatus(); return; }
    if (syncing) { void engine.sync().catch(() => {}); return; }
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
    } finally { syncing = false; updateStatus(); }
  }

  function scheduleSync(): void {
    dirty = true;
    if (!engine) return;
    if (syncing) { void engine.sync().catch(() => {}); return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { void sync(); }, 1500);
  }

  function renderDay(date: string): void {
    const doc = journal.days.get(date)!;
    const existing = editors.get(date);
    if (existing) { existing.receive(doc); return; }
    const section = document.createElement('section');
    section.className = 'day';
    section.dataset.date = date;
    const heading = document.createElement('div');
    heading.className = 'day-heading';
    const dateHeading = document.createElement('h2');
    const time = document.createElement('time');
    time.dateTime = date; time.textContent = date;
    dateHeading.append(time);
    const weekday = document.createElement('span');
    weekday.className = 'weekday';
    weekday.textContent = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
    heading.append(dateHeading, weekday);
    section.append(heading);
    const content = document.createElement('div');
    section.append(content);
    const following = [...ui.journal.children].find(child => (child as HTMLElement).dataset.date! > date);
    ui.journal.insertBefore(section, following ?? null);
    const editor = new DayEditor(content, doc, date, urls, next => {
      void journal.merge(date, A.save(next)).catch(notify);
      if (!requestPersistent) {
        requestPersistent = true;
        void navigator.storage?.persist?.().catch(() => {});
      }
    }, () => { activeDate = date; });
    editors.set(date, editor);
  }

  journal.subscribe(event => {
    if (event.date) {
      renderDay(event.date);
      scheduleSync();
    } else if (event.photos) {
      urls.version++;
      for (const editor of editors.values()) editor.refreshPhotos();
      scheduleSync();
    }
    updateStatus();
  });

  for (const date of [...journal.days.keys()].sort()) renderDay(date);

  async function openToday(focus = true): Promise<void> {
    const date = localDate();
    const isNew = !journal.days.has(date);
    await journal.ensureDay(date);
    if (isNew || focus) {
      activeDate = date;
      if (!ui.dialog.open) editors.get(date)?.focusEnd();
    }
    clearTimeout(nextDay);
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    nextDay = setTimeout(() => { void openToday(false).catch(notify); }, midnight.getTime() - Date.now() + 100);
  }

  // A quota error must not disable settings: the user can still export the
  // in-memory journal before closing the app.
  try { await openToday(); } catch (error) { notify(error); }
  ui.journal.setAttribute('aria-busy', 'false');
  updateStatus();

  ui.settingsButton.onclick = () => { closePhotoMenu(); ui.dialog.append(ui.notice); ui.dialog.showModal(); };
  ui.closeSettings.onclick = () => ui.dialog.close();
  ui.dialog.addEventListener('click', event => { if (event.target === ui.dialog && event.clientX) {
    const box = ui.dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) ui.dialog.close();
  } });
  ui.dialog.addEventListener('close', () => { document.body.append(ui.notice); editors.get(activeDate)?.view.focus(); });
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
    const editor = editors.get(activeDate);
    if (!editor) return;
    const selection = editor.view.state.selection.main;
    photoTarget = {
      date: activeDate,
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
      void openToday(false).then(sync).catch(notify);
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
  await setupCloudSettings(ui, journal, {
    busy: () => syncing,
    change: next => {
      clearTimeout(syncTimer);
      engine = next; syncError = false; lastSync = undefined; dirty = true;
      updateStatus();
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
