import type { LocalStore } from '../storage/local';
import { dropboxProvider } from './dropbox';
import type { CloudProvider } from './provider';

const AUTH_PROVIDER = 'minijour-cloud-auth-provider';

/** Only implemented providers with deployment configuration appear in the app.
 * Adding a provider means adding its adapter/factory here, not UI branches.
 */
export function configuredProviders(env: { VITE_DROPBOX_APP_KEY?: string } = import.meta.env): CloudProvider[] {
  const providers: CloudProvider[] = [];
  const dropboxKey = env.VITE_DROPBOX_APP_KEY?.trim();
  if (dropboxKey && /^[a-zA-Z0-9]+$/.test(dropboxKey)) providers.push(dropboxProvider(dropboxKey));
  return providers;
}

export async function connectCloud(provider: CloudProvider): Promise<void> {
  sessionStorage.setItem(AUTH_PROVIDER, provider.id);
  try { await provider.connect(); }
  catch (error) { sessionStorage.removeItem(AUTH_PROVIDER); throw error; }
}

export async function finishCloudConnection(local: LocalStore, providers: CloudProvider[]): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  try {
    // Preserve OAuth attempts started by versions predating the registry.
    const id = sessionStorage.getItem(AUTH_PROVIDER)
      ?? (sessionStorage.getItem('minijour-oauth') ? 'dropbox' : undefined);
    if (!id) throw new Error('Cloud connection was started in another tab. Please try again.');
    const provider = providers.find(provider => provider.id === id);
    if (!provider) throw new Error('This cloud connection is unavailable on this website. Your journal stays on this device.');
    return await provider.finishConnection(local);
  } finally {
    sessionStorage.removeItem(AUTH_PROVIDER);
    params.delete('code'); params.delete('state'); params.delete('error'); params.delete('error_description');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  }
}
