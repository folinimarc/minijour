# Developer guide

[Back to the README](../README.md) · [Architecture details](architecture.md)

## Run the app

Use Node.js 20.19+ within 20.x, or Node.js 22.12+.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. For installation and offline testing, run `npm run build` followed by `npm run preview`. The development server does not register a service worker, so a cached build cannot hide your changes.

No cloud account is needed for local development. To test Dropbox, follow the [deployment guide](deployment.md#dropbox). Never commit `.env`, tokens, browser profiles, or journal backups.

## Find your way around

The app uses TypeScript, normal DOM elements, and CodeMirror for the editor. There is no UI framework or application server.

```text
src/
  main.ts       Starts the journal and coordinates saving, sync, and browser events
  landing.ts    Starts the information page without opening the journal database
  urls.ts       Deployment-aware root and journal URLs
  domain/       Day documents, the in-memory journal, and photo formats
  storage/      IndexedDB, autosave timing, ZIP backups, and photo cleanup
  sync/         Cloud file interfaces, provider adapters, and sync rounds
  crypto/       Password handling and the encrypted file adapter
  ui/           Page markup, editors, and small feature setup functions
  *.css         Shared, information-page, and journal styles
scripts/        Build metadata, licensing, icon generation, and releases
tests/          Unit tests and production browser tests
```

Start with the writing path; the cloud code can wait:

1. [day.ts](../src/domain/day.ts) defines a day as `{ text: string }`. Automerge keeps its editing history so independently edited copies can merge. Read the first tests in [journal.test.ts](../tests/journal.test.ts) alongside it.
2. [editor.ts](../src/ui/editor.ts) turns a text change into an updated day document. [journal-view.ts](../src/ui/journal-view.ts) owns date sections, unsaved blank drafts, and which editors are expanded.
3. [journal.ts](../src/domain/journal.ts) holds the current documents in memory. `stage()` records an edit; `flush()` writes pending edits. Its events let the rest of the app react without putting DOM code into the model.
4. [main.ts](../src/main.ts) connects those events to [autosave.ts](../src/storage/autosave.ts). Writing normally saves after a 1.5-second pause. [local.ts](../src/storage/local.ts) merges each saved day with IndexedDB in one transaction, so another tab's work is kept.
5. [engine.ts](../src/sync/engine.ts) pulls remote checkpoints, merges days through the journal, and uploads missing changes. It depends on the small [CloudFiles interface](../src/sync/cloud.ts), not HTTP or OAuth. [vault.ts](../src/crypto/vault.ts) encrypts that interface; [dropbox.ts](../src/sync/dropbox.ts) supplies the network operations.

For blank-day behavior, save timing, concurrent edits, encryption, and file formats, use the [architecture reference](architecture.md). The reasons behind the less obvious safeguards are documented there and beside the relevant code.

## Follow the UI pattern

[shell.ts](../src/ui/shell.ts) creates the page markup and returns its DOM references. The inferred `JournalUI` type gives setup functions checked access to those elements without repeating a large interface.

Each `setup…()` function owns one feature's handlers and small amount of UI state:

- `settings-dialog.ts`: opening, closing, and focus.
- `date-navigation.ts`: the date drawer and deletion confirmation.
- `photo-input.ts`: camera/file selection and insertion at the remembered cursor.
- `photo-settings.ts` and `photo-cleanup.ts`: preferences and explicit deletion.
- `backup-controls.ts`: download and restore actions.
- `cloud-settings.ts`: connecting an account, unlocking, and disconnecting.
- `storage-banner.ts` and `storage-status.ts`: local-storage advice and save status.
- `pwa.ts`: browser installation and update prompts.

Keep feature handlers in these modules and application coordination in `main.ts`. Pass the model or a short callback when another part of the app is needed. Normal journal events schedule saving and sync; feature handlers do not need their own save timers. Catch rejected promises in event handlers and report them through `notify`.

The view keeps its editor collection private. Photo insertion holds a reference to the editor selected before the file picker opened; its Automerge cursor anchors survive intervening edits. Collapsed editors remain mounted to preserve undo and keyboard composition.

## Make a change

For a UI change, find its setup module and the markup in `shell.ts`. For a storage or sync change, start with its unit tests and the architecture reference. Prefer an existing boundary over another abstraction. Add a helper when it has a clear job, rather than introducing a service container or generic event framework.

TypeScript checks strict types and unused locals/parameters during every build. No runtime package is needed just to organize the application.

## Add a cloud provider

1. Implement `CloudProvider` in a new adapter under `sync/`. Keep provider-specific authorization and HTTP requests there. Use browser-safe authorization such as PKCE where supported; never ship an app secret. Check that the provider supports static websites and the required permissions.
2. Return a `CloudSession` whose `files` implements `VaultStorage`: list paths/revisions, download, upload, idempotent remove, and atomic create-if-absent. Atomic create must work across devices, not just within one tab: it prevents replacing another device's encryption header. Keep existing file roots and revision semantics stable.
3. Store credentials through `LocalStore.saveCloudConnection({ providerId, appId, accountId }, connection)`. IDs must identify the actual provider application and account. When saving refreshed credentials, use `{ requireExisting: true }` so a concurrent disconnect cannot be undone. Use `cloudConnection()` to read and `disconnectCloud()` to remove credentials and the remembered key; retain ownership after disconnect.
4. Add its public build configuration and factory to `configuredProviders()`, and document operator registration and exact redirect URIs in the deployment guide. Add typed environment fields in `env.d.ts`. No provider branches belong in shared settings, encryption, or sync.
5. Add adapter tests for authorization, refresh/disconnect races, atomic creation, file operations, and account binding. Exercise the shared encrypted sync flow with a mock, then verify the actual provider in browsers and installed PWAs before claiming support.

One local journal uses one provider and account. Switching storage providers or moving a journal to another account is a separate migration feature; merely adding an adapter does not enable it.

## Run the checks

```sh
npm test
npx playwright install chromium
VITE_DROPBOX_APP_KEY= npm run test:browser
MINIJOUR_TEST_SUBDIRECTORY=1 VITE_DROPBOX_APP_KEY=testpublickey npm run test:browser
```

The browser commands build the app and run Chromium at a mobile viewport. The first tests local-only operation at the root. The second tests a cloud-enabled build at `/minijour/`; Dropbox requests are mocked while the actual encryption, storage, and sync code run. Run them sequentially because both use port 4173. Explicit variables override local `.env` configuration.

Unit tests cover merging, saves, retries, encryption, account binding, photos, backups, and releases. Browser tests cover writing, offline reloads, dates, multiple tabs, composition, and cross-device sync. Use synthetic journal content. Add regression coverage when fixing data-loss, sync, or timing bugs; reuse the existing checks for straightforward presentation changes.

Real camera/keyboard behavior, installed-PWA authorization, and live Dropbox still need device checks. See the [deployment checklist](deployment.md#verify-before-inviting-users).

## Build and contribute

Vite builds `index.html` and `journal/index.html` as separate pages. Both register the same service worker. Installed apps start at `/journal/`; the home page stays an information page. `VITE_BASE_PATH` controls root versus subdirectory hosting. No client-side router or server rewrites are required.

`npm run build` checks types, emits the static site, and includes version/source metadata and license notices. `scripts/build-info.mjs` supports Git checkouts and source archives; `scripts/notices.mjs` collects runtime dependency licenses. Regenerate checked-in app icons with `node scripts/generate-icons.mjs` after installing Chromium. [Artwork provenance](architecture.md#artwork) is recorded separately.

The app version, IndexedDB schema, cloud layout, and backup format have separate versions. Do not rename the database or cloud folder as part of ordinary cleanup. The obsolete plaintext-cloud importer and root OAuth redirects from early development have been removed; current journals, keys, encrypted files, and backups keep their existing formats.

Keep contributions focused on writing, photos, reliability, and portability. Explain the resulting behavior and relevant validation in pull requests. Contributions use GPL-3.0-only; dependencies retain their own licenses. Follow the [release guide](releasing.md) when publishing.
