import * as A from '@automerge/automerge';
import { createDay, editDay } from '../../src/domain/day';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function openJournal(page: Page) {
  await page.goto('./');
  await expect(page.locator('.cm-content').last()).toBeVisible();
}

test('opens ready to write, saves Markdown, and restores it without another heading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openJournal(page);
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.insertText('A quiet morning. 🦊\n\n**Something to remember.**');
  await expect(page.getByRole('status')).toContainText('Saved on this device');
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('A quiet morning. 🦊');
  await expect(page.locator('.day-heading')).toHaveCount(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('inserts a device photo at the cursor and restores its preview', async ({ page }) => {
  await openJournal(page);
  await page.keyboard.insertText('Before. After.');
  await page.keyboard.press('Home');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose from device' })).toBeVisible();
  await page.locator('#photo-input').setInputFiles('public/icon-192.png');
  await expect(page.locator('.photo-preview img')).toBeVisible();
  const text = await page.locator('.cm-content').innerText();
  expect(text.indexOf('Before.')).toBeLessThan(text.indexOf('![Photo]'));
  expect(text.indexOf('![Photo]')).toBeLessThan(text.indexOf('After.'));
  await expect(page.getByRole('status')).toContainText('Saved on this device');
  await page.reload();
  await expect(page.locator('.photo-preview img')).toBeVisible();
});

test('loads and writes offline after the app shell has installed', async ({ page, context }) => {
  await openJournal(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.locator('.cm-content')).toBeFocused();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('Written without a connection.');
  await expect(page.getByRole('status')).toContainText('offline');
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Written without a connection.');
});

test('appends the new local day once after midnight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-24T21:59:59Z') });
  await openJournal(page);
  await page.keyboard.insertText('Saturday memory.');
  await page.clock.runFor(2100);
  await expect(page.locator('.day-heading time')).toHaveText(['2026-10-24', '2026-10-25']);
  await expect(page.locator('.cm-content').last()).toBeFocused();
  await page.keyboard.insertText('Sunday memory.');
  await page.reload();
  await expect(page.locator('.day')).toHaveCount(2);
  await expect(page.locator('.cm-content').first()).toContainText('Saturday memory.');
  await expect(page.locator('.cm-content').last()).toContainText('Sunday memory.');
});

test('shares local edits between tabs without replacing another tab’s typing', async ({ page, context }) => {
  await openJournal(page);
  const other = await context.newPage();
  await openJournal(other);
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('First tab.');
  await expect(other.locator('.cm-content')).toContainText('First tab.');
  await other.locator('.cm-content').click();
  await other.keyboard.press('End');
  await other.keyboard.insertText(' Second tab.');
  await expect(page.locator('.cm-content')).toContainText('Second tab.');
});

test('keeps incoming edits while the other editor is composing text', async ({ page, context }) => {
  await openJournal(page);
  const other = await context.newPage();
  await openJournal(other);
  const content = page.locator('.cm-content');
  await content.dispatchEvent('compositionstart');
  await page.keyboard.insertText('Composed memory.');
  await expect(other.locator('.cm-content')).toContainText('Composed memory.');
  await other.locator('.cm-content').click();
  await other.keyboard.press('End');
  await other.keyboard.insertText(' Remote memory.');
  await content.dispatchEvent('compositionend');
  await expect(content).toContainText('Remote memory.');
  await expect(content).toContainText('Composed memory.');
});

test('downloads a complete backup and restores it on a fresh device', async ({ page, browser }, testInfo) => {
  await openJournal(page);
  await page.keyboard.insertText('A memory to take with me.');
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backup = await download;
  const file = testInfo.outputPath('journal.zip');
  await backup.saveAs(file);
  const fresh = await browser.newContext();
  const restored = await fresh.newPage();
  await openJournal(restored);
  await restored.getByRole('button', { name: 'Settings and backup' }).click();
  await restored.locator('#restore-input').setInputFiles(file);
  await expect(restored.getByRole('alert')).toContainText('Backup restored');
  await restored.getByRole('button', { name: 'Close settings' }).click();
  await expect(restored.locator('.cm-content')).toContainText('A memory to take with me.');
  await fresh.close();
});

