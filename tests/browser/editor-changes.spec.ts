import { expect, test } from '@playwright/test';
import { openJournal } from './helpers';

test('keeps emoji replacements, deletion, undo, redo, and multiline paste consistent after saving', async ({ page }) => {
  await openJournal(page);
  const content = page.locator('.cm-content');
  await page.keyboard.insertText('A🙂B café');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.insertText('🚀');
  await expect(content).toHaveText('A🚀B café');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).toHaveText('A🙂B café');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(content).toHaveText('A🚀B café');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  await expect(content).toHaveText('AB café');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).toHaveText('A🚀B café');
  await page.keyboard.press('End');
  await page.keyboard.insertText('\nOne\nTwo');
  await expect(content).toHaveText('A🚀B café\nOne\nTwo', { useInnerText: true });
  await expect(page.getByRole('status')).toContainText('Saved on this device');
  await page.reload();
  await expect(content).toHaveText('A🚀B café\nOne\nTwo', { useInnerText: true });
});
