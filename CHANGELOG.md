# Changelog

Changes for users and deployment operators. Versions follow [Semantic Versioning](https://semver.org/); see the [release policy](docs/releasing.md).

## Unreleased

## 0.5.0 - 2026-10-26

### Changed

- Automatically consolidate cloud text and photo preference snapshots after a replacement uploads successfully. Keep editing history, including cleared entries, and leave photo removal under explicit cleanup.
- Forward exact editor insertions and deletions to Automerge instead of comparing the whole day's text after each edit. Keep the existing save and sync timing.

### Fixed

- Refresh the cloud listing once when another device removes a snapshot during download.

## 0.4.1 - 2026-10-26

### Fixed

- Speed up cloud downloads by fetching up to four files at a time. Keep document merges and photo deletions ordered, reuse successful downloads after failures, and show photos that finished downloading even if another request failed.

## 0.4.0 - 2026-10-26

### Changed

- Sync photo optimization preferences with the encrypted journal and include them in backups. Settings explains when these preferences sync across devices.

### Fixed

- Keep the opening cursor visible when photo dimensions arrive after the first editor layout, while preserving deliberate scrolling. Cover delayed decoding and image loading independently in browser tests.

## 0.3.0 - 2026-10-26

### Changed

- Simplify application setup into focused UI modules and add a shorter developer guide with a separate architecture reference.
- Remove the obsolete plaintext-cloud importer, early Dropbox ownership migration, and old root-page OAuth/PWA redirects. Current local journals, connections, encrypted cloud files, and backups keep their formats.
- Add device-local photo preferences: choose the resize limit for optimized JPEGs, or keep original files unchanged. Sync, backups, previews, and cleanup support the original formats.
- Batch local saves and encrypted cloud sync after 1.5 seconds without editing. Failed local saves retry after 10 seconds; new edits use the normal pause again. There is no recurring local-save check.
- Avoid serializing the full day on each keystroke. Edits made during a save remain pending for a later batch, and slow cloud requests do not block local saves or trigger immediate extra sync rounds.
- Show when edits are waiting to save; explicit sync and backgrounding attempt to save pending edits immediately.
- Keep automatic startup, reconnection, and periodic cloud sync behind the same editing pause. Recheck the pause before starting cloud upload if typing resumes during a local save.
- Reuse decoded cloud checkpoints and merged remote days within an open session. Unchanged sync rounds avoid decoding and merging their history again; revised, added, or removed checkpoints refresh the affected day.
- Replace header save/sync text with a compact status button. The matching icon and explanation appear in cloud settings, including locked, offline, unavailable, and unsaved states.

### Fixed

- Report failed installation prompts and failed saves during cloud reconnection through the normal in-app notice.
- Hide today's delete button in the date sidebar, including after midnight rollover.
- Return focus to writing when settings closes without overriding later keyboard navigation.
- Keep photo preview space stable during loading and scrolling by using editor block decorations and frames with the image's aspect ratio.
- Keep spacing around date dividers consistent when sections expand or collapse.

## 0.2.1 - 2026-10-25

### Fixed

- Remove date headings and sidebar links immediately when an entry is deleted on another device, including dates previously opened or collapsed. No reload is needed.
- Preserve local undo, today’s empty draft, and unfinished keyboard input when applying synced deletions.

## 0.2.0 - 2026-10-25

### Added

- A collapsible date sidebar for navigation, opening past or future dates, and deleting entries after confirmation.

### Changed

- Explain local-only storage in a dismissible banner with remembered device-local preference, and simplify settings around connecting your own cloud and installing for offline writing.
- Use the journal logo as the favicon on both pages.
- Use the journal's book logo and wordmark styling on the landing page as well.
- Refocus the landing page on simple, private daily writing, optional use of your own cloud, and installation for offline access. Make the no-sign-up message prominent and remove the sample journal.
- Keep the journal header visible while scrolling and open at the end of today's entry.
- Show entries newest first, with only today expanded on opening and older editors created when needed. Sidebar navigation collapses other entries. Go to today and Add date buttons sit above the date list, which keeps every date in newest-first order.
- Place labeled Dates and Settings buttons together and clarify encrypted cloud storage, device sync, and photo cleanup after entry deletion.
- Show date headings on empty local drafts without saving, syncing, or exporting unwritten entries. Cleared entries retain internal history for safe merging.
- Support exporting and restoring journals with no saved entries, while retaining compatibility with older backups.

## 0.1.0 - 2026-10-24

### Added

- Explicit unused-photo cleanup with size/count review, confirmation, encrypted deletion records, and safe retries across devices.

- A plain-language landing page, a dedicated `/journal/` page, and direct-to-writing PWA launch with offline navigation between both.
- Password-protected Dropbox sync with Argon2id and AES-GCM encryption of text, editing history, photos, and filenames.
- Optional remembered device keys, cloud locking, and explicit import of older unencrypted Dropbox data.

- An offline-capable Markdown journal with automatic daily sections and photos at the cursor.
- Local persistence, Automerge merging, and optional personal Dropbox sync.
- Portable Markdown/photo backups with lossless restore of editing history.
- Automated coverage for persistence, offline reloads, date rollover, multi-tab updates, backups, and mocked Dropbox sync.
- User, developer, deployment, and release guides, with GPL-3.0-only licensing.
- A provider registry and shared cloud connection controls. Only providers configured by the website operator appear; Dropbox is the first supported provider.
- CI for local-only and cloud-enabled subdirectory builds, plus tag-based release and GitHub Pages deployment workflows.
- Version/source details and GPL/dependency notices in the app and static build.
- Reproducible site/source archives with checksums and validation against the release tag and changelog.

### Changed

- New ZIP backups include only photos referenced in current Markdown and preserve permanent photo deletion records. Older backups remain readable.

### Fixed

- Prevent an older queued keyboard-composition update from hiding a newer incoming edit.
- Keep browser test selection and deployment paths consistent with local `.env` configuration and explicit CI overrides.

- Keep cloud provider configuration in deployment documentation and remove developer setup fields from the frontend.

- Block connecting a local journal to another cloud provider, account, or app, including after disconnecting, to prevent accidental cross-account uploads.
- Prevent a pending unlock in another tab from restoring a remembered encryption key after Dropbox disconnects.
