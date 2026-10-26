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

This project intentionally uses TypeScript and normal DOM elements instead of a UI framework. Small interfaces describe remote files and provider connections; there is no plugin loader or service-container system.

```text
src/
  landing.ts          Small landing-page entry; no journal/database initialization
  urls.ts             Shared root and journal links for both entry points
  base.css            Shared colors, typography, and basic element styles
  landing.css         Landing-page layout
  main.ts             Wires the application together and handles user actions
  domain/
    photos.ts         Conservative photo references and deletion record format
    day.ts            Date helpers and Automerge document operations
    journal.ts        In-memory journal, durable saves, change notifications
  crypto/
    vault.ts          Password wrapping, encryption, and encrypted file adapter
  storage/
    local.ts          IndexedDB access, including safe saves from multiple tabs
    persistence.ts    Best-effort browser storage protection after a save
    autosave.ts       Idle save timer and delayed retries after local save errors
    backup.ts         Portable ZIP export and text history restore
    photo-cleanup.ts  Candidate photo IDs and sizes for explicit review
  sync/
    cloud.ts          File contract, plus atomic create for vault storage
    provider.ts       Provider/session interfaces for authorization and storage
    providers.ts      Build-time provider registry and OAuth callback dispatch
    dropbox.ts        Dropbox adapter, OAuth, and API requests
    engine.ts         Pull, Automerge merge, and push
  ui/
    icons.ts          Inline SVG icons shared by the landing page and journal
    photo-cleanup.ts  Review, confirmation, and required cloud sync
    cloud-settings.ts Connection, password unlock, and legacy import controls
    storage-banner.ts Local storage advice and remembered dismissal
    shell.ts          Static application markup and element references
    journal-view.ts   Date sections, local drafts, collapse state, lazy editors
    date-navigation.ts Date drawer, date picker, and confirmed entry deletion
    editor.ts         CodeMirror editor and photo previews
    photos.ts         Image resizing and local display URLs
  style.css           Journal/editor visual styles
```

If you're learning, follow this path:

1. Read `domain/day.ts` and its tests to see how two documents merge.
2. Read `storage/local.ts` to see how data survives closing the page.
3. Follow a keystroke from `ui/editor.ts` through `JournalView` to `Journal.stage()`, then the save timer in `main.ts` and `storage/autosave.ts`.
4. Read `sync/cloud.ts`, then `sync/engine.ts`. The engine doesn't know about HTTP or OAuth.
5. Read `crypto/vault.ts`, which wraps that file contract with encryption, then `sync/provider.ts` and `sync/providers.ts` for connection setup. `sync/dropbox.ts` implements HTTP/OAuth. Encryption stays outside the document and merge logic.

### Pages and PWA launch

Vite builds two HTML entries: `index.html` for the information page and `journal/index.html` for the editor. There is no client-side router and no server rewrite requirement. `VITE_BASE_PATH` defaults to `/`; set `/minijour/` for project Pages. It controls asset paths and the stable manifest ID. The PWA starts at `./journal/` relative to the manifest, and its scope remains the app root. Manifest `id` resolves against the origin, so it explicitly includes the deployment path to match older installations' identity.

Both pages register the same service worker, which precaches both shells. Navigation fallback is limited to journal URLs, so a cached journal never replaces the landing page. The small landing entry forwards old root PWA launches and OAuth callbacks; `#about` lets installed users deliberately view the landing page. Shared URLs resolve relative to the entry module, keeping links correct in development and built subdirectory deployments. IndexedDB's name and schema stay unchanged.

### Journal logo

