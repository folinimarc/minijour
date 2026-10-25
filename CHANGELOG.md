# Changelog

Changes for users and deployment operators. Versions follow [Semantic Versioning](https://semver.org/); see the [release policy](docs/releasing.md).

## Unreleased

### Added

- A collapsed date picker in settings for writing on any past or future date, with entries kept in chronological order.
- Device storage protection status, one-time advice when protection is unavailable, and an explicit request button in settings.

### Changed

- Shorten the landing page, simplify its storage summary, and remove promotional taglines.
- Keep the journal header visible while scrolling and open at the end of today's entry.
- Ignore unwritten dates: drafts have no date heading and are not saved, synced, or exported until text or a photo is added. Cleared entries retain internal history for safe merging, without appearing as empty journal entries.
- Support exporting and restoring journals with no saved entries, while retaining compatibility with older backups.

## 0.1.0 - 2026-10-25

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
