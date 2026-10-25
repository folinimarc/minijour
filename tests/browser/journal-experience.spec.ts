import { expect, test, type Page } from '@playwright/test';
import { addTestPhoto, openDate, openJournal, replaceEntry, restoreDays, storedDates } from './helpers';

const TODAY = '2026-10-25';

async function mockStorage(page: Page, mode: 'denied' | 'granted' | 'unsupported' | 'error' = 'denied') {
  await page.addInitScript(mode => {
    const storage = navigator.storage;
    Object.defineProperty(storage, 'persisted', { configurable: true, value: mode === 'unsupported' ? undefined : async () => {
      if (mode === 'error') throw new Error('Persistence check unavailable');
      return mode === 'granted' || localStorage.getItem('test:protected') === 'yes';
    } });
    Object.defineProperty(storage, 'persist', { configurable: true, value: mode === 'unsupported' ? undefined : async () => {
      localStorage.setItem('test:persist-calls', String(Number(localStorage.getItem('test:persist-calls')) + 1));
      if (mode === 'error') throw new Error('Persistence request unavailable');
      if (localStorage.getItem('test:grant-next') === 'yes') { localStorage.setItem('test:protected', 'yes'); return true; }
      return mode === 'granted';
    } });
  }, mode);
}

test('opens at the end of today, keeps the header visible, and preserves deliberate scrolling', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  await openJournal(page);
  await restoreDays(page, {
    '2026-10-24': 'An earlier memory.\n\n'.repeat(60),
    [TODAY]: 'A line from today.\n\n'.repeat(60) + 'Ready to continue here.',
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.reload();
  const today = page.locator(`[data-date="${TODAY}"] .cm-content`);
  await expect(today).toBeFocused();
  const lastLine = today.locator('.cm-line').last();
  await expect(lastLine).toContainText('Ready to continue here.');
  await expect(lastLine).toBeInViewport({ ratio: 0.99 });
  await expect(page.locator('.topbar')).toBeInViewport({ ratio: 0.99 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  expect(await page.evaluate(() => window.getSelection()?.anchorOffset)).toBe('Ready to continue here.'.length);
  await page.screenshot({ path: 'test-results/journal-opening-mobile.png' });
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(lastLine).toBeInViewport({ ratio: 0.99 });
  // Scrolling to an older date ends automatic following, including on sync.
  await page.mouse.wheel(0, -30000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);
  const other = await context.newPage();
  await other.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  await openJournal(other);
  await other.locator(`[data-date="${TODAY}"] .cm-content`).click();
  await other.keyboard.press('ControlOrMeta+End');
  await other.keyboard.insertText(' Another device added this.');
  await expect(today).toContainText('Another device added this.');
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(10);
  await expect(page.locator('.topbar')).toBeInViewport({ ratio: 0.99 });
});

test('shows headings for opened empty dates, preserves undo, and reveals incoming entries', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  await openJournal(page);
  await restoreDays(page, { '2026-10-23': ' \n\t', '2026-10-24': 'An older memory.' });
  await expect(page.locator('.day-heading:visible time')).toHaveText([TODAY, '2026-10-24']);
  await openDate(page, '2026-10-24');
  const older = page.locator('[data-date="2026-10-24"] .cm-content');
  await older.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  await expect(older).toBeFocused();
  await expect(older).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(older).toContainText('An older memory.');
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  await openDate(page, TODAY);
  await expect(older).toBeHidden();
  await expect(page.locator('.day-heading:visible time')).toHaveText([TODAY, '2026-10-24']);
  await expect(page.locator('.day:visible').first()).toHaveCSS('border-top-width', '0px');
  const other = await context.newPage();
  await other.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  await openJournal(other);
  await restoreDays(other, { '2026-10-23': 'An entry from another tab.' });
  await expect(page.locator('[data-date="2026-10-23"] .day-toggle')).toHaveAttribute('aria-expanded', 'false');
  await openDate(page, '2026-10-23');
  await expect(page.locator('[data-date="2026-10-23"] .cm-content')).toContainText('An entry from another tab.');
  await expect(page.locator('.day-heading:visible time')).toHaveText([TODAY, '2026-10-24', '2026-10-23']);
});

test('keeps the opening cursor visible when a photo finishes loading later', async ({ page }) => {
  await openJournal(page);
  await page.keyboard.insertText('An earlier line.\n\n'.repeat(45));
  await addTestPhoto(page);
  await page.keyboard.insertText('\nContinue below this photo.');
  // Hold only journal photo loads until after the opening scroll has happened.
  await page.addInitScript(() => {
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    const pending: (() => void)[] = [];
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...src, set(value: string) {
      if (value.startsWith('blob:')) pending.push(() => src.set!.call(this, value));
      else src.set!.call(this, value);
    } });
    document.addEventListener('test:load-photos', () => { pending.splice(0).forEach(load => load()); });
  });
  await page.reload();
  const lastLine = page.locator('.cm-content .cm-line').last();
  await expect(lastLine).toContainText('Continue below this photo.');
  await expect(lastLine).toBeInViewport({ ratio: 0.99 });
  await expect(page.locator('.photo-preview img')).toHaveCount(1);
  await page.evaluate(() => document.dispatchEvent(new Event('test:load-photos')));
  await expect.poll(() => page.locator('.photo-preview img').evaluate((image: HTMLImageElement) => image.naturalHeight)).toBeGreaterThan(0);
  await expect(lastLine).toBeInViewport({ ratio: 0.99 });
});

