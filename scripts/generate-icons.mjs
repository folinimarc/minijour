// Optional: regenerate the checked-in app icons after editing public/icon.svg.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>body{margin:0}svg{width:100vw;height:100vh;display:block}</style>${svg}`);
    await page.screenshot({ path: `public/icon-${size}.png`, omitBackground: true });
  }
} finally { await browser.close(); }
