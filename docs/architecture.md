# Architecture details

[Developer guide](development.md) · [User guide](user-guide.md)

The developer guide introduces the code. This reference explains the behavior and storage rules that changes must preserve.

## The data model

The interface is one continuous page with the newest date first. Internally, **each day is its own Automerge document containing `{ text: string }`**, displayed in a separate editor. Export combines the sections into one `journal.md` with `# YYYY-MM-DD` headings. Day boundaries are managed by the app; a selection or undo history stays within its day's editor.

`hasContent()` treats whitespace-only text as empty. `ui/journal-view.ts` owns local drafts outside `Journal.days`. Opening a date shows its heading immediately; the first edit with content merges its Automerge document into the journal and saves it. Whitespace-only drafts never reach IndexedDB, backups, or sync. Dates cleared by local typing retain their headings for undo. Journal events mark local edits separately from incoming cloud, restore, and cross-tab changes. An incoming empty date clears its local opened/expanded state and removes its heading and sidebar link; if active, the view returns to today. Today keeps its blank writing surface. Midnight removes an abandoned blank daily draft without interrupting another selected date.

The view sorts headings newest first and creates editors only for expanded sections. Only today starts expanded. Opening a date through the sidebar collapses all other sections. All sidebar dates use the same newest-first order. Go to today and Add date buttons stay above the scrolling list; the former computes the current local date when clicked and the latter toggles an inline date picker. Focusing an editor keeps it expanded during incoming changes. Collapse choices last for the current tab session. Existing editors stay mounted when collapsed to preserve undo and composition; older dates never opened need only a heading. Text changes update only the affected editor unless the set of visible dates changes. The date drawer uses a native modal dialog for keyboard focus, Escape, and a small-screen overlay. Navigation expands and focuses an entry; adding an existing date does not duplicate it.

Deleting a date asks for confirmation, then clears its text through `Journal.edit()`. This keeps the Automerge deletion history locally and in cloud checkpoints so unchanged old replicas do not resurrect text. Concurrent new edits can still merge. No day documents or photo blobs are physically removed, and there is no format migration. Deleted dates disappear from the view unless new content arrives; today's blank draft is recreated. Unsaved blank drafts are simply discarded. Markdown export skips empty dates and keeps its existing oldest-first order; ZIP history and cloud sync retain saved clearing history.

Sync still fetches and merges all days and photos. Deferring document sync until navigation would require reliable remote indexing and changes to backup and photo-reference checks. Lazy editor creation reduces browser work without changing the storage contract.

The top bar is sticky. On opening, the editor explicitly scrolls its final position into view. A `ResizeObserver` watches journal height, so photo dimensions arriving after the first layout can repeat that reveal before the image loads. Viewport resizing can also repeat it. The first user interaction stops following the opening position. Browser scroll restoration is disabled on the journal page. After interaction, incoming sync preserves the person's position.

The header uses a storage-status button instead of wrapping status text. `ui/storage-status.ts` chooses one status for both that button and the explanation in cloud settings. Device/cloud checkmarks require durable local data and, for cloud, a successful sync with no pending changes. Unsaved local edits use a plain device, local failures a device warning, and locked/offline/unavailable cloud access a cloud warning. The header retains a screen-reader live status, accessible button description, and tooltip; the visible explanation is in settings.

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

## Cloud file layout

Provider selection and OAuth dispatch live in `sync/providers.ts`. Each adapter opens a `CloudSession` with file storage and a disconnect action. Shared cloud settings add encryption before constructing `SyncEngine`; neither the engine nor encryption imports a provider adapter.

The first connection binds the local journal to a provider, application, and account in `cloud-journal-owner`. Ownership and credentials are checked and stored in one IndexedDB transaction. The binding survives disconnect to prevent uploading the journal to a different account by accident. Disconnect removes credentials and the remembered key together. Remembering a key and saving refreshed credentials also check that the connection still exists, so work completing in another tab cannot undo a disconnect. Separate accounts use separate browser profiles.

The sync engine works with logical paths `/days/YYYY-MM-DD/<writer-id>.automerge`, `/preferences/<writer-id>.automerge`, and `/photos/<photo-id>.<extension>`. `EncryptedFiles` translates these before the provider receives anything (Dropbox stores them under its app folder):

