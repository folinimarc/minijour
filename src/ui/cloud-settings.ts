import { EncryptedFiles, type RememberedVault } from '../crypto/vault';
import type { Journal } from '../domain/journal';
import { VAULT_KEY_SETTING } from '../storage/local';
import { connectCloud } from '../sync/providers';
import type { CloudProvider, CloudSession } from '../sync/provider';
import { SyncEngine } from '../sync/engine';
import type { mountShell } from './shell';

/** Shared account/unlock controls. Deployment configuration stays in providers. */
export async function setupCloudSettings(
  ui: ReturnType<typeof mountShell>, journal: Journal, providers: CloudProvider[],
  options: {
    busy: () => boolean; activity: (value: boolean) => void;
    change: (engine?: SyncEngine, providerName?: string) => void;
    connection: (connected: boolean) => void;
    sync: () => Promise<void>; notify: (error: unknown) => void;
  },
): Promise<void> {
  const local = journal.local;
  const owner = await local.cloudOwner();
  const provider = providers.find(provider => provider.id === owner?.providerId);
  let session: CloudSession | undefined;
  if (provider) {
    try { session = await provider.open(local); } catch (error) { options.notify(error); }
  }
  const providerName = provider?.name || 'Cloud storage';
  let header: Awaited<ReturnType<typeof EncryptedFiles.inspect>>;
  let unlocked = false;
  let working = false;
  let inspected = false;
  const setWorking = (value: boolean) => { working = value; options.activity(value); };
  const show = () => {
    options.connection(!!session);
    ui.providerList.hidden = !!session;
    for (const [entry, button] of buttons) button.disabled = working || !!owner && owner.providerId !== entry.id;
    ui.connected.hidden = !session;
    ui.vaultForm.hidden = !session || unlocked || !inspected;
    ui.checkCloud.hidden = !session || unlocked || inspected;
    ui.checkCloud.disabled = working;
    ui.sync.hidden = !unlocked;
    ui.lock.hidden = !unlocked;
    ui.connectionDescription.textContent = unlocked
      ? `Connected to ${providerName}. Your journal syncs encrypted.`
      : session ? `${providerName} is connected. Unlock cloud access to sync. You can keep writing locally.`
      : providers.length === 0 ? 'Your journal saves on this device. Clearing browser data can remove it. Cloud sync is unavailable on this website; download a backup to keep a copy.'
      : owner ? 'Your journal saves on this device. Clearing browser data can remove it. Reconnect its original cloud account to resume encrypted sync.'
      : 'Your journal saves on this device. Clearing browser data can remove it. Connect your own cloud account for encrypted cloud storage and sync across your devices.';
    ui.confirmation.hidden = !!header;
    ui.password.autocomplete = header ? 'current-password' : 'new-password';
    ui.passwordConfirm.required = !header;
    ui.unlock.textContent = working ? 'Working…' : header ? 'Unlock cloud' : 'Enable encrypted sync';
    ui.unlock.disabled = working;
    ui.vaultDescription.textContent = header ? 'Enter the same cloud password you use on your other devices.'
      : 'Choose a cloud password of at least 12 characters. Use the same password on each device.';
    ui.importLegacy.disabled = !unlocked || working;
  };
  const use = (vault: EncryptedFiles) => {
    unlocked = true;
    options.change(new SyncEngine(journal, vault), providerName);
    ui.password.value = ''; ui.passwordConfirm.value = '';
    show();
  };
  const guard = () => {
    if (working || options.busy()) throw new Error('Wait for the current cloud operation to finish.');
  };
  const inspect = async () => {
    if (!session) return;
    header = await EncryptedFiles.inspect(session.files);
    inspected = true;
    const saved = await local.setting<RememberedVault>(VAULT_KEY_SETTING);
    if (header) {
      const vault = EncryptedFiles.remembered(session.files, header, saved);
      if (vault) use(vault);
    }
    ui.legacy.hidden = !session.legacyFiles || !(await session.legacyFiles.list()).length;
    ui.legacyDescription.textContent = `Older, unencrypted files remain in ${providerName}. Import them to include entries from other devices. Importing leaves the originals and cloud version history in place; remove old copies separately if needed.`;
  };
  const buttons = providers.map(entry => {
    const button = document.createElement('button');
    button.className = 'primary-button'; button.textContent = `Connect ${entry.name}`;
    button.onclick = () => { void (async () => {
      guard(); setWorking(true); show();
      try { await journal.flush(); await connectCloud(entry); }
      finally { setWorking(false); show(); }
    })().catch(options.notify); };
    ui.providerList.append(button);
    return [entry, button] as const;
  });
  ui.vaultForm.onsubmit = event => {
    event.preventDefault();
    void (async () => {
      guard();
      if (!session) return;
      if (!header && ui.password.value !== ui.passwordConfirm.value) throw new Error('The passwords do not match.');
      setWorking(true); show();
      try {
        const current = await EncryptedFiles.inspect(session.files);
        const vault = current ? await EncryptedFiles.unlock(session.files, current, ui.password.value)
          : await EncryptedFiles.create(session.files, ui.password.value);
        header = await EncryptedFiles.inspect(session.files);
        if (ui.remember.checked) await local.rememberVaultKey({ descriptor: vault.descriptor, key: vault.key });
        else await local.removeSetting(VAULT_KEY_SETTING);
        use(vault); ui.notice.hidden = true;
        await options.sync();
      } finally { setWorking(false); ui.password.value = ''; ui.passwordConfirm.value = ''; show(); }
    })().catch(options.notify);
  };
  ui.lock.onclick = () => { void (async () => {
    guard(); setWorking(true);
    try { await local.removeSetting(VAULT_KEY_SETTING); unlocked = false; options.change(); }
    finally { setWorking(false); show(); }
  })().catch(options.notify); };
  ui.disconnect.onclick = () => { void (async () => {
    guard(); setWorking(true);
    try {
      await session?.disconnect();
      session = undefined; header = undefined; unlocked = false; inspected = false;
      options.change(); ui.legacy.hidden = true;
    } finally { setWorking(false); show(); }
  })().catch(options.notify); };
  ui.importLegacy.onclick = () => { void (async () => {
    guard();
    if (!session?.legacyFiles || !unlocked) return;
    setWorking(true); show();
    try {
      await new SyncEngine(journal, session.legacyFiles).importOnly();
      await options.sync();
      options.notify('Older files imported. The unencrypted originals and their version history remain in cloud storage.');
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
    if (session && !inspected && !working) void check().then(options.sync);
  });
  show(); await check();
}
