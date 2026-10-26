import { expect, type BrowserContext } from '@playwright/test';

/** Mock the network boundary, exercising real PKCE, API requests, and the UI. */
export class DropboxMock {
  files = new Map<string, { bytes: Buffer; revision: string }>();
  revision = 0;
  accountId = 'test-account';
  apiCalls = 0;
  deleteFailures = 0;
  deleteAlreadyMissing = false;
  async install(context: BrowserContext) {
    await context.route('https://www.dropbox.com/oauth2/authorize?**', route => {
      const params = new URL(route.request().url()).searchParams;
      expect(params.get('code_challenge_method')).toBe('S256');
      const callback = new URL(params.get('redirect_uri')!);
      callback.searchParams.set('code', 'test-code');
      callback.searchParams.set('state', params.get('state')!);
      return route.fulfill({ status: 302, headers: { location: callback.href } });
    });
    await context.route('https://api.dropboxapi.com/oauth2/token', async route => {
      const params = new URLSearchParams(route.request().postData()!);
      expect(params.get('code_verifier')?.length).toBeGreaterThanOrEqual(43);
      await route.fulfill({ json: { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 14400, account_id: this.accountId } });
    });
    await context.route(/https:\/\/(api|content)\.dropboxapi\.com\/2\//, async route => {
      this.apiCalls++;
      const request = route.request();
      const endpoint = new URL(request.url()).pathname;
      const args = JSON.parse(request.headers()['dropbox-api-arg'] || request.postData() || '{}');
      if (endpoint.endsWith('/list_folder')) {
        await route.fulfill({ json: {
          entries: [...this.files].filter(([path]) => path.startsWith(args.path + '/')).map(([path, file]) => ({ '.tag': 'file', path_lower: path, rev: file.revision })),
          cursor: 'cursor', has_more: false,
        } });
      } else if (endpoint.endsWith('/upload')) {
        const path = args.path;
        if (args.mode === 'add' && this.files.has(path)) {
          await route.fulfill({ status: 409, json: { error_summary: 'path/conflict/file' } });
          return;
        }
        const revision = String(++this.revision);
        this.files.set(path, { bytes: request.postDataBuffer()!, revision });
        await route.fulfill({ json: { rev: revision } });
      } else if (endpoint.endsWith('/delete_v2')) {
        if (this.deleteFailures > 0) {
          this.deleteFailures--;
          await route.fulfill({ status: 503, json: { error_summary: 'temporarily_unavailable' } });
          return;
        }
        if (this.deleteAlreadyMissing) this.files.delete(args.path);
        if (this.files.delete(args.path)) await route.fulfill({ json: { metadata: { '.tag': 'file' } } });
        else await route.fulfill({ status: 409, json: { error_summary: 'path_lookup/not_found/.' } });
      } else if (endpoint.endsWith('/download')) {
        const file = this.files.get(args.path);
        if (file) await route.fulfill({ body: file.bytes, contentType: 'application/octet-stream' });
        else await route.fulfill({ status: 409, json: { error_summary: 'path/not_found/.' } });
      } else await route.fulfill({ status: 400 });
    });
  }
}
