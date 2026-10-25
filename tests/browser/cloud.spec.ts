import * as A from '@automerge/automerge';
import { createDay, editDay } from '../../src/domain/day';
import { expect, test } from '@playwright/test';
import { DropboxMock } from './dropbox-mock';
import { openDate, openJournal, addTestPhoto, replaceEntry, storedDates, storedPhotos, connect, unlock, sync, PASSWORD } from './helpers';

test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'This build has no configured Dropbox provider.');

test('does not sync blank drafts, and a cleared future entry stays cleared on another device', async ({ page, context, browser }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await connect(page);
  await openDate(page, '2030-01-02'); await sync(page);
  expect(await storedDates(page)).toEqual([]);
  expect([...mock.files.keys()].filter(path => path.includes('/objects/'))).toEqual([]);
  await page.keyboard.insertText('A future memory.'); await sync(page);
  const fresh = await browser.newContext({ serviceWorkers: 'block' }); await mock.install(fresh);
  const other = await fresh.newPage(); await openJournal(other); await connect(other);
  await openDate(other, '2030-01-02');
  await expect(other.locator('[data-date="2030-01-02"] .cm-content')).toContainText('A future memory.');
  await other.reload();
  await expect(other.locator('.cm-content')).toBeFocused();
  await page.locator('[data-date="2030-01-02"] .cm-content').click();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  await sync(page); await sync(other);
  await expect(other.locator('[data-date="2030-01-02"]')).toBeHidden();
  await expect(other.locator('.day-heading:visible')).toHaveCount(1);
  expect(await storedDates(other)).toEqual(['2030-01-02']); // Deletion history prevents stale resurrection.
  await fresh.close();
});

