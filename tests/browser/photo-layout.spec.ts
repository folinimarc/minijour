import { expect, test, type Page } from '@playwright/test';
import { openJournal, replaceEntry, restoreDays } from './helpers';

async function addPortrait(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 3000;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 1200, 3000);
    gradient.addColorStop(0, '#b5c5ac'); gradient.addColorStop(1, '#a8795d');
    context.fillStyle = gradient; context.fillRect(0, 0, 1200, 3000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await page.locator('#photo-input').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.photo-preview img')).toBeVisible();
  return (await page.locator('.cm-content').innerText()).match(/photos\/([a-f0-9-]{36}\.jpg)/)![1];
}
async function layoutSettled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('resizes an oversized photo and stores JPEG instead of the original', async ({ page }) => {
  await openJournal(page); const name = await addPortrait(page);
  const photo = await page.evaluate(name => new Promise<Blob>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('photos').objectStore('photos').get(name);
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }).then(async blob => {
    const bitmap = await createImageBitmap(blob);
    const result = { type: blob.type, width: bitmap.width, height: bitmap.height };
    bitmap.close(); return result;
  }), name);
  expect(photo).toEqual({ type: 'image/jpeg', width: 960, height: 2400 });
});

test('keeps page height stable when scrolling a tall photo out of the editor viewport and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await openJournal(page); const name = await addPortrait(page);
  await replaceEntry(page, 'Before the photo.\n'.repeat(25) + `![Photo](photos/${name})\n` + 'After the photo.\n'.repeat(150));
  await expect(page.getByRole('status')).toHaveText('Saved on this device only');
  await page.mouse.wheel(0, -30_000);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(10);
  await expect(page.locator('.photo-preview img')).toHaveCount(1);
  await expect.poll(() => page.locator('.photo-preview img').evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(2400);
  await layoutSettled(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.mouse.wheel(0, 30_000);
  await expect.poll(() => page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2)).toBe(true);
  await layoutSettled(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
  await page.mouse.wheel(0, -30_000);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(10);
  await layoutSettled(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
});

test('reserves photo dimensions so delayed image loading does not move the reader', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await openJournal(page); const name = await addPortrait(page);
  await replaceEntry(page, 'Before.\n'.repeat(20) + `![Photo](photos/${name})\n` + 'Continue below the photo.\n'.repeat(8));
  await expect(page.getByRole('status')).toHaveText('Saved on this device only');
  await page.addInitScript(() => {
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    const pending: (() => void)[] = [];
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...src, set(value: string) {
      if (value.startsWith('blob:')) pending.push(() => src.set!.call(this, value));
      else src.set!.call(this, value);
    } });
    document.addEventListener('test:load-photos', () => pending.splice(0).forEach(load => load()));
  });
  await page.reload();
  const photo = page.locator('.photo-preview img');
  await expect(photo).toHaveCount(1);
  await page.mouse.wheel(0, -100);
  await layoutSettled(page);
  const before = await photo.boundingBox();
  expect(before!.height).toBeGreaterThan(400);
  const scroll = await page.evaluate(() => scrollY);
  await page.evaluate(() => document.dispatchEvent(new Event('test:load-photos')));
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(2400);
  await layoutSettled(page);
  expect((await photo.boundingBox())!.height).toBeCloseTo(before!.height, 0);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
});

test('keeps the spacing around a date divider identical when expanded or collapsed', async ({ page }) => {
  await openJournal(page); await restoreDays(page, { '2020-02-29': 'An older memory.' });
  const section = page.locator('[data-date="2020-02-29"]');
  const spacing = () => section.evaluate(element => {
    const style = getComputedStyle(element);
    return { before: style.marginTop, after: style.paddingTop };
  });
  const collapsed = await spacing();
  await section.locator('.day-toggle').click();
  expect(await spacing()).toEqual(collapsed);
  await section.locator('.day-toggle').click();
  expect(await spacing()).toEqual(collapsed);
});
