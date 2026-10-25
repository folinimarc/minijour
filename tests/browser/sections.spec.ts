import { expect, test } from '@playwright/test';
import { openDate, openJournal, restoreDays, storedDates } from './helpers';

const TODAY = '2026-10-25';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
});

test('opens only the three newest sections and expands an older entry from the date drawer', async ({ page, context }) => {
  await openJournal(page);
  const dates = Array.from({ length: 25 }, (_, index) => `2026-10-${String(25 - index).padStart(2, '0')}`);
  await restoreDays(page, Object.fromEntries(dates.map(date => [date, `Memory for ${date}.`])));
  await page.reload();
  await expect(page.locator('.day-heading time')).toHaveText(dates);
  await expect(page.locator('.day-toggle[aria-expanded=true]')).toHaveCount(3);
  await expect(page.locator('.cm-content')).toHaveCount(3);
  const old = page.locator('[data-date="2026-10-01"]');
  await expect(old.locator('.day-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(old.locator('.cm-content')).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse dates' }).click();
  await expect(page.locator('.date-link')).toHaveText(dates);
  await expect(page.locator('.date-link[aria-current]')).toHaveText(TODAY);
  await page.screenshot({ path: 'test-results/dates-sidebar-mobile.png' });
  await page.getByRole('button', { name: '2026-10-01', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Dates', exact: true })).toBeHidden();
  await expect(old.locator('.day-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(old.locator('.cm-content')).toBeFocused();
  await expect(old.locator('.cm-content')).toBeInViewport();
  await page.keyboard.insertText(' Added now.');
  await old.locator('.day-toggle').click();
  await expect(old.locator('.day-content')).toBeHidden();
  // An incoming edit must update, but not reopen, a manually collapsed day.
  const other = await context.newPage();
  await openJournal(other); await openDate(other, '2026-10-01');
  await other.keyboard.insertText(' Another tab.');
  await expect(old.locator('.cm-content')).toContainText('Another tab.');
  await expect(old.locator('.day-toggle')).toHaveAttribute('aria-expanded', 'false');
  await old.locator('.day-toggle').focus(); await page.keyboard.press('Enter');
  await expect(old.locator('.cm-content')).toBeFocused();
  await expect(old.locator('.cm-content')).toContainText('Added now.');
  await page.getByRole('button', { name: 'Browse dates' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Browse dates' })).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.day-toggle[aria-expanded=true]')).toHaveCount(3);
  await expect(page.locator('.cm-content')).toHaveCount(3);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/journal-sections-desktop.png' });
});

test('removes an abandoned blank date without saving it and leaves today ready to write', async ({ page }) => {
  await openJournal(page);
  await openDate(page, '2030-01-02');
  await expect(page.locator('[data-date="2030-01-02"] .day-heading time')).toBeVisible();
  await page.getByRole('button', { name: 'Browse dates' }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete entry for 2030-01-02' }).click();
  await expect(page.locator('.date-link')).toHaveText(['2030-01-02', TODAY]);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete entry for 2030-01-02' }).click();
  await expect(page.locator('.date-link')).toHaveText([TODAY]);
  expect(await storedDates(page)).toEqual([]);
  await page.getByRole('button', { name: 'Close dates' }).click();
  await expect(page.locator('[data-date="2030-01-02"]')).toBeHidden();
  await expect(page.locator('.day-heading:visible time')).toHaveText([TODAY]);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/journal-small-mobile.png' });
});