```text
minijour-encrypted-v1/
  vault.json               Public format version, vault ID, salt, wrapped key
  objects/
    <encrypted-name>.bin   Encrypted document, photo, or deletion record
```

A writer ID is unique to each running app instance. It owns one checkpoint per day it changes. Checkpoints contain Automerge history, so other devices can combine them later even when the original writer is offline. One writer never overwrites another's file. A fresh app compares the merged remote heads with its local heads and uploads only days containing additional changes.

The engine lists checkpoints, downloads new revisions, merges them locally, transfers photos, and uploads local changes. Repeated requests are safe because the library recognizes changes it has already seen. Concurrent text merging belongs to Automerge; the engine coordinates file transfer. Remote files are validated before use.

Two small caches belong to each `SyncEngine` instance. The file cache holds downloaded bytes and validated day or preference documents by path and revision. The day cache holds the merged remote document and a sorted signature of its checkpoint paths/revisions. Unchanged checkpoint sets reuse that document without decoding or merging the history again. A changed set rebuilds only its day, reusing the other decoded checkpoints. Removed paths/days leave the caches, and removed checkpoints are excluded from the rebuilt remote state so missing history can be republished from the local journal.

Every round still offers the remote result to `Journal.mergeDoc()`. It skips identical document versions by comparing their heads and retries pending persistence even if a preceding round merged successfully but failed to save. Differing versions go through the normal merge; backend knowledge alone is insufficient because older editor views can share a backend containing newer changes. Cached documents stay separate from editable local documents; uploaded snapshots are captured before the network request so typing during upload cannot change what the cache says is remote. Invalid checkpoint bytes are discarded from the cache for retry. The caches are memory-only and disappear on reload, locking, or disconnecting. No database, cloud, encryption, or backup format changes are needed. Full folder listing, encrypted filename verification, and the first downloads after reopening remain unchanged.

Automatic sync follows a local save batch and rechecks the editing pause before starting cloud work. Cloud requests run independently so a slow upload cannot block later local saves once typing pauses. An already-started request, including merging incoming documents, is allowed to finish if typing resumes. Edits during an upload mark the cloud copy as pending; they do not ask the engine for an immediate extra round. Remaining changes wait for another idle batch. Successful uploads only clear the pending status if no changes arrived during the request. Startup and returning online/visible request an idle batch. While cloud access is unlocked, a 30-second poll requests an idle batch to discover changes from other devices and retry cloud errors. **Uploads cannot be guaranteed while the app is closed or suspended.** Check the saved status before switching devices if you need the latest edit immediately.

We retain checkpoints and small permanent photo deletion records. Photo files are retained until explicit user-confirmed cleanup. Storage grows with editing history and app sessions; old snapshots aren't automatically deleted. A fresh device initially downloads the available checkpoints and photos; later polls reuse unchanged decoded checkpoints and remote days in memory. These are deliberate simplicity tradeoffs, and the first areas to revisit for very large journals.

## Permanent photo cleanup

`domain/photos.ts` defines supported extensions and MIME types for storage, encrypted paths, sync, backups, previews, and cleanup. It scans for `photos/<UUID>.<extension>` paths conservatively, including Markdown reference links and code examples. It checks current text across all days, not just the visible editor. `storage/photo-cleanup.ts` produces a review snapshot of specific IDs and sizes. Only those IDs may be deleted when confirmed; newly unused photos need a new review.

For cloud-bound journals, the UI requires an online, unlocked, successful sync before review and again before deletion. A failed fetch prevents local cleanup. Local removal rechecks references inside an IndexedDB read/write transaction across `days`, `photos`, and `settings`, so saved references from other tabs are respected. Ordinary Markdown deletion never triggers this operation.

The same transaction records permanent deletions in the settings key `photo-deletions-v1` and removes the blobs. The value is a grow-only set represented as a sorted array of photo names. This needs no database schema upgrade. Photo saves check that set transactionally, including downloads and backup restore. Preview blob URLs are revoked and rebuilt across tabs after changes.

