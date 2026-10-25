import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { openJournal, addTestPhoto, replaceEntry, storedPhotos } from './helpers';

test('opens ready to write, saves Markdown, and restores it without another heading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openJournal(page);
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.insertText('A quiet morning. 🦊\n\n**Something to remember.**');
  await expect(page.getByRole('status')).toContainText('Cloud storage not configured');
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
  await expect(page.getByRole('status')).toContainText('Cloud storage not configured');
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

test('does not replace a newer edit with an older queued composition update', async ({ page, context }) => {
  await page.clock.install();
  await openJournal(page);
  const other = await context.newPage();
  await openJournal(other);
  const content = page.locator('.cm-content');
  await content.dispatchEvent('compositionstart');
  await page.keyboard.insertText('Composed memory.');
  await expect(other.locator('.cm-content')).toContainText('Composed memory.');
  // Hold the queued composition-end callback while a newer edit arrives.
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await content.dispatchEvent('compositionend');
  await other.locator('.cm-content').click();
  await other.keyboard.press('End');
  await other.keyboard.insertText(' Remote memory.');
  await expect(content).toContainText('Remote memory.');
  await page.clock.runFor(1);
  await expect(content).toContainText('Remote memory.');
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

test('reviews unused photos, supports cancel, excludes unused images from ZIPs, and cleans up offline', async ({ page, context }, testInfo) => {
  await openJournal(page); const name = await addTestPhoto(page);
  await replaceEntry(page, 'A memory without the photo.');
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const path = testInfo.outputPath('without-unused-photos.zip');
  await (await downloading).saveAs(path);
  const entries = unzipSync(new Uint8Array(await readFile(path)));
  expect(Object.keys(entries).filter(entry => entry.startsWith('photos/'))).toEqual([]);
  expect(await storedPhotos(page)).toEqual([name]);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  await expect(page.locator('#photo-cleanup-summary')).toContainText('1 unused photo');
  await expect(page.locator('#photo-cleanup-summary')).toContainText('KB');
  await expect(page.locator('#photo-cleanup-review')).toContainText('Undo, old backups, or offline edits');
  await expect(page.getByRole('button', { name: 'Permanently delete photos' })).toBeInViewport({ ratio: 0.99 });
  await page.screenshot({ path: 'test-results/photo-cleanup-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#photo-cleanup-review')).toBeHidden();
  expect(await storedPhotos(page)).toEqual([name]);
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  await page.getByRole('button', { name: 'Permanently delete photos' }).click();
  await expect(page.getByRole('alert')).toContainText('Permanently removed 1 unused photo');
  expect(await storedPhotos(page)).toEqual([]);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.locator('.photo-preview')).toContainText('unavailable');
  await expect(page.locator('.photo-preview img')).toHaveCount(0);
});

test('keeps a reviewed photo when another tab adds a reference before confirmation', async ({ page, context }) => {
  await openJournal(page); const name = await addTestPhoto(page);
  await replaceEntry(page, 'Removed the image.');
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByRole('button', { name: 'Clean up unused photos' }).click();
  await expect(page.locator('#photo-cleanup-summary')).toContainText('1 unused photo');
  const other = await context.newPage(); await openJournal(other);
  await replaceEntry(other, `Keep this reference: ![Photo](photos/${name})`);
  await expect(other.getByRole('status')).toHaveText('Cloud storage not configured');
  await page.getByRole('button', { name: 'Permanently delete photos' }).click();
  await expect(page.getByRole('alert')).toContainText('No photos removed');
  expect(await storedPhotos(page)).toEqual([name]);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('.photo-preview img')).toBeVisible();
});

test('shows local journaling without provider choices or setup controls when none are configured', async ({ page, context }) => {
  test.skip(!!process.env.VITE_DROPBOX_APP_KEY, 'This check covers a local-only deployment.');
  const cloudRequests: string[] = [];
  await context.route(/https:\/\/(api|content)\.dropboxapi\.com\//, route => {
    cloudRequests.push(route.request().url()); return route.abort();
  });
  await openJournal(page);
  await page.keyboard.insertText('My local journal.');
  await expect(page.getByRole('status')).toHaveText('Cloud storage not configured');
  // Browser-entered keys and older tokens must not silently enable a provider.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put('oldmanualkey', 'dropbox-app-key');
      tx.objectStore('settings').put({ appKey: 'oldmanualkey', accountId: 'old-account',
        accessToken: 'test-token', refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000 }, 'dropbox-connection');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('My local journal.');
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await expect(page.getByRole('heading', { name: 'Cloud sync', exact: true })).toBeVisible();
  await expect(page.locator('#cloud-providers button')).toHaveCount(0);
  await expect(page.locator('#connection-description')).toContainText('Cloud sync is unavailable on this website');
  await expect(page.locator('#app-key, #redirect-uri, #cloud-section details')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download backup' })).toBeEnabled();
  expect(cloudRequests).toEqual([]);
});
