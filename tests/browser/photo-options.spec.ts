import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { connect, openJournal } from './helpers';
import { DropboxMock } from './dropbox-mock';

async function samplePhoto(page: Page, width = 800, height = 600) {
  const base64 = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#a8b69d'; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height });
  return { name: 'original.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}
async function keepOriginals(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Optimize new photos', { exact: true }).uncheck();
  await expect(page.locator('#photo-options-help')).toContainText('Keep original files unchanged');
  await expect(page.getByLabel('Longest side (pixels)', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close settings' }).click();
}
async function insertPhoto(page: Page, photo: { name: string; mimeType: string; buffer: Buffer }) {
  const photoNames = async () => [...(await page.locator('.cm-content').innerText()).matchAll(/photos\/([a-f0-9-]{36}\.[a-z]+)/g)].map(match => match[1]);
  const previous = new Set(await photoNames());
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await page.locator('#photo-input').setInputFiles(photo);
  await expect.poll(async () => (await photoNames()).filter(name => !previous.has(name)).length).toBe(1);
  return (await photoNames()).find(name => !previous.has(name))!;
}
async function storedPhoto(page: Page, name: string) {
  return page.evaluate(name => new Promise<Blob>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('photos').objectStore('photos').get(name);
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }).then(async blob => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
    let width: number | undefined, height: number | undefined;
    try { const bitmap = await createImageBitmap(blob); width = bitmap.width; height = bitmap.height; bitmap.close(); } catch { /* Original may not preview here. */ }
    return { hash, type: blob.type, width, height };
  }), name);
}

test('saves a configurable resize limit, preserves originals when unchecked, and leaves existing photos alone', async ({ page }, testInfo) => {
  await openJournal(page);
  const original = await samplePhoto(page, 1600, 1200);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Photos', exact: true })).toBeVisible();
  await expect(page.getByLabel('Optimize new photos', { exact: true })).toBeChecked();
  const limit = page.getByLabel('Longest side (pixels)', { exact: true });
  await expect(limit).toHaveValue('2400');
  await limit.fill('640'); await limit.press('Tab');
  await expect(limit).toBeEnabled();
  await page.getByRole('heading', { name: 'Photos', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('photo-settings-mobile.png') });
  await page.getByRole('button', { name: 'Close settings' }).click();
  const optimized = await insertPhoto(page, original);
  expect(optimized).toMatch(/\.jpg$/);
  expect(await storedPhoto(page, optimized)).toMatchObject({ type: 'image/jpeg', width: 640, height: 480 });
  await keepOriginals(page);
  const retained = await insertPhoto(page, original);
  expect(retained).toMatch(/\.png$/);
  expect(await storedPhoto(page, retained)).toEqual({ type: 'image/png', width: 1600, height: 1200, hash: createHash('sha256').update(original.buffer).digest('hex') });
  expect(await storedPhoto(page, optimized)).toMatchObject({ width: 640, height: 480 });
  await expect(page.getByRole('status')).toHaveText('Saved on this device only');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Optimize new photos', { exact: true })).not.toBeChecked();
  await expect(limit).toHaveValue('640'); await expect(limit).toBeDisabled();
});

test('does not store invalid resize settings and rolls back a failed settings write', async ({ page }) => {
  await openJournal(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const limit = page.getByLabel('Longest side (pixels)', { exact: true });
  await limit.fill('0'); await limit.press('Tab');
  expect(await limit.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(limit).toHaveValue('2400');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'settings' && args[1] === 'photo-options') throw new DOMException('Could not save photo settings.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByLabel('Optimize new photos', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save photo settings');
  await expect(page.getByLabel('Optimize new photos', { exact: true })).toBeChecked();
  await expect(limit).toBeEnabled();
});

test('keeps an unsupported original downloadable without decoding or rewriting it', async ({ page }, testInfo) => {
  await openJournal(page);
  const original = { name: 'original.heic', mimeType: 'image/heic', buffer: Buffer.from('Synthetic original HEIC bytes that this browser cannot decode.') };
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await page.locator('#photo-input').setInputFiles(original);
  await expect(page.getByRole('alert')).toContainText('Turn off Optimize new photos to keep the original file');
  await expect(page.locator('.cm-content')).not.toContainText('photos/');
  await keepOriginals(page);
  const name = await insertPhoto(page, original);
  expect(name).toMatch(/\.heic$/);
  await expect(page.locator('.photo-preview')).toContainText('Preview unavailable on this device');
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download photo', exact: true }).click();
  const file = testInfo.outputPath('original.heic');
  await (await downloading).saveAs(file);
  expect(await readFile(file)).toEqual(original.buffer);
});

test('uses the latest photo preferences across tabs', async ({ page, context }) => {
  await openJournal(page);
  const other = await context.newPage(); await openJournal(other);
  await keepOriginals(other);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Optimize new photos', { exact: true })).not.toBeChecked();
  await page.getByLabel('Optimize new photos', { exact: true }).check();
  await expect(page.getByLabel('Longest side (pixels)', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close settings' }).click();
  const name = await insertPhoto(other, await samplePhoto(other));
  expect(name).toMatch(/\.jpg$/);
  await other.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(other.getByLabel('Optimize new photos', { exact: true })).toBeChecked();
});

test('preserves an original PNG through encrypted cloud sync and a downloaded backup restore', async ({ page, context, browser }, testInfo) => {
  test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'Requires a configured provider.');
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await keepOriginals(page);
  const original = await samplePhoto(page);
  const name = await insertPhoto(page, original);
  await connect(page);
  const fresh = await browser.newContext({ serviceWorkers: 'block' }); await mock.install(fresh);
  const other = await fresh.newPage(); await openJournal(other); await connect(other);
  await expect(other.locator('.photo-preview img')).toBeVisible();
  expect(await storedPhoto(other, name)).toEqual({ type: 'image/png', width: 800, height: 600, hash: createHash('sha256').update(original.buffer).digest('hex') });
  await other.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(other.getByLabel('Optimize new photos', { exact: true })).toBeChecked();
  const downloading = other.waitForEvent('download');
  await other.getByRole('button', { name: 'Download backup', exact: true }).click();
  const zip = testInfo.outputPath('original-backup.zip'); await (await downloading).saveAs(zip);
  const files = unzipSync(new Uint8Array(await readFile(zip)));
  expect(Buffer.from(files[`photos/${name}`])).toEqual(original.buffer);
  const restoredContext = await browser.newContext(); const restored = await restoredContext.newPage();
  await openJournal(restored);
  await restored.getByRole('button', { name: 'Settings', exact: true }).click();
  await restored.locator('#restore-input').setInputFiles(zip);
  await expect(restored.getByRole('alert')).toContainText('Backup restored');
  expect(await storedPhoto(restored, name)).toEqual(await storedPhoto(other, name));
  await restored.getByRole('button', { name: 'Close settings' }).click();
  await expect(restored.locator('.photo-preview img')).toBeVisible();
  await fresh.close(); await restoredContext.close();
});
