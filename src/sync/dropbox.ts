import { journalUrl } from '../urls';
import type { LocalStore } from '../storage/local';
import type { VaultStorage, RemoteFile } from './cloud';
import type { CloudProvider } from './provider';

type Connection = {
  appKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
};
type OAuthAttempt = { appKey: string; verifier: string; state: string; redirectUri: string };
type TokenResponse = {
  access_token: string; refresh_token?: string; expires_in: number; account_id?: string;
};
type FileEntry = { '.tag': string; path_lower: string; rev: string };
type FolderPage = { entries: FileEntry[]; cursor: string; has_more: boolean };

const OAUTH = 'minijour-oauth';
const ROOT = '/minijour-encrypted-v1';
const identity = (connection: Connection) => ({ providerId: 'dropbox', appId: connection.appKey, accountId: connection.accountId });

export function dropboxProvider(appKey: string): CloudProvider {
  return {
    id: 'dropbox', name: 'Dropbox',
    connect: () => connectDropbox(appKey),
    finishConnection: local => finishDropboxConnection(local, appKey),
    open: async local => {
      const files = await DropboxFiles.open(local, appKey);
      return files ? { files, disconnect: () => DropboxFiles.disconnect(local) } : undefined;
    },
  };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function connectDropbox(appKey: string): Promise<void> {
  if (!/^[a-zA-Z0-9]+$/.test(appKey.trim())) throw new Error('Enter a valid Dropbox app key.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const attempt: OAuthAttempt = { appKey: appKey.trim(), verifier, state, redirectUri: journalUrl.href };
  sessionStorage.setItem(OAUTH, JSON.stringify(attempt));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const params = new URLSearchParams({
    client_id: attempt.appKey, response_type: 'code', redirect_uri: attempt.redirectUri,
    state, code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline',
    scope: 'files.metadata.read files.content.read files.content.write',
  });
  location.assign(`https://www.dropbox.com/oauth2/authorize?${params}`);
}

async function tokenRequest(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST', body: params, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Dropbox authorization expired or failed. Please reconnect.');
  return response.json();
}

/** Finish PKCE after Dropbox redirects back. Tokens stay on this device. */
async function finishDropboxConnection(local: LocalStore, appKey: string): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  const raw = sessionStorage.getItem(OAUTH);
  try {
    if (!raw) throw new Error('Dropbox connection was started in another tab. Please try again.');
    const attempt: OAuthAttempt = JSON.parse(raw);
    if (attempt.appKey !== appKey) throw new Error('Dropbox sign-in has changed. Please start connecting again.');
    if (params.get('state') !== attempt.state) throw new Error('Dropbox authorization could not be verified. Please try again.');
    if (params.has('error')) throw new Error('Dropbox connection was cancelled. Your journal is still saved on this device.');
    const token = await tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code', client_id: attempt.appKey, code: params.get('code')!,
      code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri,
    }));
    if (!token.refresh_token || !token.account_id) throw new Error('Dropbox did not grant offline access. Please reconnect.');
    const connection = {
      appKey: attempt.appKey, accessToken: token.access_token, refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000, accountId: token.account_id,
    } satisfies Connection;
    await local.saveCloudConnection(identity(connection), connection);
    return true;
  } finally {
    sessionStorage.removeItem(OAUTH);
  }
}

/** A thin Dropbox API adapter. Dropbox stores bytes; Automerge merges them. */
export class DropboxFiles implements VaultStorage {
  private refreshing?: Promise<void>;
  private constructor(private local: LocalStore, private connection: Connection) {}

  static async open(local: LocalStore, appKey: string): Promise<DropboxFiles | undefined> {
    const connection = await local.cloudConnection<Connection>('dropbox');
    if (connection && connection.appKey !== appKey) throw new Error('This journal uses a different Dropbox app. Its original app and account are needed to resume sync.');
    return connection ? new DropboxFiles(local, connection) : undefined;
  }

