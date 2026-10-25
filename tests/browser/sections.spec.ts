import { expect, test } from '@playwright/test';
import { openDate, openJournal, restoreDays, storedDates } from './helpers';

const TODAY = '2026-10-25';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
});

test('opens only today and collapses other entries when navigating through the date drawer', async ({ page, context }) => {
  await openJournal(page);
  const dates = Array.from({ length: 25 }, (_, index) => `2026-10-${String(25 - index).padStart(2, '0')}`);
  await restoreDays(page, Object.fromEntries(dates.map(date => [date, `Memory for ${date}.`])));
  await page.reload();
  await expect(page.locator('.day-heading time')).toHaveText(dates);
  await expect(page.locator('.day-toggle[aria-expanded=true]')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toHaveCount(1);
  const old = page.locator('[data-date="2026-10-01"]');
  await expect(old.locator('.day-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(old.locator('.cm-content')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await expect(page.locator('.date-link')).toHaveText([`Today (${TODAY})`, ...dates.slice(1)]);
  await expect(page.locator('.date-link[aria-current]')).toHaveText(`Today (${TODAY})`);
  await page.screenshot({ path: 'test-results/dates-sidebar-mobile.png' });
  await page.locator('#date-sidebar nav').evaluate(nav => { nav.scrollTop = nav.scrollHeight; });
  await expect(page.getByRole('button', { name: `Today (${TODAY})`, exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '2026-10-01', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Dates', exact: true })).toBeHidden();
  await expect(old.locator('.day-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(old.locator('.cm-content')).toBeFocused();
  await expect(page.locator('.day-toggle[aria-expanded=true]')).toHaveCount(1);
  await expect(page.locator(`[data-date="${TODAY}"] .day-content`)).toBeHidden();
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
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Dates', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.day-toggle[aria-expanded=true]')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/journal-sections-desktop.png' });
});

test('removes an abandoned blank date without saving it and leaves today ready to write', async ({ page }) => {
  await openJournal(page);
  await openDate(page, '2030-01-02');
  await expect(page.locator('[data-date="2030-01-02"] .day-heading time')).toBeVisible();
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  page.once('dialog', async dialog => {
    expect(dialog.message()).toBe('Delete the entry for 2030-01-02? Its text will be removed from your journal. Photo files stay until you clean them up through the settings.');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Delete entry for 2030-01-02' }).click();
  await expect(page.locator('.date-link')).toHaveText([`Today (${TODAY})`, '2030-01-02']);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete entry for 2030-01-02' }).click();
  await expect(page.locator('.date-link')).toHaveText([`Today (${TODAY})`]);
  expect(await storedDates(page)).toEqual([]);
  await page.getByRole('button', { name: 'Close dates' }).click();
  await expect(page.locator('[data-date="2030-01-02"]')).toBeHidden();
  await expect(page.locator('.day-heading:visible time')).toHaveText([TODAY]);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/journal-small-mobile.png' });
});

test('keeps Today pinned when another date is selected and the local date changes', async ({ page }) => {
  await openJournal(page);
  await openDate(page, '2020-02-29');
  await page.keyboard.insertText('An earlier memory.');
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await expect(page.locator('.date-link').first()).toHaveText(`Today (${TODAY})`);
  await page.clock.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.date-link').first()).toHaveText('Today (2026-10-26)');
  await expect(page.locator('.date-link[aria-current]')).toHaveText('2020-02-29');
  await page.getByRole('button', { name: 'Today (2026-10-26)', exact: true }).click();
  await expect(page.locator('[data-date="2026-10-26"] .cm-content')).toBeFocused();
  await expect(page.locator('.day-toggle[aria-expanded=true]')).toHaveCount(1);
  await expect(page.locator('[data-date="2020-02-29"] .day-content')).toBeHidden();
  expect(await storedDates(page)).toEqual(['2020-02-29']);
});
