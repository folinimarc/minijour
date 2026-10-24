import { EncryptedFiles, type RememberedVault } from '../crypto/vault';
import type { Journal } from '../domain/journal';
import { VAULT_KEY_SETTING } from '../storage/local';
import { connectDropbox, DropboxFiles, redirectUri } from '../sync/dropbox';
import { SyncEngine } from '../sync/engine';
import type { mountShell } from './shell';

/** Owns connection/unlock controls. Writing and local storage never depend on it. */
export async function setupCloudSettings(
  ui: ReturnType<typeof mountShell>, journal: Journal,
  options: {
    busy: () => boolean; activity: (value: boolean) => void;
    change: (engine?: SyncEngine) => void; sync: () => Promise<void>; notify: (error: unknown) => void;
  },
): Promise<void> {
  const local = journal.local;
  let cloud = await DropboxFiles.open(local);
  let header: Awaited<ReturnType<typeof EncryptedFiles.inspect>>;
  let unlocked = false;
  let working = false;
  let inspected = false;
  const setWorking = (value: boolean) => { working = value; options.activity(value); };
  const show = () => {
    ui.setup.hidden = !!cloud;
    ui.connected.hidden = !cloud;
    ui.vaultForm.hidden = !cloud || unlocked || !inspected;
    ui.checkCloud.hidden = !cloud || unlocked || inspected;
    ui.checkCloud.disabled = working;
    ui.sync.hidden = !unlocked;
    ui.lock.hidden = !unlocked;
    ui.connectionDescription.textContent = unlocked
      ? 'Connected. Your journal syncs encrypted to your Dropbox.'
      : cloud ? 'Dropbox is connected. Unlock cloud access to sync. You can keep writing locally.'
      : 'Your journal saves on this device. Connect your Dropbox for encrypted sync across devices.';
    ui.confirmation.hidden = !!header;
    ui.password.autocomplete = header ? 'current-password' : 'new-password';
    ui.passwordConfirm.required = !header;
    ui.unlock.textContent = working ? 'Working…' : header ? 'Unlock cloud' : 'Enable encrypted sync';
    ui.unlock.disabled = working;
    ui.vaultDescription.textContent = header ? 'Enter the same cloud password you use on your other devices.'
      : 'Choose a cloud password of at least 12 characters. Use the same password on each device.';
    ui.importLegacy.disabled = !unlocked || working;
  };
  const use = async (vault: EncryptedFiles) => {
    unlocked = true;
    options.change(new SyncEngine(journal, vault));
    ui.password.value = ''; ui.passwordConfirm.value = '';
    show();
  };
  const guard = () => {
    if (working || options.busy()) throw new Error('Wait for the current cloud operation to finish.');
  };
  const inspect = async () => {
    if (!cloud) return;
    header = await EncryptedFiles.inspect(cloud);
    inspected = true;
    const saved = await local.setting<RememberedVault>(VAULT_KEY_SETTING);
    if (header) {
      const vault = EncryptedFiles.remembered(cloud, header, saved);
      if (vault) await use(vault);
    }
    ui.legacy.hidden = !(await cloud.legacy().list()).length;
  };
  ui.appKey.value = import.meta.env.VITE_DROPBOX_APP_KEY || await local.setting<string>('dropbox-app-key') || '';
  ui.developerSetup.hidden = !!import.meta.env.VITE_DROPBOX_APP_KEY;
  ui.redirect.value = redirectUri();
  ui.connect.onclick = () => { void (async () => {
    ui.connect.disabled = true;
    await journal.flush();
    await local.setSetting('dropbox-app-key', ui.appKey.value.trim());
    await connectDropbox(ui.appKey.value);
  })().catch(error => { ui.connect.disabled = false; options.notify(error); }); };
  ui.vaultForm.onsubmit = event => {
    event.preventDefault();
    void (async () => {
      guard();
      if (!cloud) return;
      if (!header && ui.password.value !== ui.passwordConfirm.value) throw new Error('The passwords do not match.');
      setWorking(true); show();
      try {
        // Re-inspect on every attempt: another device may have finished setup.
        const current = await EncryptedFiles.inspect(cloud);
        const vault = current ? await EncryptedFiles.unlock(cloud, current, ui.password.value)
          : await EncryptedFiles.create(cloud, ui.password.value);
        header = await EncryptedFiles.inspect(cloud);
        if (ui.remember.checked) await local.rememberVaultKey({ descriptor: vault.descriptor, key: vault.key });
        else await local.removeSetting(VAULT_KEY_SETTING);
        await use(vault);
        ui.notice.hidden = true;
        await options.sync();
      } finally { setWorking(false); ui.password.value = ''; ui.passwordConfirm.value = ''; show(); }
    })().catch(options.notify);
  };
  ui.lock.onclick = () => { void (async () => {
    guard();
    setWorking(true);
    try {
      await local.removeSetting(VAULT_KEY_SETTING);
      unlocked = false; options.change();
    } finally { setWorking(false); show(); }
  })().catch(options.notify); };
  ui.disconnect.onclick = () => { void (async () => {
    guard();
    setWorking(true);
    try {
      await DropboxFiles.disconnect(local);
      cloud = undefined; header = undefined; unlocked = false; inspected = false;
      options.change(); ui.legacy.hidden = true;
    } finally { setWorking(false); show(); }
  })().catch(options.notify); };
  ui.importLegacy.onclick = () => { void (async () => {
    guard();
    if (!cloud || !unlocked) return;
    setWorking(true); show();
    try {
      await new SyncEngine(journal, cloud.legacy()).importOnly();
      await options.sync();
      options.notify('Older files imported. The unencrypted originals and their version history remain in Dropbox.');
    } finally { setWorking(false); show(); }
  })().catch(options.notify); };
  ui.sync.onclick = () => { void options.sync(); };
  const check = async () => {
    if (working) return;
    setWorking(true); show();
    try { await inspect(); } catch (error) { options.notify(error); }
    finally { setWorking(false); show(); }
  };
  ui.checkCloud.onclick = () => { void check().then(options.sync); };
  window.addEventListener('online', () => {
    if (cloud && !inspected && !working) void check().then(options.sync);
  });
  show();
  await check();
}