test('advances the writing draft at midnight without saving empty dates', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-24T21:59:59Z') });
  await openJournal(page);
  await replaceEntry(page, ' \n\t');
  await page.clock.runFor(2100);
  await expect(page.locator('.day:visible .day-heading time')).toHaveText([TODAY]);
  await expect(page.locator(`[data-date="${TODAY}"] .cm-content`)).toBeFocused();
  await expect(page.locator('.day-heading:visible time')).toHaveText([TODAY]);
  expect(await storedDates(page)).toEqual([]);
  await page.reload();
  await expect(page.locator('.day:visible .day-heading time')).toHaveText([TODAY]);
});

test('opens concise cloud settings from the storage warning and requests persistence once', async ({ page }) => {
  await mockStorage(page);
  await openJournal(page); await page.keyboard.insertText('My journal still saves.');
  await expect(page.getByRole('status')).toHaveText('Cloud storage not configured');
  await expect(page.locator('#cloud-warning')).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
  await page.getByRole('button', { name: 'Cloud storage and sync settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#connection-description')).toContainText('Clearing browser data can remove it');
  await expect(page.getByRole('heading', { name: 'Device storage', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('My journal still saves.');
  await page.keyboard.insertText(' More writing.');
  await expect(page.getByRole('status')).toHaveText('Cloud storage not configured');
  expect(await page.evaluate(() => localStorage.getItem('test:persist-calls'))).toBe('1');
});

for (const mode of ['granted', 'unsupported', 'error'] as const) {
  test(`keeps ordinary saves working when persistence is ${mode}`, async ({ page }) => {
    await mockStorage(page, mode);
    await openJournal(page); await page.keyboard.insertText('A saved memory.');
    await expect(page.getByRole('status')).toHaveText('Cloud storage not configured');
    await expect(page.getByRole('alert')).toBeHidden();
    await page.reload();
    await expect(page.locator('.cm-content')).toContainText('A saved memory.');

  });
}

test('does not replace a save failure with storage-persistence advice', async ({ page }) => {
  await mockStorage(page);
  await openJournal(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'days') throw new DOMException('Device storage is full.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.keyboard.insertText('Keep this pending memory.');
  await expect(page.getByRole('alert')).toContainText('Device storage is full.');
  await expect(page.getByRole('status')).toHaveText('Could not save on this device');
  expect(await page.evaluate(() => localStorage.getItem('test:persist-calls'))).toBeNull();

});

test('does not repeat automatic permission requests when another notice occupied the first message', async ({ page }) => {
  await mockStorage(page);
  await openJournal(page);
  await page.evaluate(() => {
    document.getElementById('notice-text')!.textContent = 'An existing message.';
    document.getElementById('notice')!.hidden = false;
  });
  await page.keyboard.insertText('First saved memory.');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('test:persist-calls'))).toBe('1');
  await expect(page.getByRole('alert')).toHaveText('An existing message.');
  await page.reload();
  await page.keyboard.insertText(' More writing.');
  await expect(page.getByRole('status')).toHaveText('Cloud storage not configured');
  expect(await page.evaluate(() => localStorage.getItem('test:persist-calls'))).toBe('1');
});
