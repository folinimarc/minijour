# minijour

A small journal: open it, write Markdown, add a photo. Each new day appears below the last. No save button, feeds, folders, or formatting toolbar.

minijour is a **static, offline-capable PWA**. It saves on your device first. Optional Dropbox sync lets you keep writing on another device, with [Automerge](https://automerge.org/) combining edits. There is no application server, database service, or minijour account.

## Run it

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

## Use it

- Open the app. Today's local date is prepared and the editor is focused at the end.
- Type Markdown. Changes save automatically in IndexedDB, a database inside your browser.
- Choose **Add photo**, then **Take a photo** or **Choose from device**. The image is inserted at the remembered cursor position. Photos have inline previews; their Markdown links remain editable.
- Use the **…** button for Dropbox, backup download/restore, and installation information.
- On a Pixel, visit the HTTPS site in Chrome and choose **Add to home screen → Install**. Open it online once and let installation finish before relying on offline access.

Browsers control whether focusing an editor automatically raises the phone keyboard. The app focuses it immediately, but actual keyboard behavior should be checked on your Pixel.

Dates follow the device's timezone. A new section is added at midnight or when you return after a date change. Date headings are managed by the app; the text within each day is ordinary Markdown.

## Connect Dropbox

1. Create an app in the [Dropbox App Console](https://www.dropbox.com/developers/apps).
2. Choose **Scoped access** and **App folder**. This confines minijour to its own folder instead of your whole Dropbox.
3. Enable and submit these permissions:
   - `files.metadata.read`
   - `files.content.read`
   - `files.content.write`
4. In minijour's settings, copy the **OAuth redirect URI** and add that exact address in the Dropbox app's OAuth settings. Local development and production addresses need separate entries. Dropbox allows HTTP for `localhost`; use `http://localhost:5173/` for local OAuth testing, rather than a LAN IP.
5. Enter the Dropbox **app key** and choose **Connect Dropbox**. The app uses OAuth authorization code flow with PKCE; it never needs an app secret.
6. On another device, open the **same site**, enter the **same app key**, and authorize the **same Dropbox account**. Its entries will combine with the journal in that app folder.

For a deployment where everyone uses one Dropbox app, copy `.env.example` to `.env` and set `VITE_DROPBOX_APP_KEY` before building. An app key is public configuration, not a secret. Never put a Dropbox app secret or access token in a `VITE_` variable. Development Dropbox apps can have account restrictions; broader distribution may require Dropbox production approval.

Authorization uses a random state parameter and SHA-256 PKCE challenge. The verifier is kept temporarily in the initiating tab's session storage. Access and refresh tokens stay in IndexedDB on that device and are excluded from exports. The app refreshes expiring access tokens automatically. Disconnecting removes this device's stored connection; it preserves journal data and remote files. You can revoke the app's authorization in your Dropbox account settings.

Dropbox is a central storage service when connected. **No server operated by minijour is required.** Files have Dropbox account protection; minijour does not add end-to-end encryption.

## How the project fits together

This project intentionally uses TypeScript and normal DOM elements instead of a UI framework. There is one small abstraction for remote files and no generic plugin or service-container system.

```text
src/
  main.ts             Wires the application together and handles user actions
  domain/
    day.ts            Date helpers and Automerge document operations
    journal.ts        In-memory journal, durable saves, change notifications
  storage/
    local.ts          IndexedDB access, including safe saves from multiple tabs
    backup.ts         Portable ZIP export and lossless backup restore
  sync/
    cloud.ts          The three operations a cloud backend needs to provide
    dropbox.ts        Dropbox OAuth and API requests
    engine.ts         Pull, Automerge merge, and push
  ui/
    shell.ts          Static application markup and element references
    editor.ts         CodeMirror editor and photo previews
    photos.ts         Image resizing and local display URLs
  style.css           The interface's visual styles
```

If you're learning, follow this path:

1. Read `domain/day.ts` and its tests to see how two documents merge.
2. Read `storage/local.ts` to see how data survives closing the page.
3. Follow a keystroke from `ui/editor.ts` through `main.ts` to `Journal.merge()`.
4. Read `sync/cloud.ts`, then `sync/engine.ts`. The engine doesn't know about HTTP or OAuth.
5. Read `sync/dropbox.ts` to see how those three operations map to an external service.

### The data model

The interface is one continuous chronological page. Internally, **each day is its own Automerge document containing `{ text: string }`**, displayed in a separate editor. Export combines the sections into one `journal.md` with `# YYYY-MM-DD` headings. Day boundaries are managed by the app; a selection or undo history stays within its day's editor.

Per-day documents keep transfers smaller and make a date heading unique without trying to merge independently inserted headings in freeform text. Devices construct the same immutable creation change for a given date, then switch to fresh actor IDs for actual edits. This shared starting point matters: independently creating two nested text objects would cause property conflicts rather than collaborative text edits. The fixed creation actor must never be used for subsequent typing.

On each editor update, `Automerge.updateText()` records text operations. Incoming copies are combined with `Automerge.merge()`. The editor keeps the document version actually visible during keyboard composition, so incoming sync cannot turn an unfinished Android input into an accidental deletion of remote text.

IndexedDB saves merge inside a read/write transaction. That protects against two tabs writing stale copies. A BroadcastChannel updates other open tabs after a successful save.

### Dropbox file layout

Inside the Dropbox app folder:

```text
minijour-v1/
  days/
    2026-10-24/
      <writer-id>.automerge
      <another-writer-id>.automerge
  photos/
    <photo-id>.jpg
```

A writer ID is unique to each running app instance. It owns one checkpoint per day it changes. Checkpoints contain Automerge history, so other devices can combine them later even when the original writer is offline. One writer never overwrites another's file. A fresh app compares the merged remote heads with its local heads and uploads only days containing additional changes.

The engine lists checkpoints, downloads new revisions, merges them locally, transfers photos, and uploads local changes. Repeated requests are safe because the library recognizes changes it has already seen. Concurrent text merging belongs to Automerge; the engine coordinates file transfer. Remote files are validated before use.

Sync runs after edits settle, on opening/returning online, and every 30 seconds while visible. If edits arrive during a sync, another round follows. **It cannot guarantee uploads while the app is closed or suspended.** Check the saved status before switching devices if you need the latest edit immediately.

We retain checkpoints and photos rather than implementing destructive remote garbage collection. Storage grows with editing history and app sessions; old snapshots aren't automatically deleted. A fresh device initially downloads the available checkpoints and photos; later polls cache unchanged checkpoint revisions in memory. These are deliberate simplicity tradeoffs, and the first areas to revisit for very large journals.

### Photos and backups

Photos are resized to at most 2400 pixels on the longest side, converted to JPEG at quality 0.85, and given unique filenames. Camera originals are not retained. Markdown stores relative `photos/…` links, never temporary browser blob URLs. Photos are uploaded before documents that reference them.

A downloaded backup ZIP contains:

- `journal.md`: your entire journal as ordinary Markdown.
- `photos/`: portable JPEG attachments.
- `minijour/`: Automerge documents for restoring history and future merging.

Restore combines with the current journal. It never replaces the journal wholesale. Treat the ZIP as private: it contains journal content and editing history. Restore currently accepts up to 250 MB compressed / 500 MB expanded.

An exported `journal.md` can be read in Obsidian. **Editing that exported file does not sync those edits back into minijour.** Automerge's binary documents are the editable source of truth.

## Deploy as a static website

```sh
npm ci
npm run build
```

Publish the contents of `dist/` on any HTTPS static host. Keep a stable origin and path: browser storage belongs to that origin, and Dropbox's redirect URI must match exactly. The Vite build uses relative asset paths so hosting in a subdirectory works too.

The manifest, icons, service worker, JavaScript, CSS, and Automerge WASM are built and cached together. Dropbox requests and journal data are not stored in the service worker cache. Updates wait for you to choose reload; an open editor is never automatically replaced.

You do not need a minijour backend, cloud function, or server-side environment variable. Use HTTPS on a real device; `http://<your-computer-ip>` does not provide the secure browser context needed for PWA installation and other APIs.

## Checks

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Unit tests cover independent day creation, text convergence, concurrent local saves, cursor anchors with emoji, offline sync, failed uploads, photo transfer, and backup restore. Browser tests exercise the production build: focus and persistence, photo insertion, offline reloads, midnight rollover, multiple tabs, restore, and Dropbox authorization/sync across two simulated devices.

Dropbox browser tests mock the network boundary. A real Dropbox app/account and the actual Pixel camera/keyboard still need a device smoke test before relying on the app for irreplaceable entries.

The checked-in app icons can be regenerated with `node scripts/generate-icons.mjs` after installing Playwright's Chromium.

## Practical limits

Automerge guarantees convergence when replicas receive the same changes; it cannot interpret intent when two devices rewrite the same sentence. You may occasionally want to tidy up a merged paragraph.

Without Dropbox or an exported backup, device loss or clearing browser data loses the journal. The app requests persistent browser storage after your first edit, but permission can be denied. Local save failures are shown explicitly and pending edits stay in memory; download a backup before closing in that case.

No analytics, third-party fonts, advertising, or external image requests are included.
