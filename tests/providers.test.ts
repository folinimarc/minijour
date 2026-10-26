import { afterEach, expect, it, vi } from 'vitest';
import { LocalStore } from '../src/storage/local';
import { configuredProviders, connectCloud, finishCloudConnection } from '../src/sync/providers';
import { dropboxProvider, DropboxFiles } from '../src/sync/dropbox';
import type { CloudProvider } from '../src/sync/provider';

const stores: LocalStore[] = [];
async function store() {
  const local = await LocalStore.open(crypto.randomUUID()); stores.push(local); return local;
}
function browserCallback() {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal('location', { search: '?code=test-code&state=test-state', pathname: '/journal/', hash: '' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  return values;
}
function provider(id: string): CloudProvider {
  return { id, name: id, connect: vi.fn(async () => {}),
    finishConnection: vi.fn(async () => true), open: vi.fn(async () => undefined) };
}
afterEach(() => { stores.splice(0).forEach(local => local.close()); vi.unstubAllGlobals(); });

it('lists only implemented providers with valid deployment configuration', () => {
  expect(configuredProviders({})).toEqual([]);
  expect(configuredProviders({ VITE_DROPBOX_APP_KEY: '  ' })).toEqual([]);
  expect(configuredProviders({ VITE_DROPBOX_APP_KEY: 'not a key' })).toEqual([]);
  const configured = configuredProviders({ VITE_DROPBOX_APP_KEY: ' publickey ' });
  expect(configured.map(({ id, name }) => ({ id, name }))).toEqual([{ id: 'dropbox', name: 'Dropbox' }]);
});

it('routes authentication to the selected provider, independently of registry order', async () => {
  const values = browserCallback(), first = provider('first'), chosen = provider('second');
  await connectCloud(chosen);
  expect(chosen.connect).toHaveBeenCalledOnce();
  expect(await finishCloudConnection(await store(), [first, chosen])).toBe(true);
  expect(chosen.finishConnection).toHaveBeenCalledOnce();
  expect(first.finishConnection).not.toHaveBeenCalled();
  expect(values.has('minijour-cloud-auth-provider')).toBe(false);
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/journal/');
});

it('rejects callbacks from a removed provider without exchanging tokens', async () => {
  const values = browserCallback(), disabled = provider('disabled');
  await connectCloud(disabled);
  await expect(finishCloudConnection(await store(), [])).rejects.toThrow('unavailable');
  expect(disabled.finishConnection).not.toHaveBeenCalled();
  expect(values.has('minijour-cloud-auth-provider')).toBe(false);
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/journal/');
});

it('rejects callbacks without a selected provider rather than guessing from stored attempts', async () => {
  const values = browserCallback(), dropbox = provider('dropbox');
  values.set('minijour-oauth', 'legacy-attempt');
  await expect(finishCloudConnection(await store(), [provider('other'), dropbox])).rejects.toThrow('started in another tab');
  expect(dropbox.finishConnection).not.toHaveBeenCalled();
});

it('rejects a Dropbox callback if the deployed app key changed during authorization', async () => {
  const values = browserCallback(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  values.set('minijour-cloud-auth-provider', 'dropbox');
  values.set('minijour-oauth', JSON.stringify({ appKey: 'previouskey', state: 'test-state' }));
  const local = await store();
  await expect(finishCloudConnection(local, [dropboxProvider('currentkey')])).rejects.toThrow('sign-in has changed');
  expect(fetch).not.toHaveBeenCalled();
  expect(await local.cloudConnection('dropbox')).toBeUndefined();
  expect(values.has('minijour-oauth')).toBe(false);
});

it('keeps provider, app, and account ownership after disconnect, including for future adapters', async () => {
  const local = await store();
  const original = { providerId: 'example-drive', appId: 'app', accountId: 'account' };
  await local.saveCloudConnection(original, { token: 'original' });
  await local.rememberVaultKey({ key: 'remembered' });
  await local.disconnectCloud(original.providerId);
  expect(await local.cloudOwner()).toEqual(original);
  expect(await local.setting('cloud-vault-key')).toBeUndefined();
  for (const other of [
    { ...original, providerId: 'dropbox' }, { ...original, appId: 'other-app' }, { ...original, accountId: 'other' },
  ]) await expect(local.saveCloudConnection(other, {})).rejects.toThrow('different cloud provider');
  await expect(local.rememberVaultKey({ key: 'late-unlock' })).rejects.toThrow('disconnected');
  await expect(local.saveCloudConnection(original, {}, { requireExisting: true })).rejects.toThrow('disconnected');
  expect(await local.cloudConnection('dropbox')).toBeUndefined();
  await local.saveCloudConnection(original, { token: 'reconnected' });
  expect(await local.cloudConnection(original.providerId)).toEqual({ token: 'reconnected' });
});

it('opens the configured Dropbox connection without changing its tokens, remembered key, or owner', async () => {
  const local = await store();
  const connection = { appKey: 'originalkey', accountId: 'original-account', accessToken: 'original-token' };
  await local.saveCloudConnection({ providerId: 'dropbox', appId: 'originalkey', accountId: 'original-account' }, connection);
  await local.setSetting('cloud-vault-key', { descriptor: 'existing-vault' });
  expect(await local.cloudOwner()).toEqual({ providerId: 'dropbox', appId: 'originalkey', accountId: 'original-account' });
  await DropboxFiles.open(local, 'originalkey');
  expect(await local.setting('cloud-journal-owner')).toEqual(await local.cloudOwner());
  expect(await local.cloudConnection('dropbox')).toEqual(connection);
  expect(await local.setting('cloud-vault-key')).toEqual({ descriptor: 'existing-vault' });
  await expect(DropboxFiles.open(local, 'replacementkey')).rejects.toThrow('different Dropbox app');
  await local.disconnectCloud('dropbox');
  await expect(local.saveCloudConnection({ providerId: 'other', appId: 'app', accountId: 'account' }, {})).rejects.toThrow('different cloud provider');
});

it('serializes competing first connections across different providers', async () => {
  const local = await store();
  const results = await Promise.allSettled([
    local.saveCloudConnection({ providerId: 'first', appId: 'app', accountId: 'account' }, {}),
    local.saveCloudConnection({ providerId: 'second', appId: 'app', accountId: 'account' }, {}),
  ]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(await local.cloudConnection('second')).toBeUndefined();
});
