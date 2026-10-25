import { appRoot } from '../urls';

const icons = {
  book: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Zm0 12h14M9 4v12"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
  settings: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  cloud: '<path d="M7 18H6a4 4 0 1 1 .6-7.95A6 6 0 0 1 18 8a5 5 0 0 1 0 10h-1M12 20V12m-3 3 3-3 3 3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-6-6-9 12"/>',
};
export function icon(name: keyof typeof icons): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

export function mountShell() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <header class="topbar">
      <a class="wordmark" href="${appRoot.href}#about" aria-label="About minijour">${icon('book')}<span>minijour</span></a>
      <div class="topbar-right">
        <span id="status" class="status" role="status"><span class="status-dot"></span><span id="status-text">Opening your journal…</span></span>
        <button id="settings-button" class="icon-button" aria-label="Settings and backup" title="Settings and backup">${icon('settings')}</button>
      </div>
    </header>
    <main id="journal" aria-label="Your journal" aria-busy="true"></main>
    <div class="photo-tools">
      <div id="photo-menu" class="photo-menu" role="group" aria-label="Add a photo" hidden>
        <button id="camera-button">${icon('camera')}Take a photo</button>
        <button id="choose-button">${icon('image')}Choose from device</button>
      </div>
      <button id="photo-button" class="photo-button" aria-label="Add a photo" aria-expanded="false" aria-controls="photo-menu">${icon('camera')}<span>Add photo</span></button>
    </div>
    <input id="camera-input" type="file" accept="image/*" capture="environment" hidden />
    <input id="photo-input" type="file" accept="image/*" hidden />
    <input id="restore-input" type="file" accept=".zip,application/zip" hidden />
    <div id="notice" class="notice" role="alert" hidden><span id="notice-text"></span><button id="dismiss-notice" class="icon-button" aria-label="Dismiss message">${icon('close')}</button></div>
    <button id="update-button" class="update-button" hidden>Update ready · reload</button>
    <dialog id="settings-dialog" aria-labelledby="settings-title">
      <div class="dialog-header"><h1 id="settings-title">Settings</h1><button id="close-settings" class="icon-button" aria-label="Close settings">${icon('close')}</button></div>
      <section id="cloud-section" class="settings-section" hidden>
        <h2>${icon('cloud')}Cloud sync</h2>
        <p id="connection-description">Your journal saves on this device. Connect your own cloud account for encrypted sync.</p>
        <div id="cloud-providers" class="button-row" hidden></div>
        <p id="cloud-account-help" class="help">Local entries combine with your journal in that account. This browser’s journal stays linked to the same provider and account after disconnecting.</p>
        <div id="cloud-connected" class="button-row" hidden>
          <button id="sync-button" class="primary-button">Sync now</button>
          <button id="lock-button" class="secondary-button">Lock cloud</button>
          <button id="disconnect-button" class="secondary-button">Disconnect</button>
        </div>
        <form id="vault-form" hidden>
          <p id="vault-description"></p>
          <label for="cloud-password">Cloud password</label>
          <input id="cloud-password" type="password" autocomplete="current-password" required />
          <div id="password-confirmation"><label for="cloud-password-confirm">Repeat cloud password</label>
          <input id="cloud-password-confirm" type="password" autocomplete="new-password" /></div>
          <label class="checkbox-label"><input id="remember-cloud" type="checkbox" /> Remember the key on this device</label>
          <p class="help">Keep your password somewhere safe. There is no password reset. Your local journal and downloaded backups are not encrypted by minijour.</p>
          <button id="unlock-button" class="primary-button" type="submit">Unlock cloud</button>
        </form>
        <button id="check-cloud-button" class="secondary-button" hidden>Retry cloud connection</button>
        <div id="legacy-cloud" hidden>
          <p id="legacy-cloud-description" class="help"></p>
          <button id="import-legacy-button" class="secondary-button">Import older cloud files</button>
        </div>
        <p class="help">When connected, text, editing history, and photos are encrypted on this device before upload. Your cloud provider can still see file sizes and upload times. Sync runs while the app is open and cloud access is unlocked.</p>
      </section>
      <section class="settings-section">
        <h2>Download and restore</h2>
        <p>Download your Markdown, referenced photos, and text editing history as an unencrypted ZIP. Restoring combines entries and keeps permanent photo deletions.</p>
        <div class="button-row"><button id="export-button" class="secondary-button">Download backup</button><button id="restore-button" class="text-button">Restore backup</button></div>
      </section>
      <section class="settings-section settings-small" aria-labelledby="storage-title">
        <h2 id="storage-title">Device storage</h2>
        <p id="storage-status" aria-live="polite">Checking storage protection…</p>
        <p id="storage-help" class="help"></p>
        <button id="request-storage" class="secondary-button" hidden>Request persistent storage</button>
      </section>
      <section class="settings-section settings-small">
        <h2>Photo storage</h2>
        <p>Removing a photo link keeps its file for undo. You can permanently remove files that no current entry uses.</p>
        <button id="review-photos-button" class="secondary-button">Clean up unused photos</button>
        <div id="photo-cleanup-review" hidden>
          <p id="photo-cleanup-summary"></p>
          <p class="help">This permanently removes these photos from this device and your connected cloud storage. Deletion syncs to other devices. Undo, old backups, or offline edits may bring back links with missing images. Existing backups, older cloud files, and cloud version history are not changed.</p>
          <div class="button-row"><button id="confirm-photo-cleanup" class="primary-button">Permanently delete photos</button><button id="cancel-photo-cleanup" class="text-button">Cancel</button></div>
        </div>
      </section>
      <section class="settings-section settings-small">
        <details class="advanced-settings">
          <summary>Write on another date</summary>
          <form id="date-form">
            <label for="entry-date">Entry date</label>
            <div class="button-row"><input id="entry-date" type="date" required /><button class="secondary-button" type="submit">Open date</button></div>
          </form>
          <p class="help">Choose a past or future date. Entries stay in date order. A blank draft is saved only when you add text or a photo.</p>
        </details>
      </section>
      <section class="settings-section settings-small">
        <h2>Install</h2>
        <p>Install from your browser’s menu, or choose <strong>Add to Home Screen</strong> from the Share menu. After the first visit and offline installation, you can write without a connection.</p>
        <button id="install-button" class="secondary-button" hidden>Install minijour</button>
        <p class="help">Dates follow your device’s local time. Day headings are automatic. Without cloud sync or an exported backup, clearing browser data removes your journal.</p>
      </section>
      <section class="settings-section settings-small">
        <h2>About minijour <span class="app-version">${__APP_VERSION__}</span></h2>
        <p class="help">© 2026 folinimarc and contributors. Free software under <a href="${new URL('LICENSE.txt', appRoot).href}" target="_blank" rel="noopener noreferrer">GPL v3.0</a>, without warranty. You may redistribute it under that license.</p>
        <p class="help"><a href="${__SOURCE_URL__}" target="_blank" rel="noopener noreferrer">Source for this build</a> · <a href="${new URL('THIRD_PARTY_NOTICES.txt', appRoot).href}" target="_blank" rel="noopener noreferrer">Dependency notices</a></p>
      </section>
      <div class="dialog-footer">minijour <span>A place for the everyday.</span></div>
    </dialog>`;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  return {
    journal: get<HTMLElement>('journal'), status: get<HTMLSpanElement>('status'), statusText: get<HTMLSpanElement>('status-text'),
    settingsButton: get<HTMLButtonElement>('settings-button'), dialog: get<HTMLDialogElement>('settings-dialog'),
    closeSettings: get<HTMLButtonElement>('close-settings'), photoButton: get<HTMLButtonElement>('photo-button'),
    photoMenu: get<HTMLDivElement>('photo-menu'), cameraButton: get<HTMLButtonElement>('camera-button'),
    chooseButton: get<HTMLButtonElement>('choose-button'), cameraInput: get<HTMLInputElement>('camera-input'),
    photoInput: get<HTMLInputElement>('photo-input'), restoreInput: get<HTMLInputElement>('restore-input'),
    notice: get<HTMLDivElement>('notice'), noticeText: get<HTMLSpanElement>('notice-text'), dismissNotice: get<HTMLButtonElement>('dismiss-notice'),
    disconnect: get<HTMLButtonElement>('disconnect-button'),
    sync: get<HTMLButtonElement>('sync-button'), export: get<HTMLButtonElement>('export-button'),
    restore: get<HTMLButtonElement>('restore-button'),
    storageStatus: get<HTMLParagraphElement>('storage-status'), storageHelp: get<HTMLParagraphElement>('storage-help'),
    requestStorage: get<HTMLButtonElement>('request-storage'),
    dateForm: get<HTMLFormElement>('date-form'), entryDate: get<HTMLInputElement>('entry-date'),
    cloudSection: get<HTMLElement>('cloud-section'), providerList: get<HTMLDivElement>('cloud-providers'),
    reviewPhotos: get<HTMLButtonElement>('review-photos-button'), photoCleanupReview: get<HTMLDivElement>('photo-cleanup-review'),
    photoCleanupSummary: get<HTMLParagraphElement>('photo-cleanup-summary'),
    confirmPhotoCleanup: get<HTMLButtonElement>('confirm-photo-cleanup'), cancelPhotoCleanup: get<HTMLButtonElement>('cancel-photo-cleanup'),
    accountHelp: get<HTMLParagraphElement>('cloud-account-help'),
    vaultForm: get<HTMLFormElement>('vault-form'), vaultDescription: get<HTMLParagraphElement>('vault-description'),
    password: get<HTMLInputElement>('cloud-password'), passwordConfirm: get<HTMLInputElement>('cloud-password-confirm'),
    confirmation: get<HTMLDivElement>('password-confirmation'), remember: get<HTMLInputElement>('remember-cloud'),
    unlock: get<HTMLButtonElement>('unlock-button'), lock: get<HTMLButtonElement>('lock-button'),
    checkCloud: get<HTMLButtonElement>('check-cloud-button'),
    legacy: get<HTMLDivElement>('legacy-cloud'), legacyDescription: get<HTMLParagraphElement>('legacy-cloud-description'), importLegacy: get<HTMLButtonElement>('import-legacy-button'),
    connected: get<HTMLDivElement>('cloud-connected'), connectionDescription: get<HTMLParagraphElement>('connection-description'),
    install: get<HTMLButtonElement>('install-button'), update: get<HTMLButtonElement>('update-button'),
  };
}
