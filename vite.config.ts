import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // Explicit WASM loading works in Vite without a bundler-specific WASM plugin.
  resolve: { alias: [{ find: /^@automerge\/automerge$/, replacement: '@automerge/automerge/slim' }] },
  build: {
    rollupOptions: { output: { manualChunks: { editor: ['@codemirror/view', '@codemirror/state', '@codemirror/lang-markdown', '@codemirror/commands'] } } },
  },
  plugins: [VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'minijour', short_name: 'minijour',
      description: 'A quiet place to write. Markdown, photos, and nothing in the way.',
      start_url: './', scope: './', display: 'standalone',
      background_color: '#f7f6f2', theme_color: '#f7f6f2',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,css,svg,png,wasm,woff2}'],
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      // Only cache the app shell. Journal data and OAuth tokens never enter this cache.
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/code=/, /error=/],
    },
  })],
});
