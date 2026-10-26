# Changelog

Changes for users and deployment operators. Versions follow [Semantic Versioning](https://semver.org/); see the [release policy](docs/releasing.md).

## Unreleased

### Changed

- Batch local saves and encrypted cloud sync after 1.5 seconds without editing. A 10-second check saves pending work during continuous typing when no save occurred in the preceding interval.
- Avoid serializing the full day on each keystroke. Edits made during a save remain pending for a later batch, and slow cloud requests do not block local saves or trigger immediate extra sync rounds.
- Show when edits are waiting to save; explicit sync and backgrounding attempt to save pending edits immediately.

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
