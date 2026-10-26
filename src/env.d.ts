/// <reference types="vite-plugin-pwa/client" />
// Replaced at build time by Vite; package.json is the version's source of truth.
declare const __APP_VERSION__: string;
declare const __SOURCE_URL__: string;

interface ImportMetaEnv {
  readonly VITE_DROPBOX_APP_KEY?: string;
}