Sync uses an immutable logical file `/deleted-photos/<photo-id>.<extension>.json` for each permanent deletion, containing `{ version: 1, photos: [name] }`. Encryption hides its name and contents like other files. Records are processed before any photo transfer, and a new record must upload successfully before remote bytes are removed. Dropbox removal uses the idempotent adapter contract (`files/delete_v2`; missing files count as success). The encrypted adapter removes every opaque copy of a photo, including concurrent duplicate uploads. A stale upload arriving later is removed on a subsequent sync.

Deletion wins even if an offline device or old backup later adds a reference. This explicit tradeoff avoids attachment conflict resolution or device clocks. Missing links remain editable; re-adding the original photo produces a fresh ID. Deletion records are retained permanently and restored from new backups. Existing downloaded backups and provider version history remain outside cleanup.

Text checkpoints and the encryption header are never deleted by photo cleanup.

## Encryption format

`crypto/vault.ts` contains the versioned format. Argon2id v1.3 (`hash-wasm`) uses a random 16-byte salt, 64 MiB of memory, three iterations, one lane, and a 32-byte output. Version 1 fixes these parameters so untrusted metadata cannot request unbounded KDF work. See the [library documentation](https://github.com/Daninet/hash-wasm) and [Argon2 specification](https://www.rfc-editor.org/rfc/rfc9106).

The password-derived AES key encrypts a random 32-byte journal key. All AES-GCM operations use fresh random 12-byte IVs and 128-bit authentication tags. Additional authenticated data binds the format version, vault ID, and purpose. Key wrapping also binds the salt; content encryption binds the full opaque cloud path. Each binary envelope is `IV || ciphertext || tag`.

Filenames are AES-GCM-encrypted logical paths encoded in lowercase hex, so Dropbox's lowercased listing preserves them. Their authentication context differs from file contents. Listing decrypts names without downloading every photo. Concurrent copies of an immutable photo use the first opaque path in sorted order; per-instance day writer IDs prevent document collisions. No manifest is rewritten on each edit.

The public `vault.json` contains `{ version, id, salt, wrappedKey }`. Atomic create-if-absent ensures simultaneous setup cannot replace another device's key. A lost response is retried against the existing header. Missing/damaged headers, wrong passwords, and authentication failures stop sync; they never trigger plaintext fallback. Keep the header with the ciphertext: neither is usable alone.

The unwrapped key is non-exportable in Web Crypto. Optional remember-on-device stores that CryptoKey by IndexedDB structured cloning, bound to the exact vault descriptor; it never stores the password. Dropbox credentials, device-only preferences, and keys are excluded from ZIP backups. Journal photo preferences and permanent photo deletion metadata are included explicitly. Local data remains plaintext. This implementation has automated regression coverage, not an independent cryptographic security audit. It trusts the served JavaScript and does not prevent cloud deletion or replay of old valid ciphertext.

## Photos and backups

`domain/preferences.ts` defines `{ photoOptions?: { optimize, maxDimension } }` as a separate Automerge document. An absent choice displays optimization enabled at 2400 pixels, without creating a saved default. The allowed longest side is an integer from 1 to 12000. Each explicit change replaces the whole flag-and-dimension pair: Automerge resolves concurrent choices as one complete value. No device clocks or custom conflict resolution are involved.

`Journal` saves explicit preference changes immediately through an IndexedDB read/write transaction under `journal-preferences`. The transaction merges with existing history, including another tab's saves. Memory and the controls adopt a choice only after successful persistence. BroadcastChannel and journal preference events refresh other tabs and schedule normal cloud sync; an unfinished numeric field keeps its draft until blur. Opening settings and inserting a photo also read the latest persisted preference. An existing choice from the former `photo-options` key is carried over once, then the old key is removed. If that conversion cannot save, the already-durable old choice remains active and the journal stays open for writing and export, with a storage error shown.

Cloud sync pulls preference checkpoints before days and photos. Each writer uses its own encrypted checkpoint, as with day documents. A fresh device's empty document cannot overwrite a stored choice; offline changes merge on reconnection. Preferences are included in backups as `minijour/preferences.automerge`, and restore merges their history. A backup without preferences leaves the current choice alone. All preference metadata is validated before importing any backup data. Device-only banner dismissal, storage permissions, credentials, and encryption keys are not part of this document.

`ui/photo-settings.ts` states whether the settings are saved locally or sync through connected cloud storage. They affect new photos and never rewrite existing images.

With optimization enabled, `preparePhoto()` resizes without enlarging, flattens transparency onto white, and encodes JPEG at quality 0.85. With optimization disabled it returns the selected file unchanged, retaining metadata and animation. Supported original formats are JPEG, PNG, WebP, GIF, AVIF, HEIC, HEIF, TIFF, and BMP, up to 30 MB. MIME types or known filename extensions select a canonical extension; SVG and other file formats are rejected. No extra original copy is kept when optimizing. Markdown stores relative `photos/<UUID>.<extension>` links, never temporary browser blob URLs. Photos are uploaded before documents that reference them. Sync and restore derive the MIME type from the extension without re-encoding the bytes.

`ui/photo-previews.ts` supplies block decorations directly through a CodeMirror state field. Photos change vertical layout, so their decorations cover the whole day's text and are not rebuilt from the changing visible range. CodeMirror still controls which blocks have DOM nodes. Preview dimensions are read from the stored image and held in memory with its object URL. An aspect-ratio frame reserves the display area independently of the image element's loading state. Blocks use padding rather than vertical margins and request a layout measurement after asynchronous changes, following the [CodeMirror decoration contract](https://codemirror.net/docs/ref/#view.Decoration^widget). Originals the browser cannot decode get a download link; missing or permanently deleted images keep their text fallback. Date divider spacing uses the same rule for expanded and collapsed sections.

A downloaded backup ZIP contains:

- `journal.md`: your entire journal as ordinary Markdown.
- `photos/`: attachments referenced by the current Markdown, with their stored bytes and formats.
- `minijour/`: `format.json` with `{ version: 1 }`, Automerge documents for restoring text history and future merging, optional `preferences.automerge` for photo preferences, and optional `photo-deletions.json` for permanent photo deletion records.

The format marker makes a new journal with no saved dates a valid empty backup. It creates no day on restore and does not clear existing entries. Older backups without a marker remain supported when they contain editing-history files. Unsupported format versions are rejected before importing anything. Unsaved UI drafts are never exported.

Export snapshots the current text, so unused photos and images mentioned only in earlier history are omitted. Export itself never deletes anything. Restore validates all metadata before importing, applies deletion records first, then photos and text. Old ZIPs without deletion metadata still work. A known deletion blocks an old photo from being saved, even when restoring a previous backup.

Restore combines with the current journal. It never replaces the journal wholesale. Treat the ZIP as private: it contains journal content and editing history. Restore currently accepts up to 250 MB compressed / 500 MB expanded.

An exported `journal.md` can be read in Obsidian. **Editing that exported file does not sync those edits back into minijour.** Automerge's binary documents are the editable source of truth.

## Artwork

The book mark in `ui/logo.svg`, shared by `ui/icons.ts` and both favicons, was introduced as inline SVG in the [initial implementation](https://github.com/folinimarc/minijour/commit/ebb94a1e35e615696412f5a017ba0d325c86f24e), originally in `ui/shell.ts`. It was created during the assistant-assisted implementation; no third-party source or icon package was recorded. The wordmark uses the device's system font. Both pages share the SVG helper and wordmark styles in `base.css`.

A provenance check on 2026-10-25 searched distinctive SVG path fragments and compared the official [Feather book](https://github.com/feathericons/feather/blob/main/icons/book.svg), [Lucide book](https://github.com/lucide-icons/lucide/blob/main/icons/book.svg) and [notebook](https://github.com/lucide-icons/lucide/blob/main/icons/notebook.svg), and [Tabler book-2](https://github.com/tabler/tabler-icons/blob/main/icons/outline/book-2.svg). None matched this path. This supports treating it as project artwork under the repository's [GPL-3.0-only license](../LICENSE); it does not establish uniqueness or trademark clearance. No separate third-party logo attribution was identified.