The book mark in `ui/logo.svg`, shared by `ui/icons.ts` and both favicons, was introduced as inline SVG in the [initial implementation](https://github.com/folinimarc/minijour/commit/ebb94a1e35e615696412f5a017ba0d325c86f24e), originally in `ui/shell.ts`. It was created during the assistant-assisted implementation; no third-party source or icon package was recorded. The wordmark uses the device's system font. Both pages share the SVG helper and wordmark styles in `base.css`.

A provenance check on 2026-10-25 searched distinctive SVG path fragments and compared the official [Feather book](https://github.com/feathericons/feather/blob/main/icons/book.svg), [Lucide book](https://github.com/lucide-icons/lucide/blob/main/icons/book.svg) and [notebook](https://github.com/lucide-icons/lucide/blob/main/icons/notebook.svg), and [Tabler book-2](https://github.com/tabler/tabler-icons/blob/main/icons/outline/book-2.svg). None matched this path. This supports treating it as project artwork under the repository's [GPL-3.0-only license](../LICENSE); it does not establish uniqueness or trademark clearance. No separate third-party logo attribution was identified.

### The data model

The interface is one continuous page with the newest date first. Internally, **each day is its own Automerge document containing `{ text: string }`**, displayed in a separate editor. Export combines the sections into one `journal.md` with `# YYYY-MM-DD` headings. Day boundaries are managed by the app; a selection or undo history stays within its day's editor.

`hasContent()` treats whitespace-only text as empty. `ui/journal-view.ts` owns local drafts outside `Journal.days`. Opening a date shows its heading immediately; the first edit with content merges its Automerge document into the journal and saves it. Whitespace-only drafts never reach IndexedDB, backups, or sync. Dates cleared by local typing retain their headings for undo. Journal events mark local edits separately from incoming cloud, restore, and cross-tab changes. An incoming empty date clears its local opened/expanded state and removes its heading and sidebar link; if active, the view returns to today. Today keeps its blank writing surface. Midnight removes an abandoned blank daily draft without interrupting another selected date.

The view sorts headings newest first and creates editors only for expanded sections. Only today starts expanded. Opening a date through the sidebar collapses all other sections. All sidebar dates use the same newest-first order. Go to today and Add date buttons stay above the scrolling list; the former computes the current local date when clicked and the latter toggles an inline date picker. Focusing an editor keeps it expanded during incoming changes. Collapse choices last for the current tab session. Existing editors stay mounted when collapsed to preserve undo and composition; older dates never opened need only a heading. Text changes update only the affected editor unless the set of visible dates changes. The date drawer uses a native modal dialog for keyboard focus, Escape, and a small-screen overlay. Navigation expands and focuses an entry; adding an existing date does not duplicate it.

Deleting a date asks for confirmation, then clears its text through `Journal.edit()`. This keeps the Automerge deletion history locally and in cloud checkpoints so unchanged old replicas do not resurrect text. Concurrent new edits can still merge. No day documents or photo blobs are physically removed, and there is no format migration. Deleted dates disappear from the view unless new content arrives; today's blank draft is recreated. Unsaved blank drafts are simply discarded. Markdown export skips empty dates and keeps its existing oldest-first order; ZIP history and cloud sync retain saved clearing history.

Sync still fetches and merges all days and photos. Deferring document sync until navigation would require reliable remote indexing and changes to backup and photo-reference checks. Lazy editor creation reduces browser work without changing the storage contract.

The top bar is sticky. On opening, the editor explicitly scrolls its final position into view; delayed photo loads and viewport resizing can repeat that reveal until the first user interaction. Browser scroll restoration is disabled on the journal page. After interaction, incoming sync preserves the person's position.

`storage/persistence.ts` requests browser storage protection after the first successful edit. It records the attempt in local preferences and does not repeat automatic requests. A refusal or unsupported API does not disable IndexedDB saves. The header reports save and sync status. `ui/storage-banner.ts` shows local-only storage advice after cloud connection lookup, unless a connection exists or the local `local-storage-banner-dismissed` setting is true. Dismissal is written before hiding the banner, and failures leave it visible. The preference is device-local and excluded from ZIPs and sync. Deployments without providers point to downloaded backups instead. Settings explain browser-data loss and offer configured providers. Storage protection never prevents deliberate clearing of browser data.

Per-day documents keep transfers smaller and make a date heading unique without trying to merge independently inserted headings in freeform text. Devices construct the same immutable creation change for a given date, then switch to fresh actor IDs for actual edits. This shared starting point matters: independently creating two nested text objects would cause property conflicts rather than collaborative text edits. The fixed creation actor must never be used for subsequent typing.

On each editor update, `Automerge.updateText()` records text operations and `Journal.stage()` merges the document into memory. The keystroke path does not serialize or reload the full day, write IndexedDB, or broadcast to other tabs. `storage/autosave.ts` uses these rules:

| Trigger | Rule |
| --- | --- |
| Editing pauses | Start a batch after at least 1.5 seconds without a local text change, if work is pending and no local batch is running. This includes deletions, undo, photo-link insertion, and whitespace-only draft edits. |
| Local save fails | Keep the edits pending and schedule one retry after 10 seconds. The retry still requires the editing pause. Further failures schedule another delayed retry. New edits or sync requests replace that timer with the normal idle timer. Explicit saves use the same retry path on failure. |
| Startup, return online/visible, 30-second cloud polling | Request an automatic batch; respect the same editing pause. Cloud checks and unlocking account metadata are separate from journal saving. |
| Typing resumes during a local save | Let the captured batch finish. Newer edits remain pending. Recheck the pause and pending local edits before starting its cloud phase. |
| Typing resumes during cloud sync | Let the existing request finish; do not cancel it or queue an immediate extra round. New changes keep the pending status and wait for another idle batch. |
| Explicit actions | Sync now, authorization redirects, entry deletion, photo cleanup, and app updates may flush immediately. Backgrounding or page exit also attempts an immediate save. Choosing a photo stores its image immediately; its Markdown link follows autosave. |

Only edits reset the typing clock; remote changes and polling merely request work. Elapsed times use `performance.now()` so changing the device clock does not bypass the pause. There is no recurring local-save check: while nothing changes and no save failed, no save timer is running. Clean journals are skipped and local batches never overlap. Continuous typing can remain unsaved indefinitely until a pause or an explicit action; there is no fixed maximum crash-loss window. Browser suspension or throttling can also delay timers.

`Journal.flush()` snapshots only changed dates. Per-date revisions prevent a completed save from marking newer typing as durable. Failed dates remain pending for retry. Explicit sync, cloud authorization, photo cleanup, and app updates flush pending changes immediately. Backup export includes the current in-memory entries. Backgrounding and page exit attempt an immediate save, but cannot guarantee completion if the browser closes. The status distinguishes edits waiting to save from durable local data. This batching deliberately accepts losing recent unsaved typing in a crash.

Incoming copies are combined with `Automerge.merge()`. The editor keeps the document version actually visible during keyboard composition, so incoming sync cannot turn an unfinished Android input into an accidental deletion of remote text. Its receive callback runs only once the incoming document is applied; deferred updates carry that callback so a remotely cleared section is not hidden, or focus moved, during composition. Newer updates replace both the deferred document and callback.

IndexedDB saves merge inside a read/write transaction. That protects against two tabs writing stale copies. A BroadcastChannel updates other open tabs after a successful save.

### Cloud providers

`sync/providers.ts` is the only place that selects providers from build configuration. It returns configured `CloudProvider` instances; `ui/cloud-settings.ts` renders their connection buttons and shares the password, encryption, lock, disconnect, and legacy-import controls. An empty registry shows local-storage guidance without connection buttons. Neither the editor nor the sync engine imports a provider adapter.

A `CloudProvider` has a stable ID and display name, starts authorization, finishes its callback, and opens a saved connection. Its `CloudSession` provides `VaultStorage`, disconnect, and optionally read-only legacy files. The shared OAuth dispatcher remembers the selected provider in the current tab, invokes only that provider on return, and clears callback parameters. Each adapter validates its own state and authorization response.

The current registry contains only Dropbox. Existing Dropbox tokens and remembered keys remain usable after this refactor. A disabled provider is never opened automatically, even if credentials remain on the device. Changing a deployment's Dropbox key blocks its old connection rather than moving the journal to a different application.

### Add a cloud provider

1. Implement `CloudProvider` in a new adapter under `sync/`. Keep provider-specific authorization and HTTP requests there. Use browser-safe authorization such as PKCE where supported; never ship an app secret. Check that the provider supports static websites and the required permissions.
2. Return a `CloudSession` whose `files` implements `VaultStorage`: list paths/revisions, download, upload, idempotent remove, and atomic create-if-absent. Atomic create must work across devices, not just within one tab: it prevents replacing another device's encryption header. Keep existing file roots and revision semantics stable.
3. Store credentials through `LocalStore.saveCloudConnection({ providerId, appId, accountId }, connection)`. IDs must identify the actual provider application and account. On opening or refreshing an existing connection, use `{ requireExisting: true }` so a concurrent disconnect cannot be undone. Use `cloudConnection()` to read and `disconnectCloud()` to remove credentials and the remembered key; retain ownership after disconnect.
4. Add its public build configuration and factory to `configuredProviders()`, and document operator registration and exact redirect URIs in the deployment guide. Add typed environment fields in `env.d.ts`. No provider branches belong in shared settings, encryption, or sync.
5. Add adapter tests for authorization, refresh/disconnect races, atomic creation, file operations, and account binding. Exercise the shared encrypted sync flow with a mock, then verify the actual provider in browsers and installed PWAs before claiming support.

One local journal uses one provider and account. Switching storage providers or moving a journal to another account is a separate migration feature; merely adding an adapter does not enable it.

### Cloud file layout

The sync engine works with logical paths `/days/YYYY-MM-DD/<writer-id>.automerge` and `/photos/<photo-id>.jpg`. `EncryptedFiles` translates these before the provider receives anything (Dropbox stores them under its app folder):

```text
minijour-encrypted-v1/
  vault.json               Public format version, vault ID, salt, wrapped key
  objects/
    <encrypted-name>.bin   Encrypted document, photo, or deletion record
```

The older `minijour-v1/` folder is read only through an explicit import action. No new plaintext files are uploaded there, and importing never deletes or rewrites it. Older app versions still use that folder: update all devices to the encrypted version before continuing cross-device editing.

A writer ID is unique to each running app instance. It owns one checkpoint per day it changes. Checkpoints contain Automerge history, so other devices can combine them later even when the original writer is offline. One writer never overwrites another's file. A fresh app compares the merged remote heads with its local heads and uploads only days containing additional changes.

The engine lists checkpoints, downloads new revisions, merges them locally, transfers photos, and uploads local changes. Repeated requests are safe because the library recognizes changes it has already seen. Concurrent text merging belongs to Automerge; the engine coordinates file transfer. Remote files are validated before use.

Two small caches belong to each `SyncEngine` instance. The file cache holds downloaded bytes and validated day documents by path and revision. The day cache holds the merged remote document and a sorted signature of its checkpoint paths/revisions. Unchanged checkpoint sets reuse that document without decoding or merging the history again. A changed set rebuilds only its day, reusing the other decoded checkpoints. Removed paths/days leave the caches, and removed checkpoints are excluded from the rebuilt remote state so missing history can be republished from the local journal.

Every round still offers the remote result to `Journal.mergeDoc()`. It skips identical document versions by comparing their heads and retries pending persistence even if a preceding round merged successfully but failed to save. Differing versions go through the normal merge; backend knowledge alone is insufficient because older editor views can share a backend containing newer changes. Cached documents stay separate from editable local documents; uploaded snapshots are captured before the network request so typing during upload cannot change what the cache says is remote. Invalid checkpoint bytes are discarded from the cache for retry. The caches are memory-only and disappear on reload, locking, or disconnecting. No database, cloud, encryption, or backup format changes are needed. Full folder listing, encrypted filename verification, and the first downloads after reopening remain unchanged.

Automatic sync follows a local save batch and rechecks the editing pause before starting cloud work. Cloud requests run independently so a slow upload cannot block later local saves once typing pauses. An already-started request, including merging incoming documents, is allowed to finish if typing resumes. Edits during an upload mark the cloud copy as pending; they do not ask the engine for an immediate extra round. Remaining changes wait for another idle batch. Successful uploads only clear the pending status if no changes arrived during the request. Startup and returning online/visible request an idle batch. While cloud access is unlocked, a 30-second poll requests an idle batch to discover changes from other devices and retry cloud errors. **Uploads cannot be guaranteed while the app is closed or suspended.** Check the saved status before switching devices if you need the latest edit immediately.

We retain checkpoints and small permanent photo deletion records. Photo files are retained until explicit user-confirmed cleanup. Storage grows with editing history and app sessions; old snapshots aren't automatically deleted. A fresh device initially downloads the available checkpoints and photos; later polls reuse unchanged decoded checkpoints and remote days in memory. These are deliberate simplicity tradeoffs, and the first areas to revisit for very large journals.

### Permanent photo cleanup

`domain/photos.ts` scans for `photos/<UUID>.jpg` paths conservatively, including Markdown reference links and code examples. It checks current text across all days, not just the visible editor. `storage/photo-cleanup.ts` produces a review snapshot of specific IDs and sizes. Only those IDs may be deleted when confirmed; newly unused photos need a new review.

For cloud-bound journals, the UI requires an online, unlocked, successful sync before review and again before deletion. A failed fetch prevents local cleanup. Local removal rechecks references inside an IndexedDB read/write transaction across `days`, `photos`, and `settings`, so saved references from other tabs are respected. Ordinary Markdown deletion never triggers this operation.

The same transaction records permanent deletions in the settings key `photo-deletions-v1` and removes the blobs. The value is a grow-only set represented as a sorted array of photo names. This needs no database schema upgrade. Photo saves check that set transactionally, including downloads, backup restore, and legacy import. Legacy plaintext imports cannot introduce deletion records: those files are ignored outside normal encrypted sync. Preview blob URLs are revoked and rebuilt across tabs after changes.

Sync uses an immutable logical file `/deleted-photos/<photo-id>.jpg.json` for each permanent deletion, containing `{ version: 1, photos: [name] }`. Encryption hides its name and contents like other files. Records are processed before any photo transfer, and a new record must upload successfully before remote bytes are removed. Dropbox removal uses the idempotent adapter contract (`files/delete_v2`; missing files count as success). The encrypted adapter removes every opaque copy of a photo, including concurrent duplicate uploads. A stale upload arriving later is removed on a subsequent sync.

Deletion wins even if an offline device or old backup later adds a reference. This explicit tradeoff avoids attachment conflict resolution or device clocks. Missing links remain editable; re-adding the original photo produces a fresh ID. Deletion records are retained permanently and restored from new backups. Existing downloaded backups, legacy plaintext cloud files, and provider version history remain outside cleanup.

All clients should update before cleanup. Earlier encrypted clients reject the new logical file paths and stop sync rather than silently ignoring deletion records. Text checkpoints and the encryption header are never deleted by cleanup.

### Encryption format

`crypto/vault.ts` contains the versioned format. Argon2id v1.3 (`hash-wasm`) uses a random 16-byte salt, 64 MiB of memory, three iterations, one lane, and a 32-byte output. Version 1 fixes these parameters so untrusted metadata cannot request unbounded KDF work. See the [library documentation](https://github.com/Daninet/hash-wasm) and [Argon2 specification](https://www.rfc-editor.org/rfc/rfc9106).

The password-derived AES key encrypts a random 32-byte journal key. All AES-GCM operations use fresh random 12-byte IVs and 128-bit authentication tags. Additional authenticated data binds the format version, vault ID, and purpose. Key wrapping also binds the salt; content encryption binds the full opaque cloud path. Each binary envelope is `IV || ciphertext || tag`.

Filenames are AES-GCM-encrypted logical paths encoded in lowercase hex, so Dropbox's lowercased listing preserves them. Their authentication context differs from file contents. Listing decrypts names without downloading every photo. Concurrent copies of an immutable photo use the first opaque path in sorted order; per-instance day writer IDs prevent document collisions. No manifest is rewritten on each edit.

The public `vault.json` contains `{ version, id, salt, wrappedKey }`. Atomic create-if-absent ensures simultaneous setup cannot replace another device's key. A lost response is retried against the existing header. Missing/damaged headers, wrong passwords, and authentication failures stop sync; they never trigger plaintext fallback. Keep the header with the ciphertext: neither is usable alone.

The unwrapped key is non-exportable in Web Crypto. Optional remember-on-device stores that CryptoKey by IndexedDB structured cloning, bound to the exact vault descriptor; it never stores the password. Dropbox credentials, preferences, and keys are excluded from ZIP backups. Permanent photo deletion metadata is included explicitly. Local data remains plaintext. This implementation has automated regression coverage, not an independent cryptographic security audit. It trusts the served JavaScript and does not prevent cloud deletion or replay of old valid ciphertext.

### Photos and backups

Photos are resized to at most 2400 pixels on the longest side, converted to JPEG at quality 0.85, and given unique filenames. Camera originals are not retained. Markdown stores relative `photos/…` links, never temporary browser blob URLs. Photos are uploaded before documents that reference them.

A downloaded backup ZIP contains:

- `journal.md`: your entire journal as ordinary Markdown.
- `photos/`: portable JPEG attachments referenced by the current Markdown.
- `minijour/`: `format.json` with `{ version: 1 }`, Automerge documents for restoring text history and future merging, and optional `photo-deletions.json` for permanent photo deletion records.

The format marker makes a new journal with no saved dates a valid empty backup. It creates no day on restore and does not clear existing entries. Older backups without a marker remain supported when they contain editing-history files. Unsupported format versions are rejected before importing anything. Unsaved UI drafts are never exported.

Export snapshots the current text, so unused photos and images mentioned only in earlier history are omitted. Export itself never deletes anything. Restore validates all metadata before importing, applies deletion records first, then photos and text. Old ZIPs without deletion metadata still work. A known deletion blocks an old photo from being saved, even when restoring a previous backup.

Restore combines with the current journal. It never replaces the journal wholesale. Treat the ZIP as private: it contains journal content and editing history. Restore currently accepts up to 250 MB compressed / 500 MB expanded.

An exported `journal.md` can be read in Obsidian. **Editing that exported file does not sync those edits back into minijour.** Automerge's binary documents are the editable source of truth.

## Checks

GitHub Actions runs unit tests and production browser tests on pull requests and pushes to `main`. Its two configurations cover a local-only build at the root and a cloud-enabled build at `/minijour/`. The latter runs the Dropbox integration tests; the former checks that no cloud connection buttons or requests appear, including with credentials saved by an older build. You can reproduce the latter with:

```sh
MINIJOUR_TEST_SUBDIRECTORY=1 VITE_DROPBOX_APP_KEY=testpublickey npm run test:browser
```

The key above is synthetic and browser tests mock Dropbox. Browser tests read the same `.env` and `.env.production` settings as the production build; explicit environment variables override them, including an empty key for local-only testing. The build includes version/source metadata and license notices. `scripts/build-info.mjs` supports Git checkouts and downloaded source archives; `scripts/notices.mjs` collects runtime dependency licenses from the lockfile's installed packages.

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Unit tests cover provider configuration and callback routing, provider/app/account binding, legacy connection adoption, encryption round trips, authentication failures, concurrent vault setup, remembered keys, legacy import, and independent day creation, text convergence, concurrent local saves, cursor anchors with emoji, offline sync, failed uploads, photo transfer, permanent cleanup, stale-device deletion, and backup restore. Browser tests exercise the production build: focus and persistence, photo insertion, offline reloads, midnight rollover, multiple tabs, restore, and Dropbox authorization/sync across two simulated devices.

Dropbox browser tests mock the network boundary. A real Dropbox app/account and the actual mobile camera/keyboard still need a device smoke test before relying on the app for irreplaceable entries.

The checked-in app icons can be regenerated with `node scripts/generate-icons.mjs` after installing Playwright's Chromium.

## Compatibility

The first cloud connection binds the local journal to its provider, application, and account. That binding survives disconnect. Ownership and the new connection are checked/stored atomically, including legacy connections from earlier builds. The generic binding uses `cloud-journal-owner`; existing Dropbox connection/owner keys remain readable and are preserved for older open clients. No database schema upgrade or token move is needed. Disconnect removes the connection and remembered vault key in one transaction. Remembering a key also checks the connection in the same transaction, so an unlock finishing in another tab cannot restore a key after disconnect. This blocks accidental cross-account uploads without deleting or automatically moving user data. Separate accounts use separate browser profiles.

The app version, IndexedDB schema, Dropbox layout, and backup format are separate concerns. Do not rename the database, channel, or cloud root for routine releases. Older installed PWAs may keep running after deployment: test compatibility and migrations before changing persisted data.

## Contribute

Keep changes focused on writing, photos, reliability, and portability. Explain the user-visible behavior in a pull request and include relevant validation. Add regression tests for data-loss or sync bugs. Contributions use GPL-3.0-only; dependencies retain their own licenses.

Use synthetic content in tests and screenshots. Do not post real journal entries, photos, tokens, browser profiles, environment files, or backups in public reports. The Dropbox app key is public configuration; access tokens, refresh tokens, and app secrets are not.
