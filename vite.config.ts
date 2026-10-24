import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { dependencyNotices } from './scripts/notices.mjs';
import { buildInfo } from './scripts/build-info.mjs';

const metadata = buildInfo();

export default defineConfig(({ mode }) => {
  const base = loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH || '/';
  if (!base.startsWith('/') || !base.endsWith('/') || /[?#]|\.\./.test(base)) {
    throw new Error('VITE_BASE_PATH must be a path with leading and trailing slashes, e.g. /minijour/.');
  }
  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(metadata.version),
      __SOURCE_URL__: JSON.stringify(metadata.sourceUrl),
    },
    // Explicit WASM loading works in Vite without a bundler-specific WASM plugin.
    resolve: { alias: [{ find: /^@automerge\/automerge$/, replacement: '@automerge/automerge/slim' }] },
    build: {
      rollupOptions: {
        input: { index: resolve('index.html'), journal: resolve('journal/index.html') },
        output: { manualChunks: { editor: ['@codemirror/view', '@codemirror/state', '@codemirror/lang-markdown', '@codemirror/commands'] } },
      },
    },
    plugins: [{
      name: 'release-notices',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync('LICENSE', 'utf8') });
        this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: dependencyNotices() });
        this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify(metadata, null, 2) + '\n' });
      },
    }, VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'minijour', short_name: 'minijour',
        description: 'A Markdown journal with photos and optional encrypted Dropbox sync.',
        id: base, start_url: './journal/', scope: './', display: 'standalone',
        background_color: '#f7f6f2', theme_color: '#f7f6f2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,wasm,woff2}', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'build.json'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Only cache the app shell. Journal data and OAuth tokens never enter this cache.
        navigateFallback: 'journal/index.html',
        navigateFallbackAllowlist: [/\/journal\/?(?:\?.*)?$/],
        navigateFallbackDenylist: [/code=/, /error=/],
      },
    })],
  };
});
