# User guide

[Back to the README](../README.md)

## Write

Open minijour. Today's local date is prepared, with the cursor at the end. Type Markdown; changes save automatically. Dates follow your device's timezone. A new section appears at midnight or when you return after the date changes.

Choose **Add photo**, then **Take a photo** or **Choose from device**. The image is inserted at the remembered cursor position. Photos have inline previews; their Markdown links remain editable.

Date headings are managed by the app. Each day has its own editor, so selection and undo history stay within that day. An export joins all days into one Markdown file. Use **…** for Dropbox, backups, and installation information.

## Install

Visit the HTTPS website online once and allow offline installation to complete.

- **Android / Chrome:** open the browser menu and choose **Add to home screen → Install**. You can also use **Install minijour** in settings if offered.
- **iPhone / iPad / Safari:** use the Share menu and **Add to Home Screen**. This platform still needs real-device verification for minijour.
- **Desktop:** use the browser's installation option if available, or bookmark the website.

The app focuses the editor on opening. Browsers control whether that raises the on-screen keyboard; an additional tap may be needed.

## Connect your Dropbox

On a configured deployment, choose **Connect Dropbox**, sign in to your own Dropbox account, and authorize minijour. You do not need a Dropbox developer account. On another device, visit the same site and connect the same Dropbox account.

If you see app-key setup fields, the deployment has not configured its Dropbox integration. Its operator can follow the [deployment guide](deployment.md#configure-dropbox). Developer configuration is separate from signing into personal Dropbox storage.

The first connection combines local entries with the journal in your Dropbox app folder. Sync runs after edits settle, when opening/returning online, and every 30 seconds while visible. Check the saved status before switching devices if you need your latest edit immediately. Uploads cannot be guaranteed while the app is closed or suspended.

Disconnecting preserves local and remote entries. The journal remains bound to that Dropbox account and application; reconnecting a different account is blocked before any journal data transfers. Use separate browser profiles for separate accounts.

## Storage and privacy

- **On the device:** IndexedDB holds text, photos, settings, and the Dropbox connection. Browser profiles have separate local storage.
- **In Dropbox, when connected:** Automerge documents and photos live in your own app folder. Other users have independent folders in their accounts.
- **On the website host:** the host serves application files. The app does not upload journals or Dropbox tokens to a minijour server. Hosting providers may keep normal access logs. The browser communicates directly with Dropbox.

There is no analytics, advertising, external font loading, or additional end-to-end encryption. You trust the code served by the website you use. Tokens stay on the device and are excluded from backups. You can revoke authorization in your Dropbox account settings.

Without Dropbox or an exported backup, clearing browser data or losing the device loses the journal. The app requests persistent storage after your first edit, but permission can be denied. If a local save fails, pending edits remain in memory: download a backup before closing.

## Back up and restore

Choose **Download backup** to save a ZIP containing:

- `journal.md`: all dates and text as ordinary Markdown.
- `photos/`: JPEG attachments referenced by the Markdown.
- `minijour/`: Automerge documents retaining history for lossless restore and future merging.

Choose **Restore backup** and select the entire ZIP. Restore combines entries with the current journal instead of replacing it. Backups contain private content and history. Restore accepts up to 250 MB compressed / 500 MB expanded.

Photos are resized to at most 2400 pixels on the longest side and converted to JPEG; camera originals are not retained. Exports can be read in other Markdown editors, but edits to the exported file do not sync back to minijour.

## Browser support

Automated tests exercise the production build in Chromium, including a mobile viewport. They cover editing, photos, offline reloads, date rollover, multiple tabs, keyboard-composition events, backups, and mocked Dropbox authorization/sync.

Real camera/keyboard behavior, installed-PWA authorization, and live Dropbox accounts still need device testing. Safari/iOS and Firefox are not currently in automated coverage. Installation instructions do not imply every browser has been verified.

Automerge makes replicas converge, but two devices rewriting the same sentence can produce wording you want to tidy up. Checkpoints and photos are retained, so remote storage grows. A new device initially downloads available checkpoints and photos.
