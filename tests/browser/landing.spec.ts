import { expect, test } from '@playwright/test';
import { openDate } from './helpers';
import * as A from '@automerge/automerge';
import { createDay, editDay } from '../../src/domain/day';

test('explains the app without opening a local journal and links to the editor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Simple, private journaling.');
  await expect(page.getByRole('region', { name: 'How minijour works' })).toContainText('encrypted backup and sync');
  await expect(page.getByText('No sign-up. Install for offline writing.', { exact: true })).toBeInViewport();
  await expect(page.getByRole('link', { name: 'About your data' })).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveCount(0);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Open journal' }).click();
  await expect(page).toHaveURL(/\/journal\/$/);
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.getByRole('link', { name: 'About minijour', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Simple, private journaling.');
  expect(errors).toEqual([]);
});

test('serves a real journal page, root-relative identity, and correct launch/scope URLs', async ({ page, request, baseURL }) => {
  const response = await request.get(new URL('journal/', baseURL!).href);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('Your journal · minijour');
  await page.goto('./journal/');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifestUrl = new URL(href!, page.url());
  const manifestResponse = await request.get(manifestUrl.href);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  const launch = new URL(manifest.start_url, manifestUrl);
  expect(launch.href).toBe(new URL('journal/', baseURL!).href);
  expect(new URL(manifest.scope, manifestUrl).href).toBe(baseURL);
  // Manifest ID resolves against the origin, unlike start_url.
  expect(new URL(manifest.id, launch.origin).href).toBe(baseURL);
  await page.goto(launch.href);
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('installs from the landing page and opens the journal offline for the first time', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Open journal' }).click();
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.insertText('First words, written offline.');
  await expect(page.getByRole('status')).toContainText('offline');
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('First words, written offline.');
  await page.getByRole('link', { name: 'About minijour', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Simple, private journaling.');
});


test('keeps the desktop introduction readable and all primary links functional', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./');
  await expect(page.getByRole('link', { name: 'Open journal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', /github\.com\/folinimarc\/minijour\/tree\//);
  await expect(page.getByRole('link', { name: 'GPLv3' })).toHaveAttribute('href', './LICENSE.txt');
  await expect(page.getByRole('region', { name: 'How minijour works' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('opens existing journal data after visiting the information page', async ({ page }) => {
  await page.goto('./');
  const history = Array.from(A.save(editDay(createDay('2020-01-01'), 'An existing memory.')));
  await page.evaluate(data => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('minijour-v1', 1);
    open.onupgradeneeded = () => {
      for (const store of ['days', 'photos', 'settings']) open.result.createObjectStore(store);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('days', 'readwrite');
      tx.objectStore('days').put(new Uint8Array(data), '2020-01-01');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), history);
  await page.getByRole('link', { name: 'Open journal' }).click();
  await openDate(page, '2020-01-01');
  await expect(page.locator('[data-date="2020-01-01"] .cm-content')).toHaveText('An existing memory.');
  await page.reload();
  await expect(page.locator('[data-date="2020-01-01"] .day-heading time')).toHaveText('2020-01-01');
  await openDate(page, '2020-01-01');
  await expect(page.locator('[data-date="2020-01-01"] .cm-content')).toHaveText('An existing memory.');
});
