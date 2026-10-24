# Release guide

[Back to the README](../README.md)

## Versions and compatibility

Use [Semantic Versioning](https://semver.org/). `package.json` is the application version; Git tags add `v`. The first intended version is `0.1.0`, unreleased until its tag and GitHub Release are published.

During initial development:

- `0.1.1`: compatible fixes.
- `0.2.0`: features or significant changes. Describe incompatibilities and migration paths.
- `1.0.0`: established behavior and compatibility commitments.

After 1.0, use patch releases for compatible fixes, minor releases for compatible features, and major releases for breaking changes. Internal refactoring alone does not require a major release. Choose versions manually and keep release notes useful to users.

Compatibility includes stored journals, Dropbox documents, backups, and older installed PWAs. Even during 0.x, releases must not silently discard existing data. Storage-format versions are separate: routine updates must not rename `minijour-v1`. Test migrations and interoperability before changing schemas.

Keep `"private": true` in `package.json`. It prevents accidental npm publication and does not control GitHub visibility. Distribution is a static site and release archives, not an npm package.

## Prepare a release

1. Review outstanding data-loss risks and the deployment guide's device checks.
2. Start from an up-to-date, clean `main` checkout.
3. Update the package version without making a tag, for example:

   ```sh
   npm version 0.1.1 --no-git-tag-version
   ```

   For the first release, the existing `0.1.0` needs no bump.
4. Move relevant changelog entries to a section formatted exactly `## 0.1.0 - YYYY-MM-DD` (using the chosen version and date), and leave **Unreleased** for subsequent work. Run `npm run release:check -- v0.1.0` to validate it.
5. Run the developer checks. Commit and push the version, lockfile, and changelog together.
6. Create and push an annotated tag for that exact commit:

   ```sh
   git tag -a v0.1.0 -m "Release 0.1.0"
   git push origin v0.1.0
   ```

Use the chosen version consistently. Never move a published tag; correct mistakes with another release.

## Publication

The release workflow validates the tag against the package and changelog, runs tests, and builds the tagged revision once. It packages the static build and corresponding source, publishes a GitHub Release, and deploys that same build to Pages. A push to `main` runs CI without publishing.

Currently publication accepts stable `vMAJOR.MINOR.PATCH` tags; prerelease tags are rejected. Finish one release workflow before pushing the next release tag.

Before the first tag, configure Pages, the deployment base path, and the public Dropbox app key using the deployment guide. Automation uses GitHub's repository token permissions for release assets and Pages; it needs no personal access token or Dropbox secret.

Published assets identify the version and exact source revision. Preserve GPL licensing, dependency notices, and corresponding source alongside the static archive. Never publish local profiles, credentials, journal backups, or test artifacts as release assets.

Assets are `minijour-VERSION-site.zip`, `minijour-VERSION-source.tar.gz`, and `SHA256SUMS`. Source archives include `source-revision.json` so they can be rebuilt without Git metadata. `build.json` and the About section identify the version and source revision. The package command refuses an uncommitted checkout, another tag, or a stale build.

The published site links to source and license notices. Before public deployment, make its source repository/release assets publicly accessible as well. Repository visibility is a manual owner decision; automation never changes it.

Release publication and Pages deployment can fail independently. Inspect the failed workflow step before retrying the same tag and source. Draft assets can be retried; published assets are never overwritten. A retry checks their checksums before reusing them. If checksums differ (for example, because build configuration changed), investigate and publish a new version. Never move a published tag.