/** Mock the network boundary, exercising real PKCE, API requests, and the UI. */
class DropboxMock {
  files = new Map<string, { bytes: Buffer; revision: string }>();
  revision = 0;
  accountId = 'test-account';
  apiCalls = 0;
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
      } else if (endpoint.endsWith('/download')) {
        const file = this.files.get(args.path);
        await route.fulfill({ body: file!.bytes, contentType: 'application/octet-stream' });
      } else await route.fulfill({ status: 400 });
    });
  }
}

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  const appKey = page.getByLabel('Dropbox app key', { exact: true });
  if (await appKey.isVisible()) await appKey.fill('testkey');
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await unlock(page);
}

const PASSWORD = 'three random words for testing';
async function unlock(page: Page, remember = true) {
  await page.getByLabel('Cloud password', { exact: true }).fill(PASSWORD);
  const confirmation = page.getByLabel('Repeat cloud password');
  if (await confirmation.isVisible()) await confirmation.fill(PASSWORD);
  await page.getByLabel('Remember the key on this device').setChecked(remember);
  await page.locator('#unlock-button').click();
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
  await page.getByRole('button', { name: 'Close settings' }).click();
}

async function sync(page: Page) {
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
  await page.getByRole('button', { name: 'Close settings' }).click();
}

test('connects Dropbox and merges offline changes across two browser devices', async ({ browser }) => {
  const mock = new DropboxMock();
  const phone = await browser.newContext({ serviceWorkers: 'block' });
  const laptop = await browser.newContext({ serviceWorkers: 'block' });
  await mock.install(phone); await mock.install(laptop);
  const first = await phone.newPage();
  const second = await laptop.newPage();
  await openJournal(first);
  await first.keyboard.insertText('Morning walk.');
  await connect(first);
  await openJournal(second);
  await connect(second);
  await expect(second.locator('.cm-content')).toContainText('Morning walk.');
  await phone.setOffline(true); await laptop.setOffline(true);
  await first.locator('.cm-content').click(); await first.keyboard.press('End');
  await first.keyboard.insertText(' Saw a fox.');
  await second.locator('.cm-content').click(); await second.keyboard.press('Home');
  await second.keyboard.insertText('Long ');
  await phone.setOffline(false); await laptop.setOffline(false);
  await sync(first); await sync(second); await sync(first);
  const text = await first.locator('.cm-content').innerText();
  expect(text).toContain('Long Morning walk.');
  expect(text).toContain('Saw a fox.');
  await expect(second.locator('.cm-content')).toHaveText(text);
  await first.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await first.locator('#photo-input').setInputFiles('public/icon-192.png');
  await expect(first.locator('.photo-preview img')).toBeVisible();
  await sync(first); await sync(second);
  await expect(second.locator('.photo-preview img')).toBeVisible();
  await second.reload();
  await expect(second.locator('.photo-preview img')).toBeVisible();
  await phone.close(); await laptop.close();
});

test('configured deployments hide developer setup and use the shared public app key', async ({ page, context }) => {
  test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'Run with VITE_DROPBOX_APP_KEY to exercise a configured deployment.');
  const mock = new DropboxMock();
  await mock.install(context);
  await openJournal(page);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await expect(page.getByLabel('Dropbox app key', { exact: true })).toBeHidden();
  await expect(page.getByLabel('OAuth redirect URI')).toBeHidden();
  const authorization = page.waitForRequest(request => request.url().startsWith('https://www.dropbox.com/oauth2/authorize?'));
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  expect(new URL((await authorization).url()).searchParams.get('client_id')).toBe(process.env.VITE_DROPBOX_APP_KEY);
  await unlock(page);
});

test('blocks a different Dropbox account without sending it any journal data', async ({ page, context }) => {
  const mock = new DropboxMock();
  await mock.install(context);
  await openJournal(page);
  await page.keyboard.insertText('Keep this journal in its original account.');
  await connect(page);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Dropbox', exact: true })).toBeVisible();
  const previousCalls = mock.apiCalls;
  mock.accountId = 'another-account';
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different Dropbox account');
  await expect(page.locator('.cm-content')).toContainText('Keep this journal');
  expect(mock.apiCalls).toBe(previousCalls);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Saved on this device');
  await expect(page.locator('.cm-content')).toContainText('Keep this journal');
  mock.accountId = 'test-account';
  await connect(page);
});

