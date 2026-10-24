import type { LocalStore } from '../storage/local';
import type { CloudFiles, RemoteFile } from './cloud';

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

const CONNECTION = 'dropbox-connection';
const OAUTH = 'minijour-oauth';
const ROOT = '/minijour-v1';

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function redirectUri(): string {
  return `${location.origin}${location.pathname}`;
}

export async function connectDropbox(appKey: string): Promise<void> {
  if (!/^[a-zA-Z0-9]+$/.test(appKey.trim())) throw new Error('Enter a valid Dropbox app key.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const attempt: OAuthAttempt = { appKey: appKey.trim(), verifier, state, redirectUri: redirectUri() };
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
export async function finishDropboxConnection(local: LocalStore): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  const raw = sessionStorage.getItem(OAUTH);
  try {
    if (!raw) throw new Error('Dropbox connection was started in another tab. Please try again.');
    const attempt: OAuthAttempt = JSON.parse(raw);
    if (params.get('state') !== attempt.state) throw new Error('Dropbox authorization could not be verified. Please try again.');
    if (params.has('error')) throw new Error('Dropbox connection was cancelled. Your journal is still saved on this device.');
    const token = await tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code', client_id: attempt.appKey, code: params.get('code')!,
      code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri,
    }));
    if (!token.refresh_token || !token.account_id) throw new Error('Dropbox did not grant offline access. Please reconnect.');
    await local.saveDropboxConnection({
      appKey: attempt.appKey, accessToken: token.access_token, refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000, accountId: token.account_id,
    } satisfies Connection);
    return true;
  } finally {
    sessionStorage.removeItem(OAUTH);
    params.delete('code'); params.delete('state'); params.delete('error'); params.delete('error_description');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  }
}

/** A thin Dropbox API adapter. Dropbox stores bytes; Automerge merges them. */
export class DropboxFiles implements CloudFiles {
  private refreshing?: Promise<void>;
  private constructor(private local: LocalStore, private connection: Connection) {}

  static async open(local: LocalStore): Promise<DropboxFiles | undefined> {
    const connection = await local.setting<Connection>(CONNECTION);
    if (connection) await local.saveDropboxConnection(connection);
    return connection ? new DropboxFiles(local, connection) : undefined;
  }

  static async disconnect(local: LocalStore): Promise<void> {
    await local.removeSetting(CONNECTION);
  }

  private async token(): Promise<string> {
    const active = await this.local.setting<Connection>(CONNECTION);
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
        if (!await this.local.setting(CONNECTION)) throw new Error('Dropbox was disconnected. Reconnect to continue syncing.');
        await this.local.saveDropboxConnection(this.connection);
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
      if (response.status === 409 && String(detail.error_summary).startsWith('path/not_found')) {
        throw new MissingFolder();
      }
      throw new Error(`Dropbox could not complete the request (${response.status}). Your local journal is safe.`);
    }
    return response;
  }

  async list(): Promise<RemoteFile[]> {
    let page: FolderPage;
    try {
      page = await (await this.request('files/list_folder', { path: ROOT, recursive: true, include_deleted: false })).json();
    } catch (error) {
      if (error instanceof MissingFolder) return [];
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
}

class MissingFolder extends Error {}
