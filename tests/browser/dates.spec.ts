import { expect, test } from '@playwright/test';
import { openDate, openJournal, storedDates } from './helpers';

const TODAY = '2026-10-25';

test('ignores blank drafts and writes past and future entries in chronological order', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  await openJournal(page);
  await expect(page.locator('.day-heading:visible')).toHaveCount(0);
  await expect(page.locator('.cm-placeholder')).toHaveText(`Write for ${TODAY}…`);
  expect(await storedDates(page)).toEqual([]);
  await page.keyboard.insertText(' \n\t');
  expect(await storedDates(page)).toEqual([]);
  await openDate(page, '2026-10-20');
  await openDate(page, '2030-01-02');
  expect(await storedDates(page)).toEqual([]);
  await page.reload();
  await expect(page.locator('.day')).toHaveCount(1);
  await expect(page.locator('.day-heading:visible')).toHaveCount(0);
  await openDate(page, '2030-01-02'); await page.keyboard.insertText('A future plan.');
  await expect.poll(() => storedDates(page)).toEqual(['2030-01-02']);
  await openDate(page, '2026-10-20'); await page.keyboard.insertText('A past memory.');
  await openDate(page, TODAY); await page.keyboard.insertText('Today’s memory.');
  await expect(page.locator('.day-heading:visible time')).toHaveText(['2026-10-20', TODAY, '2030-01-02']);
  await page.reload();
  await expect(page.locator(`[data-date="${TODAY}"] .cm-content`)).toBeFocused();
  await openDate(page, '2030-01-02');
  await expect(page.locator('[data-date="2030-01-02"]')).toHaveCount(1);
  await page.keyboard.insertText(' More to add.');
  await expect(page.locator('[data-date="2030-01-02"] .cm-content')).toContainText('A future plan. More to add.');
  expect(await storedDates(page)).toEqual(['2026-10-20', TODAY, '2030-01-02']);
});

test('allows a photo-only entry on an arbitrary date and keeps the date control tucked away', async ({ page }) => {
  await openJournal(page);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await expect(page.getByLabel('Entry date', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await openDate(page, '2020-02-29');
  await page.getByRole('button', { name: 'Add a photo', exact: true }).click();
  await page.locator('#photo-input').setInputFiles('public/icon-192.png');
  await expect(page.locator('[data-date="2020-02-29"] .photo-preview img')).toBeVisible();
  await expect(page.locator('.day-heading:visible time')).toHaveText(['2020-02-29']);
  await expect.poll(() => storedDates(page)).toEqual(['2020-02-29']);
  await page.reload();
  await expect(page.locator('[data-date="2020-02-29"] .photo-preview img')).toBeVisible();
  await expect(page.locator('.day-heading:visible time')).toHaveText(['2020-02-29']);
});

test('rejects a missing date without creating or saving a section', async ({ page }) => {
  await openJournal(page);
  await page.getByRole('button', { name: 'Settings and backup' }).click();
  await page.getByText('Write on another date', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open date', exact: true })).toBeInViewport({ ratio: 0.99 });
  await page.screenshot({ path: 'test-results/date-settings-mobile.png' });
  await page.getByLabel('Entry date', { exact: true }).evaluate((input: HTMLInputElement) => {
    input.value = '';
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('alert')).toContainText('Choose a valid calendar date');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await storedDates(page)).toEqual([]);
  await expect(page.locator('.day')).toHaveCount(1);
});