test('connects Dropbox and merges offline changes across two browser devices', async ({ browser }) => {
  const mock = new DropboxMock();
  const phone = await browser.newContext({ serviceWorkers: 'block' });
  const laptop = await browser.newContext({ serviceWorkers: 'block' });
  await mock.install(phone); await mock.install(laptop);
  const first = await phone.newPage();
  const second = await laptop.newPage();
  await openJournal(first);
  await expect(first.locator('#storage-banner')).toBeVisible();
  await first.keyboard.insertText('Morning walk.');
  await connect(first);
  await expect(first.locator('#storage-banner')).toBeHidden();
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

test('offers only configured cloud providers and uses deployment credentials without setup controls', async ({ page, context }) => {
  const mock = new DropboxMock();
  await mock.install(context);
  await openJournal(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Dropbox app key', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('OAuth redirect URI')).toHaveCount(0);
  await expect(page.locator('#cloud-section details, #app-key, #redirect-uri')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Connect your own cloud', exact: true })).toBeVisible();
  await expect(page.locator('#connection-description')).toContainText('encrypted backup and sync across your devices');
  await expect(page.locator('#cloud-providers button')).toHaveCount(1);
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Dropbox', exact: true })).toBeVisible();
  await expect(page.locator('#storage-banner')).toBeVisible();
  const previousCalls = mock.apiCalls;
  mock.accountId = 'another-account';
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different cloud provider');
  await expect(page.locator('.cm-content')).toContainText('Keep this journal');
  expect(mock.apiCalls).toBe(previousCalls);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Saved on this device');
  await expect(page.locator('.cm-content')).toContainText('Keep this journal');
  mock.accountId = 'test-account';
  await connect(page);
});

test('keeps cloud locked after reload unless remembering was requested, and never uploads after a wrong password', async ({ page, context }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await page.keyboard.insertText('Private memory.');
  await connect(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
  await expect(page.getByRole('status')).toHaveText('Cloud storage locked');
  await expect(page.locator('#storage-banner')).toBeHidden();
  expect(mock.revision).toBe(writes);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
  await expect(page.getByRole('status')).toHaveText('Cloud storage locked');
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose from device' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry cloud connection' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#legacy-cloud')).toContainText('unencrypted files remain');
  await page.getByRole('button', { name: 'Import older cloud files' }).click();
  await expect(page.getByRole('alert')).toContainText('Older files imported');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await openDate(page, '2020-01-01');
  await expect(page.locator('[data-date="2020-01-01"] .cm-content')).toContainText('Older private memory.');
  expect(mock.files.get(path)!.bytes).toEqual(original);
  expect([...mock.files.keys()].filter(name => name.startsWith('/minijour-v1/'))).toHaveLength(2);
  expect([...mock.files.keys()].some(name => name.startsWith('/minijour-encrypted-v1/objects/'))).toBe(true);
});

test('finishes a sign-in started by an older app at the root redirect URI', async ({ page, context, baseURL }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await page.goto('./');
  await page.evaluate(({ redirectUri, appKey }) => sessionStorage.setItem('minijour-oauth', JSON.stringify({
    appKey, verifier: 'v'.repeat(64), state: 'old-state', redirectUri,
  })), { redirectUri: baseURL!, appKey: process.env.VITE_DROPBOX_APP_KEY! });
  await page.goto('./?code=old-code&state=old-state');
  await expect(page).toHaveURL(/\/journal\/$/);
  await unlock(page);
  expect(mock.tokenRedirects).toEqual([baseURL]);
});

test('does not remember a key when another tab disconnects during unlock', async ({ page, context }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await connect(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Lock cloud', exact: true }).click();
  const other = await context.newPage(); await openJournal(other);
  await other.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Unlock cloud', exact: true })).toBeEnabled();

  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  let reads = 0;
  await context.route('https://content.dropboxapi.com/2/files/download', async route => {
    const args = JSON.parse(route.request().headers()['dropbox-api-arg']);
    // Pause the final header check after key derivation but before remembering.
    if (route.request().frame().page() === page && args.path.endsWith('/vault.json') && ++reads === 2) {
      reached(); await held;
      await route.fulfill({ body: mock.files.get(args.path)!.bytes, contentType: 'application/octet-stream' });
    } else await route.fallback();
  });
  await page.getByLabel('Cloud password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Remember the key on this device').check();
  await page.getByRole('button', { name: 'Unlock cloud', exact: true }).click();
  await waiting;
  await other.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Connect Dropbox', exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toContainText('Cloud storage was disconnected');
  const key = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('settings').objectStore('settings').get('cloud-vault-key');
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }));
  expect(key).toBeUndefined();
});

test('syncs encrypted cleanup to an offline device without re-uploading its retained photo', async ({ browser }) => {
  const mock = new DropboxMock();
  const phone = await browser.newContext({ serviceWorkers: 'block' });
  const laptop = await browser.newContext({ serviceWorkers: 'block' });
  await mock.install(phone); await mock.install(laptop);
  const first = await phone.newPage(), second = await laptop.newPage();
  await openJournal(first); const name = await addTestPhoto(first); await connect(first);
  await openJournal(second); await connect(second);
  await expect(second.locator('.photo-preview img')).toBeVisible();
  await laptop.setOffline(true);
  await second.locator('.cm-content').click();
  await second.keyboard.press('ControlOrMeta+End');
  await second.keyboard.insertText(`\nAn offline copy: ![Photo](photos/${name})`);
  await replaceEntry(first, 'Removed on the phone.'); await sync(first);
  const before = new Set(mock.files.keys());
  await first.getByRole('button', { name: 'Settings', exact: true }).click();
  await first.getByRole('button', { name: 'Clean up unused photos' }).click();
  await first.getByRole('button', { name: 'Permanently delete photos' }).click();
  await expect(first.getByRole('alert')).toContainText('Permanently removed 1 unused photo');
  const removed = [...before].filter(path => !mock.files.has(path));
  expect(removed).toHaveLength(1);
  expect(await storedPhotos(first)).toEqual([]);
  await first.getByRole('button', { name: 'Close settings' }).click();
  await laptop.setOffline(false); await sync(second); await sync(first);
  expect(await storedPhotos(second)).toEqual([]);
  await expect(second.locator('.photo-preview')).toContainText('unavailable');
  expect(removed.every(path => !mock.files.has(path))).toBe(true);
  await second.reload();
  await expect(second.locator('.photo-preview')).toContainText('unavailable');
  expect(await storedPhotos(second)).toEqual([]);
  await phone.close(); await laptop.close();
});

test('requires unlocked online Dropbox access before cleanup and retries interrupted cloud removal', async ({ page, context }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); const name = await addTestPhoto(page); await connect(page);
  await replaceEntry(page, 'Photo removed from this entry.'); await sync(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  await expect(page.getByRole('alert')).toContainText('Go online');
  await expect(page.locator('#photo-cleanup-review')).toBeHidden();
  expect(await storedPhotos(page)).toEqual([name]);
  await context.setOffline(false);
  await expect(page.getByRole('status')).toHaveText('Saved to Dropbox');
  await page.getByRole('button', { name: 'Lock cloud', exact: true }).click();
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  await expect(page.getByRole('alert')).toContainText('Connect and unlock');
  expect(await storedPhotos(page)).toEqual([name]);
  await unlock(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  mock.deleteFailures = 1;
  mock.deleteAlreadyMissing = true; // Retry sees Dropbox path_lookup/not_found.
  const before = new Set(mock.files.keys());
  await page.getByRole('button', { name: 'Permanently delete photos' }).click();
  await expect(page.getByRole('alert')).toContainText('Cloud cleanup is pending');
  expect(await storedPhotos(page)).toEqual([]);
  await expect(page.getByRole('status')).toHaveText('Saved to Dropbox');
  expect([...before].filter(path => !mock.files.has(path))).toHaveLength(1);
});

test('waits for an in-progress legacy import before allowing cleanup', async ({ page, context }) => {
  const mock = new DropboxMock();
  const path = `/minijour-v1/days/2020-01-01/${crypto.randomUUID()}.automerge`;
  mock.files.set(path, { bytes: Buffer.from(A.save(editDay(createDay('2020-01-01'), 'An older entry.'))), revision: 'old' });
  await mock.install(context);
  await openJournal(page); await connect(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  await context.route('https://content.dropboxapi.com/2/files/download', async route => {
    const args = JSON.parse(route.request().headers()['dropbox-api-arg']);
    if (args.path === path) { reached(); await held; }
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Import older cloud files' }).click();
  await waiting;
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  await expect(page.getByRole('alert')).toContainText('Wait for the current cloud operation');
  await expect(page.locator('#photo-cleanup-review')).toBeHidden();
  release();
  await expect(page.getByRole('alert')).toContainText('Older files imported');
});

test('honors cancellation while the confirmation sync is still in flight', async ({ page, context }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); const name = await addTestPhoto(page); await connect(page);
  await replaceEntry(page, 'Removed photo reference.'); await sync(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  await expect(page.locator('#photo-cleanup-summary')).toContainText('1 unused photo');
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  let pause = true;
  await context.route('https://api.dropboxapi.com/2/files/list_folder', async route => {
    if (pause) { pause = false; reached(); await held; }
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Permanently delete photos' }).click();
  await waiting;
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Clean up unused photos' })).toBeEnabled();
  await expect(page.locator('#photo-cleanup-review')).toBeHidden();
  expect(await storedPhotos(page)).toEqual([name]);
});

test('deletes an entry from the date drawer across devices while retaining photos and merge history', async ({ page, context, browser }) => {
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await connect(page);
  await openDate(page, '2020-02-29');
  const name = await addTestPhoto(page);
  await page.keyboard.insertText('A memory to delete.'); await sync(page);
  const fresh = await browser.newContext({ serviceWorkers: 'block' }); await mock.install(fresh);
  const other = await fresh.newPage(); await openJournal(other); await connect(other);
  await openDate(other, '2020-02-29');
  await expect(other.locator('[data-date="2020-02-29"] .cm-content')).toContainText('A memory to delete.');
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete entry for 2020-02-29' }).click();
  await expect(page.getByRole('button', { name: '2020-02-29', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dates' }).click();
  await sync(page); await sync(other);
  await expect(other.locator('[data-date="2020-02-29"]')).toBeHidden();
  expect(await storedDates(other)).toContain('2020-02-29');
  expect(await storedPhotos(page)).toContain(name);
  expect(await storedPhotos(other)).toContain(name);
  await other.reload();
  await expect(other.locator('[data-date="2020-02-29"]')).toHaveCount(0);
  await sync(other); await sync(page);
  await expect(page.locator('[data-date="2020-02-29"]')).toBeHidden();
  await fresh.close();
});
