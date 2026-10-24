# Changelog

Changes for users and deployment operators. Versions follow [Semantic Versioning](https://semver.org/); see the [release policy](docs/releasing.md).

## Unreleased

### Added

- An offline-capable Markdown journal with automatic daily sections and photos at the cursor.
- Local persistence, Automerge merging, and optional personal Dropbox sync.
- Portable Markdown/photo backups with lossless restore of editing history.
- Automated coverage for persistence, offline reloads, date rollover, multi-tab updates, backups, and mocked Dropbox sync.
- User, developer, deployment, and release guides, with GPL-3.0-only licensing.
- A simple Dropbox connection flow on deployments with a configured app key.

### Fixed

- Block connecting a local journal to another Dropbox account or app, including after disconnecting, to prevent accidental cross-account uploads.

No release has been published yet. The first intended version is 0.1.0.
