# Changelog

Changes for users and deployment operators. Versions follow [Semantic Versioning](https://semver.org/); see the [release policy](docs/releasing.md).

## Unreleased

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

- Keep cloud provider configuration in deployment documentation and remove developer setup fields from the frontend.

- Block connecting a local journal to another cloud provider, account, or app, including after disconnecting, to prevent accidental cross-account uploads.
- Prevent a pending unlock in another tab from restoring a remembered encryption key after Dropbox disconnects.

No release has been published yet. The first intended version is 0.1.0.
