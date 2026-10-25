import { expect, type Page } from '@playwright/test';

export async function openJournal(page: Page) {
  await page.goto('./journal/');
  await expect(page.locator('.cm-content').last()).toBeVisible();
}

export async function openDate(page: Page, date: string) {
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByText('Write on another date', { exact: true }).click();
  await page.getByLabel('Entry date', { exact: true }).fill(date);
  await page.getByRole('button', { name: 'Open date', exact: true }).click();
  await expect(page.locator(`[data-date="${date}"] .cm-content`)).toBeFocused();
}

export async function storedDates(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('days').objectStore('days').getAllKeys();
      request.onsuccess = () => { db.close(); resolve(request.result as string[]); };
      request.onerror = () => reject(request.error);
    };
  }));
}

export async function addTestPhoto(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await page.locator('#photo-input').setInputFiles('public/icon-192.png');
  await expect(page.locator('.photo-preview img')).toBeVisible();
  return (await page.locator('.cm-content').innerText()).match(/photos\/([a-f0-9-]{36}\.jpg)/)![1];
}
export async function replaceEntry(page: Page, text = '') {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  if (text) await page.keyboard.insertText(text);
  else await page.keyboard.press('Backspace');
}
export async function storedPhotos(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('photos').objectStore('photos').getAllKeys();
      request.onsuccess = () => { db.close(); resolve(request.result as string[]); };
      request.onerror = () => reject(request.error);
    };
  }));
}

export async function connect(page: Page) {
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await unlock(page);
}

export const PASSWORD = 'three random words for testing';
export async function unlock(page: Page, remember = true) {
  await page.getByLabel('Cloud password', { exact: true }).fill(PASSWORD);
  const confirmation = page.getByLabel('Repeat cloud password');
  if (await confirmation.isVisible()) await confirmation.fill(PASSWORD);
  await page.getByLabel('Remember the key on this device').setChecked(remember);
  await page.locator('#unlock-button').click();
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
  await page.getByRole('button', { name: 'Close settings' }).click();
}

export async function sync(page: Page) {
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
  await page.getByRole('button', { name: 'Close settings' }).click();
}
