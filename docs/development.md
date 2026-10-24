# Developer guide

[Back to the README](../README.md)

## Set up

Use Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. To test installation and offline operation, use a production build:

```sh
npm run build
npm run preview
```

The development server deliberately does not register a service worker. This prevents an old cached build from interfering with development.

## Architecture

This project intentionally uses TypeScript and normal DOM elements instead of a UI framework. There is one small abstraction for remote files and no generic plugin or service-container system.

```text
src/
  landing.ts          Small landing-page entry; no journal/database initialization
  urls.ts             Shared root and journal links for both entry points
  base.css            Shared colors, typography, and basic element styles
  landing.css         Landing-page layout
  main.ts             Wires the application together and handles user actions
  domain/
    day.ts            Date helpers and Automerge document operations
    journal.ts        In-memory journal, durable saves, change notifications
  crypto/
    vault.ts          Password wrapping, encryption, and encrypted file adapter
  storage/
    local.ts          IndexedDB access, including safe saves from multiple tabs
    backup.ts         Portable ZIP export and lossless backup restore
  sync/
    cloud.ts          File contract, plus atomic create for vault storage
    dropbox.ts        Dropbox OAuth and API requests
    engine.ts         Pull, Automerge merge, and push
  ui/
    cloud-settings.ts Connection, password unlock, and legacy import controls
    shell.ts          Static application markup and element references
    editor.ts         CodeMirror editor and photo previews
    photos.ts         Image resizing and local display URLs
  style.css           Journal/editor visual styles
```

If you're learning, follow this path:

1. Read `domain/day.ts` and its tests to see how two documents merge.
2. Read `storage/local.ts` to see how data survives closing the page.
3. Follow a keystroke from `ui/editor.ts` through `main.ts` to `Journal.merge()`.
4. Read `sync/cloud.ts`, then `sync/engine.ts`. The engine doesn't know about HTTP or OAuth.
5. Read `crypto/vault.ts`, which wraps that file contract with encryption, then `sync/dropbox.ts` for HTTP/OAuth. Encryption stays outside the document and merge logic.

### Pages and PWA launch

Vite builds two HTML entries: `index.html` for the information page and `journal/index.html` for the editor. There is no client-side router and no server rewrite requirement. `VITE_BASE_PATH` defaults to `/`; set `/minijour/` for project Pages. It controls asset paths and the stable manifest ID. The PWA starts at `./journal/` relative to the manifest, and its scope remains the app root. Manifest `id` resolves against the origin, so it explicitly includes the deployment path to match older installations' identity.

Both pages register the same service worker, which precaches both shells. Navigation fallback is limited to journal URLs, so a cached journal never replaces the landing page. The small landing entry forwards old root PWA launches and OAuth callbacks; `#about` lets installed users deliberately view the landing page. Shared URLs resolve relative to the entry module, keeping links correct in development and built subdirectory deployments. IndexedDB's name and schema stay unchanged.

### The data model

The interface is one continuous chronological page. Internally, **each day is its own Automerge document containing `{ text: string }`**, displayed in a separate editor. Export combines the sections into one `journal.md` with `# YYYY-MM-DD` headings. Day boundaries are managed by the app; a selection or undo history stays within its day's editor.

Per-day documents keep transfers smaller and make a date heading unique without trying to merge independently inserted headings in freeform text. Devices construct the same immutable creation change for a given date, then switch to fresh actor IDs for actual edits. This shared starting point matters: independently creating two nested text objects would cause property conflicts rather than collaborative text edits. The fixed creation actor must never be used for subsequent typing.

On each editor update, `Automerge.updateText()` records text operations. Incoming copies are combined with `Automerge.merge()`. The editor keeps the document version actually visible during keyboard composition, so incoming sync cannot turn an unfinished Android input into an accidental deletion of remote text.

IndexedDB saves merge inside a read/write transaction. That protects against two tabs writing stale copies. A BroadcastChannel updates other open tabs after a successful save.

### Dropbox file layout

The sync engine works with logical paths `/days/YYYY-MM-DD/<writer-id>.automerge` and `/photos/<photo-id>.jpg`. `EncryptedFiles` translates these before Dropbox receives anything:

```text
minijour-encrypted-v1/
  vault.json               Public format version, vault ID, salt, wrapped key
  objects/
    <encrypted-name>.bin   Encrypted document or photo
```

The older `minijour-v1/` folder is read only through an explicit import action. No new plaintext files are uploaded there, and importing never deletes or rewrites it. Older app versions still use that folder: update all devices to the encrypted version before continuing cross-device editing.

A writer ID is unique to each running app instance. It owns one checkpoint per day it changes. Checkpoints contain Automerge history, so other devices can combine them later even when the original writer is offline. One writer never overwrites another's file. A fresh app compares the merged remote heads with its local heads and uploads only days containing additional changes.

The engine lists checkpoints, downloads new revisions, merges them locally, transfers photos, and uploads local changes. Repeated requests are safe because the library recognizes changes it has already seen. Concurrent text merging belongs to Automerge; the engine coordinates file transfer. Remote files are validated before use.

Sync runs after edits settle, on opening/returning online, and every 30 seconds while visible. If edits arrive during a sync, another round follows. **It cannot guarantee uploads while the app is closed or suspended.** Check the saved status before switching devices if you need the latest edit immediately.

