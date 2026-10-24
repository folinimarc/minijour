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
      <a class="wordmark" href="./" aria-label="minijour, your journal">${icon('book')}<span>minijour</span></a>
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
      <div class="dialog-header"><h1 id="settings-title">A little housekeeping.</h1><button id="close-settings" class="icon-button" aria-label="Close settings">${icon('close')}</button></div>
      <section class="settings-section">
        <h2>${icon('cloud')}Dropbox sync</h2>
        <p id="connection-description">Your journal saves on this device. Connect Dropbox to keep writing across devices.</p>
        <div id="dropbox-setup">
          <div id="dropbox-developer-setup">
          <label for="app-key">Dropbox app key</label>
          <input id="app-key" type="text" spellcheck="false" autocomplete="off" placeholder="Your public app key" />
          <p class="help">Create a scoped <strong>App folder</strong> app in the <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer">Dropbox App Console</a>. Enable <code>files.metadata.read</code>, <code>files.content.read</code>, and <code>files.content.write</code>.</p>
          <label for="redirect-uri">OAuth redirect URI</label><input id="redirect-uri" readonly />
          <p class="help">Add this exact address to your app’s redirect URIs. Use the same app key on each device.</p>
          </div>
          <p class="help">Connect your own Dropbox account. Local entries combine with your journal there. This browser’s journal stays associated with that account after disconnecting.</p>
          <button id="connect-button" class="primary-button">Connect Dropbox</button>
        </div>
        <div id="dropbox-connected" class="button-row" hidden>
          <button id="sync-button" class="primary-button">Sync now</button>
          <button id="disconnect-button" class="secondary-button">Disconnect</button>
        </div>
        <p class="help">Sync runs while the app is open. Dropbox stores your journal in your app folder; additional end-to-end encryption is not enabled.</p>
      </section>
      <section class="settings-section">
        <h2>Your words, yours to keep</h2>
        <p>Download your Markdown, photos, and editing history together. Restoring a backup combines entries with this journal.</p>
        <div class="button-row"><button id="export-button" class="secondary-button">Download backup</button><button id="restore-button" class="text-button">Restore backup</button></div>
      </section>
      <section class="settings-section settings-small">
        <h2>Keep it close</h2>
        <p>Install from your browser’s menu, or choose <strong>Add to Home Screen</strong> from the Share menu. After the first visit and offline installation, you can write without a connection.</p>
        <button id="install-button" class="secondary-button" hidden>Install minijour</button>
        <p class="help">Dates follow your device’s local time. Day headings are automatic. Without Dropbox or an exported backup, clearing browser data removes your journal.</p>
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
    appKey: get<HTMLInputElement>('app-key'), redirect: get<HTMLInputElement>('redirect-uri'),
    connect: get<HTMLButtonElement>('connect-button'), disconnect: get<HTMLButtonElement>('disconnect-button'),
    sync: get<HTMLButtonElement>('sync-button'), export: get<HTMLButtonElement>('export-button'),
    restore: get<HTMLButtonElement>('restore-button'), setup: get<HTMLDivElement>('dropbox-setup'),
    developerSetup: get<HTMLDivElement>('dropbox-developer-setup'),
    connected: get<HTMLDivElement>('dropbox-connected'), connectionDescription: get<HTMLParagraphElement>('connection-description'),
    install: get<HTMLButtonElement>('install-button'), update: get<HTMLButtonElement>('update-button'),
  };
}
