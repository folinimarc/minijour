# User guide

[Back to the README](../README.md)

## Write

Choose **Open journal** from the information page, or open `/journal/` directly. Installed apps launch straight into the journal. Today's local date is prepared, with the cursor at the end. Type Markdown; changes save automatically. Dates follow your device's timezone. A new section appears at midnight or when you return after the date changes.

Choose **Add photo**, then **Take a photo** or **Choose from device**. The image is inserted at the remembered cursor position. Photos have inline previews; their Markdown links remain editable.

Date headings are managed by the app. Each day has its own editor, so selection and undo history stay within that day. An export joins all days into one Markdown file. Use **…** for Dropbox, backups, and installation information.

## Install

Visit the HTTPS website online once and allow offline installation to complete.

- **Android / Chrome:** open the browser menu and choose **Add to home screen → Install**. You can also use **Install minijour** in settings if offered.
- **iPhone / iPad / Safari:** use the Share menu and **Add to Home Screen**. This platform still needs real-device verification for minijour.
- **Desktop:** use the browser's installation option if available, or bookmark the website.

Choose the **minijour** wordmark in the journal to return to the information page.

The app focuses the editor on opening. Browsers control whether that raises the on-screen keyboard; an additional tap may be needed.

## Connect your Dropbox

On a configured deployment, choose **Connect Dropbox**, sign in to your own Dropbox account, and authorize minijour. Choose a cloud password of at least 12 characters, or enter your existing cloud password. You do not need a Dropbox developer account. On another device, visit the same site and connect the same Dropbox account and unlock with the same cloud password.

If settings says **Dropbox sync hasn’t been configured for this website**, its operator needs to enable the integration. You do not need to register a Dropbox app. You can keep writing and downloading backups. The collapsed **Self-hosting and developer setup** section is for people running the website; operators can follow the [deployment guide](deployment.md#configure-dropbox).

Unlocking combines local entries with the journal in your Dropbox app folder. Sync runs after edits settle, when opening/returning online, and every 30 seconds while visible. Check the saved status before switching devices if you need your latest edit immediately. Uploads cannot be guaranteed while the app is closed or suspended.

The password is never sent to Dropbox. There is no password reset: store it safely. A few random words make a useful passphrase. A forgotten password cannot recover the cloud copy; a device with a usable local copy can still export its journal.

**Remember the key on this device** saves a non-exportable encryption key in the browser database. Otherwise, reopening requires the cloud password to resume sync. Writing locally works while cloud access is locked. **Lock cloud** forgets the saved key and stops cloud sync in the current tab; other open tabs retain their own unlocked sessions. **Disconnect** also removes this device's Dropbox connection.

If the app finds files from an older, unencrypted version, settings shows **Import older Dropbox files**. This explicitly copies missing entries and photos into the current journal, then syncs them encrypted. It leaves the older files and Dropbox version history in place. Remove those separately in Dropbox if needed; encryption cannot retroactively protect copies already uploaded.

Disconnecting preserves local and remote entries. The journal remains bound to that Dropbox account and application; reconnecting a different account is blocked before any journal data transfers. Use separate browser profiles for separate accounts.

## Storage and privacy

- **On the device:** IndexedDB holds text, photos, settings, and the Dropbox connection. Browser profiles have separate local storage.
- **In Dropbox, when connected:** Encrypted Automerge documents and photos live in your own app folder. Other users have independent folders in their accounts.
- **On the website host:** the host serves application files. The app does not upload journals or Dropbox tokens to a minijour server. Hosting providers may keep normal access logs. The browser communicates directly with Dropbox.

Cloud files and their names are encrypted before upload with AES-256-GCM. Argon2id derives a wrapping key from the cloud password; that key unlocks a randomly generated journal key. Dropbox can see file sizes and upload times, and can delete or replay older encrypted files. Encryption detects altered ciphertext but cannot guarantee availability or detect every rollback.

The local database and exported backups are **not encrypted by minijour**. A remembered key permits cloud decryption on that browser profile. Use your device lock and protect downloaded backups.

There is no analytics, advertising, or external font loading. You trust the code served by the website you use. Tokens stay on the device and are excluded from backups. You can revoke authorization in your Dropbox account settings.

Without Dropbox or an exported backup, clearing browser data or losing the device loses the journal. The app requests persistent storage after your first edit, but permission can be denied. If a local save fails, pending edits remain in memory: download a backup before closing.

## Clean up unused photos

Removing a photo link from Markdown keeps its file available for undo. Choose **… → Clean up unused photos** to review the number of unused photos and their size. Nothing is removed until you choose **Permanently delete photos**; **Cancel** keeps them.

Cleanup checks references across all days, and rechecks after confirmation. A photo still used anywhere is kept. A journal linked to Dropbox requires an online connection and unlocked access to its original account, including after disconnecting. It syncs before each review and deletion. A journal never linked to Dropbox can be cleaned up offline.

Permanent deletion removes photo files locally and from the current encrypted Dropbox folder. Small encrypted deletion records remain so other devices remove their copies on sync and do not upload them again. Interrupted cloud cleanup retries. Old backups cannot restore a permanently deleted photo into a journal that already knows about its deletion.

**Permanent means undo will not recover the image.** An offline edit, undo, or old backup may bring back a link with a missing image. You can choose the original image again to add it as a new photo. Existing downloaded backups, older unencrypted Dropbox files, and cloud version history are not erased by cleanup.

Update minijour on all devices before using permanent cleanup. Older app versions do not understand the deletion records and will stop cloud sync until updated.

## Back up and restore

Choose **Download backup** to save a ZIP containing:

- `journal.md`: all dates and text as ordinary Markdown.
- `photos/`: JPEG attachments referenced by the Markdown.
- `minijour/`: Automerge text history for restore and future merging, plus permanent photo deletion records when present.

Only photos referenced in the current Markdown are included; exporting does not clean up storage. Images referenced only by older editing history are omitted.

Choose **Restore backup** and select the entire ZIP. Restore combines entries with the current journal instead of replacing it. Permanent photo deletions in backups are kept when restoring. Backups from older versions remain supported. Backups contain private content and history. Restore accepts up to 250 MB compressed / 500 MB expanded.

Photos are resized to at most 2400 pixels on the longest side and converted to JPEG; camera originals are not retained. Exports can be read in other Markdown editors, but edits to the exported file do not sync back to minijour.

## Browser support

Automated tests exercise the production build in Chromium, including a mobile viewport. They cover editing, photos, offline reloads, date rollover, multiple tabs, keyboard-composition events, backups, and mocked Dropbox authorization/sync.

Real camera/keyboard behavior, installed-PWA authorization, and live Dropbox accounts still need device testing. Safari/iOS and Firefox are not currently in automated coverage. Installation instructions do not imply every browser has been verified.

Automerge makes replicas converge, but two devices rewriting the same sentence can produce wording you want to tidy up. Checkpoints and deletion records are retained, so remote storage grows. Photo files remain until explicit cleanup. A new device initially downloads available checkpoints and photos.