We retain checkpoints and photos rather than implementing destructive remote garbage collection. Storage grows with editing history and app sessions; old snapshots aren't automatically deleted. A fresh device initially downloads the available checkpoints and photos; later polls cache unchanged checkpoint revisions in memory. These are deliberate simplicity tradeoffs, and the first areas to revisit for very large journals.

### Encryption format

`crypto/vault.ts` contains the versioned format. Argon2id v1.3 (`hash-wasm`) uses a random 16-byte salt, 64 MiB of memory, three iterations, one lane, and a 32-byte output. Version 1 fixes these parameters so untrusted metadata cannot request unbounded KDF work. See the [library documentation](https://github.com/Daninet/hash-wasm) and [Argon2 specification](https://www.rfc-editor.org/rfc/rfc9106).

The password-derived AES key encrypts a random 32-byte journal key. All AES-GCM operations use fresh random 12-byte IVs and 128-bit authentication tags. Additional authenticated data binds the format version, vault ID, and purpose. Key wrapping also binds the salt; content encryption binds the full opaque cloud path. Each binary envelope is `IV || ciphertext || tag`.

Filenames are AES-GCM-encrypted logical paths encoded in lowercase hex, so Dropbox's lowercased listing preserves them. Their authentication context differs from file contents. Listing decrypts names without downloading every photo. Concurrent copies of an immutable photo use the first opaque path in sorted order; per-instance day writer IDs prevent document collisions. No manifest is rewritten on each edit.

The public `vault.json` contains `{ version, id, salt, wrappedKey }`. Atomic create-if-absent ensures simultaneous setup cannot replace another device's key. A lost response is retried against the existing header. Missing/damaged headers, wrong passwords, and authentication failures stop sync; they never trigger plaintext fallback. Keep the header with the ciphertext: neither is usable alone.

The unwrapped key is non-exportable in Web Crypto. Optional remember-on-device stores that CryptoKey by IndexedDB structured cloning, bound to the exact vault descriptor; it never stores the password. Settings and keys are excluded from ZIP backups. Local data remains plaintext. This implementation has automated regression coverage, not an independent cryptographic security audit. It trusts the served JavaScript and does not prevent cloud deletion or replay of old valid ciphertext.

### Photos and backups

Photos are resized to at most 2400 pixels on the longest side, converted to JPEG at quality 0.85, and given unique filenames. Camera originals are not retained. Markdown stores relative `photos/…` links, never temporary browser blob URLs. Photos are uploaded before documents that reference them.

A downloaded backup ZIP contains:

- `journal.md`: your entire journal as ordinary Markdown.
- `photos/`: portable JPEG attachments.
- `minijour/`: Automerge documents for restoring history and future merging.

Restore combines with the current journal. It never replaces the journal wholesale. Treat the ZIP as private: it contains journal content and editing history. Restore currently accepts up to 250 MB compressed / 500 MB expanded.

An exported `journal.md` can be read in Obsidian. **Editing that exported file does not sync those edits back into minijour.** Automerge's binary documents are the editable source of truth.

## Checks

GitHub Actions runs unit tests and production browser tests on pull requests and pushes to `main`. Its two configurations cover manual Dropbox setup at the root and a configured deployment at `/minijour/`. You can reproduce the latter with:

```sh
MINIJOUR_TEST_SUBDIRECTORY=1 VITE_DROPBOX_APP_KEY=testpublickey npm run test:browser
```

The key above is synthetic and browser tests mock Dropbox. The build includes version/source metadata and license notices. `scripts/build-info.mjs` supports Git checkouts and downloaded source archives; `scripts/notices.mjs` collects runtime dependency licenses from the lockfile's installed packages.

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Unit tests cover encryption round trips, authentication failures, concurrent vault setup, remembered keys, legacy import, and independent day creation, text convergence, concurrent local saves, cursor anchors with emoji, offline sync, failed uploads, photo transfer, and backup restore. Browser tests exercise the production build: focus and persistence, photo insertion, offline reloads, midnight rollover, multiple tabs, restore, and Dropbox authorization/sync across two simulated devices.

Dropbox browser tests mock the network boundary. A real Dropbox app/account and the actual mobile camera/keyboard still need a device smoke test before relying on the app for irreplaceable entries.

The checked-in app icons can be regenerated with `node scripts/generate-icons.mjs` after installing Playwright's Chromium.

## Compatibility

The first Dropbox connection binds the local journal to its account and app key. That binding survives disconnect. Ownership and the new connection are checked/stored atomically, including legacy connections from earlier builds. This blocks accidental cross-account uploads without deleting or automatically moving user data. Separate accounts use separate browser profiles.

The app version, IndexedDB schema, Dropbox layout, and backup format are separate concerns. Do not rename the database, channel, or cloud root for routine releases. Older installed PWAs may keep running after deployment: test compatibility and migrations before changing persisted data.

## Contribute

Keep changes focused on writing, photos, reliability, and portability. Explain the user-visible behavior in a pull request and include relevant validation. Add regression tests for data-loss or sync bugs. Contributions use GPL-3.0-only; dependencies retain their own licenses.

Use synthetic content in tests and screenshots. Do not post real journal entries, photos, tokens, browser profiles, environment files, or backups in public reports. The Dropbox app key is public configuration; access tokens, refresh tokens, and app secrets are not.
