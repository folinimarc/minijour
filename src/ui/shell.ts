import { appRoot } from '../urls';
import { icon } from './icons';

export function mountShell() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <header class="topbar">
      <a class="wordmark" href="${appRoot.href}#about" aria-label="About minijour">${icon('book')}<span>minijour</span></a>
      <div class="topbar-right">
        <button id="status-button" class="status-button" aria-label="Cloud storage and sync settings"><span id="status" class="status" role="status"><span id="cloud-warning" class="cloud-warning" hidden>${icon('warning')}</span><span class="status-dot"></span><span id="status-text">Opening your journal…</span></span></button>
        <div class="header-actions">
          <button id="dates-button" class="header-button" aria-expanded="false" aria-controls="date-sidebar">Dates</button>
          <button id="settings-button" class="header-button">Settings</button>
        </div>
      </div>
    </header>
    <main id="journal" aria-label="Your journal" aria-busy="true"></main>
    <dialog id="date-sidebar" class="date-sidebar" aria-labelledby="dates-title">
      <div class="dialog-header"><h1 id="dates-title">Dates</h1><button id="close-dates" class="icon-button" aria-label="Close dates">${icon('close')}</button></div>
      <nav aria-label="Journal dates"><ul id="date-list" class="date-list"></ul></nav>
      <details class="add-date">
        <summary>Add a date</summary>
        <form id="date-form">
          <label for="entry-date">Entry date</label>
          <input id="entry-date" type="date" required />
          <button class="secondary-button" type="submit">Open date</button>
        </form>
      </details>
    </dialog>
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
      <section id="cloud-section" class="settings-section">
        <h2>${icon('cloud')}Cloud sync</h2>
        <p id="connection-description">Your journal saves on this device. Clearing browser data can remove it. Connect your own cloud account for encrypted cloud storage and sync across your devices.</p>
        <div id="cloud-providers" class="button-row" hidden></div>
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
        <p class="help">Text, editing history, and photos are encrypted before upload and shared with devices connected to the same account. Sync runs while minijour is open and cloud access is unlocked.</p>
      </section>
      <section class="settings-section">
        <h2>Download and restore</h2>
        <p>Download your journal and photos as an unencrypted ZIP. Restore a backup to combine its entries with this journal.</p>
        <div class="button-row"><button id="export-button" class="secondary-button">Download backup</button><button id="restore-button" class="text-button">Restore backup</button></div>
      </section>
      <section class="settings-section settings-small">
        <h2>Photo storage</h2>
        <p>Removing a photo link does not remove the photo file. Clean up files that no entry uses below.</p>
        <button id="review-photos-button" class="secondary-button">Clean up unused photos</button>
        <div id="photo-cleanup-review" hidden>
          <p id="photo-cleanup-summary"></p>
          <p class="help">This permanently removes these photos from this device and your connected cloud storage. Deletion syncs to other devices. Undo, old backups, or offline edits may bring back links with missing images. Existing backups, older cloud files, and cloud version history are not changed.</p>
          <div class="button-row"><button id="confirm-photo-cleanup" class="primary-button">Permanently delete photos</button><button id="cancel-photo-cleanup" class="text-button">Cancel</button></div>
        </div>
      </section>
      <section class="settings-section settings-small">
        <h2>Install</h2>
        <p>Install from your browser’s menu, or choose <strong>Add to Home Screen</strong> from the Share menu. After the first visit and offline installation, you can write without a connection.</p>
        <button id="install-button" class="secondary-button" hidden>Install minijour</button>
      </section>
      <section class="settings-section settings-small">
        <h2>About minijour <span class="app-version">${__APP_VERSION__}</span></h2>
        <p class="help">© 2026 folinimarc and contributors. Free software under <a href="${new URL('LICENSE.txt', appRoot).href}" target="_blank" rel="noopener noreferrer">GPL v3.0</a>, without warranty. You may redistribute it under that license.</p>
        <p class="help"><a href="${__SOURCE_URL__}" target="_blank" rel="noopener noreferrer">Source for this build</a> · <a href="${new URL('THIRD_PARTY_NOTICES.txt', appRoot).href}" target="_blank" rel="noopener noreferrer">Dependency notices</a></p>
      </section>
    </dialog>`;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  return {
    journal: get<HTMLElement>('journal'), status: get<HTMLSpanElement>('status'), statusText: get<HTMLSpanElement>('status-text'),
    statusButton: get<HTMLButtonElement>('status-button'), cloudWarning: get<HTMLSpanElement>('cloud-warning'),
    settingsButton: get<HTMLButtonElement>('settings-button'), dialog: get<HTMLDialogElement>('settings-dialog'),
    closeSettings: get<HTMLButtonElement>('close-settings'), photoButton: get<HTMLButtonElement>('photo-button'),
    photoMenu: get<HTMLDivElement>('photo-menu'), cameraButton: get<HTMLButtonElement>('camera-button'),
    chooseButton: get<HTMLButtonElement>('choose-button'), cameraInput: get<HTMLInputElement>('camera-input'),
    photoInput: get<HTMLInputElement>('photo-input'), restoreInput: get<HTMLInputElement>('restore-input'),
    notice: get<HTMLDivElement>('notice'), noticeText: get<HTMLSpanElement>('notice-text'), dismissNotice: get<HTMLButtonElement>('dismiss-notice'),
    disconnect: get<HTMLButtonElement>('disconnect-button'),
    sync: get<HTMLButtonElement>('sync-button'), export: get<HTMLButtonElement>('export-button'),
    restore: get<HTMLButtonElement>('restore-button'),
    datesButton: get<HTMLButtonElement>('dates-button'), dateSidebar: get<HTMLDialogElement>('date-sidebar'),
    closeDates: get<HTMLButtonElement>('close-dates'), dateList: get<HTMLUListElement>('date-list'),
    dateForm: get<HTMLFormElement>('date-form'), entryDate: get<HTMLInputElement>('entry-date'),
    cloudSection: get<HTMLElement>('cloud-section'), providerList: get<HTMLDivElement>('cloud-providers'),
    reviewPhotos: get<HTMLButtonElement>('review-photos-button'), photoCleanupReview: get<HTMLDivElement>('photo-cleanup-review'),
    photoCleanupSummary: get<HTMLParagraphElement>('photo-cleanup-summary'),
    confirmPhotoCleanup: get<HTMLButtonElement>('confirm-photo-cleanup'), cancelPhotoCleanup: get<HTMLButtonElement>('cancel-photo-cleanup'),
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