  static async disconnect(local: LocalStore): Promise<void> {
    await local.disconnectCloud('dropbox');
  }

  private async token(): Promise<string> {
    const active = await this.local.cloudConnection<Connection>('dropbox');
    if (!active || active.accountId !== this.connection.accountId || active.appKey !== this.connection.appKey) {
      throw new Error('Dropbox was disconnected in another tab. Reload to update this app.');
    }
    if (Date.now() >= this.connection.expiresAt - 60_000) {
      this.refreshing ??= (async () => {
        const token = await tokenRequest(new URLSearchParams({
          grant_type: 'refresh_token', client_id: this.connection.appKey,
          refresh_token: this.connection.refreshToken,
        }));
        this.connection = { ...this.connection, accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
        // A disconnect during the refresh request must not restore a connection.
        await this.local.saveCloudConnection(identity(this.connection), this.connection, { requireExisting: true });
      })().finally(() => { this.refreshing = undefined; });
      await this.refreshing;
    }
    return this.connection.accessToken;
  }

  private async request(endpoint: string, args: object, content?: Uint8Array): Promise<Response> {
    const token = await this.token();
    const download = endpoint === 'files/download';
    const contentEndpoint = download || content !== undefined;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (contentEndpoint) {
      headers['Dropbox-API-Arg'] = JSON.stringify(args);
      if (content) headers['Content-Type'] = 'application/octet-stream';
    } else headers['Content-Type'] = 'application/json';
    const response = await fetch(`https://${contentEndpoint ? 'content' : 'api'}.dropboxapi.com/2/${endpoint}`, {
      method: 'POST', headers,
      body: content ? new Blob([new Uint8Array(content)]) : download ? undefined : JSON.stringify(args),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Dropbox access expired. Disconnect and reconnect in settings.');
      if (response.status === 429) throw new Error('Dropbox is busy. Your changes are saved locally; sync will retry.');
      if (response.status === 409 && /^(?:path|path_lookup)\/not_found/.test(String(detail.error_summary))) {
        throw new MissingPath();
      }
      if (response.status === 409 && String(detail.error_summary).startsWith('path/conflict')) throw new FileExists();
      throw new Error(`Dropbox could not complete the request (${response.status}). Your local journal is safe.`);
    }
    return response;
  }

  async list(): Promise<RemoteFile[]> {
    let page: FolderPage;
    try {
      page = await (await this.request('files/list_folder', { path: ROOT, recursive: true, include_deleted: false })).json();
    } catch (error) {
      if (error instanceof MissingPath) return [];
      throw error;
    }
    const files: RemoteFile[] = [];
    while (true) {
      for (const entry of page.entries) {
        if (entry['.tag'] === 'file') files.push({ path: entry.path_lower.slice(ROOT.length), revision: entry.rev });
      }
      if (!page.has_more) return files;
      page = await (await this.request('files/list_folder/continue', { cursor: page.cursor })).json();
    }
  }

  async download(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request('files/download', { path: ROOT + path })).arrayBuffer());
  }

  async upload(path: string, bytes: Uint8Array): Promise<RemoteFile> {
    // Every open app has a unique writer path. Only that writer updates it.
    const result = await (await this.request('files/upload', {
      path: ROOT + path, mode: 'overwrite', autorename: false, mute: true,
    }, bytes)).json() as { rev: string };
    return { path, revision: result.rev };
  }

  async create(path: string, bytes: Uint8Array): Promise<boolean> {
    try {
      await this.request('files/upload', {
        path: ROOT + path, mode: 'add', autorename: false, strict_conflict: true, mute: true,
      }, bytes);
      return true;
    } catch (error) {
      if (error instanceof FileExists) return false;
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    try { await this.request('files/delete_v2', { path: ROOT + path }); }
    catch (error) { if (!(error instanceof MissingPath)) throw error; }
  }
}

class MissingPath extends Error {}
class FileExists extends Error {}
