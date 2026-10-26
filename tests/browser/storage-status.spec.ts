import { expect, test } from '@playwright/test';
import { connect, openJournal } from './helpers';
import { DropboxMock } from './dropbox-mock';

test('uses a compact clickable status icon on a narrow screen and explains it in cloud settings', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.clock.install(); await openJournal(page);
  const button = page.getByRole('button', { name: 'Storage status. Open settings', exact: true });
  await expect(button).toHaveAttribute('data-icon', 'device-check');
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)));
  await page.keyboard.insertText('A short memory.');
  await expect(button).toHaveAttribute('data-icon', 'device');
  await page.clock.runFor(1500);
  await expect(button).toHaveAttribute('data-icon', 'device-check');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const controls = await page.locator('.header-actions').boundingBox();
  expect(controls!.height).toBeLessThanOrEqual(40);
  await button.click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('#cloud-status')).toContainText('Saved on this device only');
  expect(await page.locator('#cloud-status-icon').innerHTML()).toBe(await page.locator('#status-icon').innerHTML());
  await page.screenshot({ path: 'test-results/storage-status-mobile.png' });
  // Focus another control before the browser dispatches the queued close event.
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#close-settings')!.click();
    document.querySelector<HTMLButtonElement>('#status-button')!.focus();
  });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeHidden();
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('shows a device warning when local saving fails', async ({ page }) => {
  await openJournal(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'days') throw new DOMException('Device storage is full.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.keyboard.insertText('An unsaved memory.');
  await expect(page.locator('#status-button')).toHaveAttribute('data-icon', 'device-alert');
  await page.locator('#status-button').click();
  await expect(page.locator('#cloud-status')).toContainText('Could not save on this device');
});

test('uses matching icons for syncing, synced, locked, and offline cloud storage', async ({ page, context }) => {
  test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'Requires a configured provider.');
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await connect(page);
  const button = page.locator('#status-button');
  await expect(button).toHaveAttribute('data-icon', 'cloud-check');
  let release!: () => void;
  let held = false;
  await context.route('https://api.dropboxapi.com/2/files/list_folder', async route => {
    if (!held) { held = true; await new Promise<void>(resolve => { release = resolve; }); }
    await route.fallback();
  });
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('A synced memory.');
  await expect(page.getByRole('status')).toContainText('syncing');
  await expect(button).toHaveAttribute('data-icon', 'cloud-sync');
  await button.click();
  await expect(page.locator('#cloud-status')).toContainText('syncing');
  expect(await page.locator('#cloud-status-icon').innerHTML()).toBe(await page.locator('#status-icon').innerHTML());
  release();
  await expect(button).toHaveAttribute('data-icon', 'cloud-check');
  await expect(page.locator('#cloud-status')).toContainText('Saved to Dropbox');
  await page.getByRole('button', { name: 'Lock cloud', exact: true }).click();
  await expect(button).toHaveAttribute('data-icon', 'cloud-alert');
  await expect(page.locator('#cloud-status')).toHaveText('Cloud storage locked');
  await context.setOffline(true);
  await expect(page.locator('#cloud-status')).toContainText('offline');
  await expect(button).toHaveAttribute('data-icon', 'cloud-alert');
  await page.screenshot({ path: 'test-results/storage-status-locked-mobile.png' });
});

test('explains unavailable cloud access separately from a locked cloud', async ({ page, context }) => {
  test.skip(!process.env.VITE_DROPBOX_APP_KEY, 'Requires a configured provider.');
  const mock = new DropboxMock(); await mock.install(context);
  await openJournal(page); await connect(page);
  await page.locator('#status-button').click();
  await page.getByRole('button', { name: 'Lock cloud', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await context.route('https://api.dropboxapi.com/2/files/list_folder', route => route.abort());
  await page.reload();
  await expect(page.locator('#status-button')).toHaveAttribute('data-icon', 'cloud-alert');
  await page.locator('#status-button').click();
  await expect(page.locator('#cloud-status')).toHaveText('Cloud storage unavailable');
  await expect(page.getByRole('button', { name: 'Retry cloud connection' })).toBeVisible();
});