test('identifies the version and serves licensing beside the installed app', async ({ page, request, baseURL }) => {
  await openJournal(page);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  const build = await (await request.get(new URL('build.json', baseURL!).href)).json();
  await expect(page.locator('.app-version')).toHaveText(build.version);
  await expect(page.getByRole('link', { name: 'Source for this build' })).toHaveAttribute('href', build.sourceUrl);
  expect(build.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  const license = await request.get(new URL('LICENSE.txt', baseURL!).href);
  expect(license.ok()).toBe(true);
  expect(await license.text()).toContain('GNU GENERAL PUBLIC LICENSE');
  const notices = await request.get(new URL('THIRD_PARTY_NOTICES.txt', baseURL!).href);
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain('@automerge/automerge@');
});

test('keeps cloud locked after reload unless remembering was requested, and never uploads after a wrong password', async ({ page, context }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await page.keyboard.insertText('Private memory.');
  await connect(page);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByRole('button', { name: 'Lock cloud', exact: true }).click();
  await expect(page.getByLabel('Cloud password', { exact: true })).toBeVisible();
  await page.getByLabel('Cloud password', { exact: true }).fill('incorrect password');
  const writes = mock.revision;
  await page.getByRole('button', { name: 'Unlock cloud', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not unlock');
  expect(mock.revision).toBe(writes);
  await unlock(page, false);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Private memory.');
  await page.keyboard.press('End'); await page.keyboard.insertText(' Local writing still works.');
  await expect(page.getByRole('status')).toHaveText('Saved on this device');
  expect(mock.revision).toBe(writes);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await expect(page.getByRole('button', { name: 'Unlock cloud', exact: true })).toBeVisible();
  await unlock(page, true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
  for (const [path, file] of mock.files) {
    expect(path).not.toContain('2026-10-24');
    expect(path).not.toContain('photos');
    expect(file.bytes.toString()).not.toContain('Private memory.');
    expect(file.bytes.toString()).not.toContain(PASSWORD);
  }
});

test('requires matching passwords on setup and keeps local writing available after interrupted cloud checks', async ({ page, context }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  const appKey = page.getByLabel('Dropbox app key', { exact: true });
  if (await appKey.isVisible()) await appKey.fill('testkey');
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await page.getByLabel('Cloud password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat cloud password').fill('different password');
  await page.getByRole('button', { name: 'Enable encrypted sync', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('do not match');
  expect(mock.files.size).toBe(0);
  await unlock(page);
  // Abort the network at the boundary rather than mock the storage/crypto code.
  await context.route(/https:\/\/(api|content)\.dropboxapi\.com\/2\//, route => route.abort());
  await page.reload();
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.insertText('Writing while cloud access is unavailable.');
  await expect(page.getByRole('status')).toHaveText('Saved on this device');
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose from device' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await expect(page.getByRole('button', { name: 'Check Dropbox' })).toBeVisible();
});


test('imports older plaintext Dropbox entries and photos explicitly without modifying their originals', async ({ page, context }) => {
  const mock = new DropboxMock();
  const photo = `${crypto.randomUUID()}.jpg`;
  const path = `/minijour-v1/days/2020-01-01/${crypto.randomUUID()}.automerge`;
  const original = Buffer.from(A.save(editDay(createDay('2020-01-01'), `Older private memory. ![Photo](photos/${photo})`)));
  mock.files.set(path, { bytes: original, revision: 'old' });
  mock.files.set(`/minijour-v1/photos/${photo}`, { bytes: Buffer.from('older photo'), revision: 'old-photo' });
  await mock.install(context);
  await openJournal(page); await connect(page);
  await expect(page.locator('.cm-content')).not.toContainText('Older private memory.');
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await expect(page.locator('#legacy-cloud')).toContainText('unencrypted files still exist');
  await page.getByRole('button', { name: 'Import older Dropbox files' }).click();
  await expect(page.getByRole('alert')).toContainText('Older files imported');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('.cm-content').first()).toContainText('Older private memory.');
  expect(mock.files.get(path)!.bytes).toEqual(original);
  expect([...mock.files.keys()].filter(name => name.startsWith('/minijour-v1/'))).toHaveLength(2);
  expect([...mock.files.keys()].some(name => name.startsWith('/minijour-encrypted-v1/objects/'))).toBe(true);
});
