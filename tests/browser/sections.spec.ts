import { expect, test } from '@playwright/test';
import { openDate, openJournal, restoreDays, storedDates } from './helpers';

const TODAY = '2026-10-25';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
});

test('omits today’s delete button and updates the buttons when the local date changes', async ({ page }) => {
  await openJournal(page);
  await restoreDays(page, { [TODAY]: 'Today’s memory.', '2026-10-26': 'Tomorrow’s plan.', '2020-02-29': 'An older memory.' });
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await expect(page.getByRole('button', { name: `Delete entry for ${TODAY}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete entry for 2026-10-26', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete entry for 2020-02-29', exact: true })).toBeVisible();
  await page.clock.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Delete entry for 2026-10-26', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Delete entry for ${TODAY}`, exact: true })).toBeVisible();
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
  await expect(page.locator('.date-link')).toHaveText(dates);
  await expect(page.locator('.date-link[aria-current]')).toHaveText(TODAY);
  await page.screenshot({ path: 'test-results/dates-sidebar-mobile.png' });
  await page.locator('#date-sidebar nav').evaluate(nav => { nav.scrollTop = nav.scrollHeight; });
  await expect(page.getByRole('button', { name: 'Go to today', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Add date', exact: true })).toBeInViewport();
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

test('goes to the current local date without adding a special date row', async ({ page }) => {
  await openJournal(page);
  await openDate(page, '2020-02-29');
  await page.keyboard.insertText('An earlier memory.');
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await expect(page.locator('.date-link').first()).toHaveText(TODAY);
  await page.clock.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.date-link')).toHaveText([TODAY, '2020-02-29']);
  await expect(page.locator('.date-link[aria-current]')).toHaveText('2020-02-29');
  await page.getByRole('button', { name: 'Go to today', exact: true }).click();
  await expect(page.locator('[data-date="2026-10-26"] .cm-content')).toBeFocused();
  await expect(page.locator('.day-toggle[aria-expanded=true]')).toHaveCount(1);
  await expect(page.locator('[data-date="2020-02-29"] .day-content')).toBeHidden();
  await expect.poll(() => storedDates(page)).toEqual(['2020-02-29']);
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await expect(page.locator('.date-link')).toHaveText(['2026-10-26', TODAY, '2020-02-29']);
});

test('removes a previously opened, collapsed date when another tab deletes it', async ({ page, context }) => {
  await openJournal(page);
  await restoreDays(page, { '2020-02-29': 'An older memory.' });
  await openDate(page, '2020-02-29');
  await openDate(page, TODAY);
  const removed = page.locator('[data-date="2020-02-29"]');
  await expect(removed.locator('.day-toggle')).toHaveAttribute('aria-expanded', 'false');
  const other = await context.newPage();
  await openJournal(other);
  await other.getByRole('button', { name: 'Dates', exact: true }).click();
  other.once('dialog', dialog => dialog.accept());
  await other.getByRole('button', { name: 'Delete entry for 2020-02-29' }).click();
  await expect(removed).toBeHidden();
  await page.getByRole('button', { name: 'Dates', exact: true }).click();
  await expect(page.locator('.date-link')).toHaveText([TODAY]);
  expect(await storedDates(page)).toEqual(['2020-02-29']);
});

for (const keepTyping of [false, true]) {
  test(`defers a remote date deletion during composition${keepTyping ? ' and preserves new typing' : ''}`, async ({ page, context }) => {
    const date = '2020-02-29';
    await openJournal(page);
    await openDate(page, date); await page.keyboard.insertText('Old memory.');
    await expect(page.getByRole('status')).toHaveText('Saved on this device only');
    const other = await context.newPage(); await openJournal(other); await openDate(other, date);
    const content = page.locator(`[data-date="${date}"] .cm-content`);
    await content.focus(); await content.dispatchEvent('compositionstart');
    await page.keyboard.insertText('Composing.');
    await expect(other.locator(`[data-date="${date}"] .cm-content`)).toHaveText('Old memory.Composing.');
    // Observe delivery so the assertions exercise an actual deferred update.
    await page.evaluate(date => {
      const received = new BroadcastChannel('minijour-v1');
      received.onmessage = event => {
        if (event.data.date !== date) return;
        document.documentElement.dataset.testRemoteDate = date;
        received.close();
      };
    }, date);
    await other.getByRole('button', { name: 'Dates', exact: true }).click();
    other.once('dialog', dialog => dialog.accept());
    await other.getByRole('button', { name: `Delete entry for ${date}` }).click();
    await expect(page.locator('html')).toHaveAttribute('data-test-remote-date', date);
    await expect(content).toBeVisible();
    await expect(content).toHaveText('Old memory.Composing.');
    if (keepTyping) await page.keyboard.insertText('New words.');
    await content.dispatchEvent('compositionend');
    if (keepTyping) {
      await expect(content).toHaveText('New words.');
      await expect(other.locator(`[data-date="${date}"] .cm-content`)).toHaveText('New words.');
    } else {
      await expect(page.locator(`[data-date="${date}"]`)).toBeHidden();
      await expect(page.locator(`[data-date="${TODAY}"] .cm-content`)).toBeFocused();
    }
  });
}
