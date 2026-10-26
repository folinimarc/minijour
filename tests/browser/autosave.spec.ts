import { expect, test, type Page } from '@playwright/test';
import { loadDay } from '../../src/domain/day';
import { connect, openJournal } from './helpers';
import { DropboxMock } from './dropbox-mock';

async function watchWrites(page: Page) {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'days') document.documentElement.dataset.dayWrites = String(Number(document.documentElement.dataset.dayWrites || 0) + 1);
      return put.apply(this, args);
    };
  });
  await page.clock.install();
}
async function pause(page: Page) {
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)));
}
async function writes(page: Page) {
  return Number(await page.locator('html').getAttribute('data-day-writes'));
}
async function storedText(page: Page) {
  const bytes = await page.evaluate(() => new Promise<number[] | undefined>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('days').objectStore('days').getAll();
      request.onsuccess = () => { db.close(); resolve(request.result[0] && Array.from(request.result[0])); };
      request.onerror = () => reject(request.error);
    };
  }));
  return bytes ? loadDay(new Uint8Array(bytes)).text : '';
}

test('batches repeated editing into one durable save after a pause', async ({ page }) => {
  await watchWrites(page); await openJournal(page); await pause(page);
  await page.keyboard.insertText('A memory to edit.');
  await page.keyboard.press('Backspace');
  await page.clock.runFor(1000);
  await page.keyboard.press('Backspace');
  await page.clock.runFor(1499);
  expect(await writes(page)).toBe(0);
  await expect(page.getByRole('status')).toHaveText('Changes waiting to save…');
  await page.clock.runFor(1);
  await expect.poll(() => writes(page)).toBe(1);
  await expect(page.getByRole('status')).toHaveText('Saved on this device only');
  expect(await storedText(page)).toBe('A memory to edi');
  await page.clock.runFor(30_000);
  expect(await writes(page)).toBe(1);
  await page.reload();
  await expect(page.locator('.cm-content')).toHaveText('A memory to edi');
});

test('keeps continuous typing in memory until the same pause required by the idle timer', async ({ page }) => {
  await watchWrites(page); await openJournal(page); await pause(page);
  for (let index = 0; index < 35; index++) {
    await page.keyboard.insertText('x');
    await page.clock.runFor(1000);
  }
  expect(await writes(page)).toBe(0);
  expect(await storedText(page)).toBe('');
  await page.clock.runFor(1500);
  await expect.poll(() => storedText(page)).toBe('x'.repeat(35));
  expect(await writes(page)).toBe(1);
});

test('retries a failed local save without more typing or a cloud connection', async ({ page }) => {
  await watchWrites(page); await openJournal(page); await pause(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'days' && !failed) {
        failed = true;
        throw new DOMException('Device storage is temporarily unavailable.', 'UnknownError');
      }
      return put.apply(this, args);
    };
  });
  await page.keyboard.insertText('Keep this memory.');
  await page.clock.runFor(1500);
  await expect(page.getByRole('status')).toHaveText('Could not save on this device');
  expect(await writes(page)).toBe(0);
  await page.clock.runFor(9999);
  expect(await writes(page)).toBe(0);
  await page.clock.runFor(1);
  await expect.poll(() => storedText(page)).toBe('Keep this memory.');
  await expect(page.getByRole('status')).toHaveText('Saved on this device only');
  await page.clock.runFor(60_000);
  expect(await writes(page)).toBe(1);
});

test('requires a pause for later saves and sync rounds while an earlier cloud request is in flight', async ({ page, context }) => {
  test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'Requires a configured provider.');
  const mock = new DropboxMock(); await mock.install(context);
  await watchWrites(page); await openJournal(page); await connect(page); await pause(page);
  let release!: () => void;
  let lists = 0;
  await context.route('https://api.dropboxapi.com/2/files/list_folder', async route => {
    lists++;
    if (lists === 1) await new Promise<void>(resolve => { release = resolve; });
    await route.fallback();
  });
  await page.keyboard.insertText('First.');
  const before = mock.apiCalls;
  await page.clock.runFor(1499);
  expect(mock.apiCalls).toBe(before);
  expect(await writes(page)).toBe(0);
  await page.clock.runFor(1);
  await expect.poll(() => lists).toBe(1);
  await page.keyboard.insertText(' More.');
  await page.clock.runFor(1500);
  await expect.poll(() => storedText(page)).toBe('First. More.');
  expect(lists).toBe(1);
  for (let index = 0; index < 35; index++) {
    await page.keyboard.insertText('x'); await page.clock.runFor(1000);
  }
  expect(await writes(page)).toBe(2);
  expect(await storedText(page)).toBe('First. More.');
  expect(lists).toBe(1);
  release();
  await expect(page.locator('#sync-button')).toHaveText('Sync now');
  expect(lists).toBe(1);
  await page.clock.runFor(1500);
  await expect.poll(() => lists).toBeGreaterThan(1);
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
});

test('defers periodic cloud polling while typing even in a whitespace-only draft', async ({ page, context }) => {
  test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'Requires a configured provider.');
  const mock = new DropboxMock(); await mock.install(context);
  await watchWrites(page); await openJournal(page); await connect(page); await pause(page);
  const before = mock.apiCalls;
  for (let index = 0; index < 35; index++) {
    await page.keyboard.insertText(' '); await page.clock.runFor(1000);
  }
  expect(mock.apiCalls).toBe(before);
  expect(await writes(page)).toBe(0);
  await page.clock.runFor(1500);
  await expect.poll(() => mock.apiCalls).toBeGreaterThan(before);
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
  expect(await writes(page)).toBe(0);
});

test('does not start cloud sync if typing resumes while a local batch is being committed', async ({ page, context }) => {
  test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'Requires a configured provider.');
  const mock = new DropboxMock(); await mock.install(context);
  await watchWrites(page); await openJournal(page); await connect(page); await pause(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let resumed = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      const request = put.apply(this, args);
      if (this.name === 'days' && !resumed) {
        resumed = true;
        // Resume editing after the snapshot was written, before its transaction
        // completes. A real browser edit fires input and CodeMirror updates.
        queueMicrotask(() => document.execCommand('insertText', false, ' More.'));
      }
      return request;
    };
  });
  const before = mock.apiCalls;
  await page.keyboard.insertText('First.');
  await page.clock.runFor(1500);
  await expect(page.locator('.cm-content')).toHaveText('First. More.');
  await expect.poll(() => storedText(page)).toBe('First.');
  await expect(page.getByRole('status')).toHaveText('Changes waiting to save…');
  expect(mock.apiCalls).toBe(before);
  await page.clock.runFor(1499);
  expect(await writes(page)).toBe(1);
  expect(mock.apiCalls).toBe(before);
  await page.clock.runFor(1);
  await expect.poll(() => storedText(page)).toBe('First. More.');
  await expect.poll(() => mock.apiCalls).toBeGreaterThan(before);
  await expect(page.getByRole('status')).toContainText('Saved to Dropbox');
});
