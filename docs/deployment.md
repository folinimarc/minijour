# Deployment guide

[Back to the README](../README.md)

minijour builds into static HTML, CSS, JavaScript, icons, and WebAssembly. It needs HTTPS and no application server. Every user connects their own Dropbox account; the app key identifies the application, not a shared storage account.

## Configure Dropbox

Register one app in the [Dropbox App Console](https://www.dropbox.com/developers/apps):

1. Choose **Scoped access** and **App folder**.
2. Enable and submit `files.metadata.read`, `files.content.read`, and `files.content.write`.
3. Register the exact production OAuth redirect URI, including the journal path and trailing slash: `https://your-host/journal/`, or `https://folinimarc.github.io/minijour/journal/` on project Pages. Add a localhost URI separately for development.
4. Copy `.env.example` to `.env` and set `VITE_DROPBOX_APP_KEY` before building, or supply that environment variable in CI.
5. Enable additional users for testing, and follow Dropbox's production-approval process before wider distribution.

The app key is public and included in the browser build. Never put an app secret, access token, or refresh token in a `VITE_` variable. Authorization uses code flow with SHA-256 PKCE and state validation. Tokens stay on the authorizing device and refresh automatically.

With a configured key, visitors choose **Connect Dropbox**, then create or enter their cloud password. Builds without a key expose manual configuration for self-hosting and development. Use the same app key and Dropbox account on devices that should share a journal.

Dropbox permits HTTP OAuth redirects for `localhost`, for example `http://localhost:5173/journal/`. Use HTTPS on actual devices: HTTP LAN addresses do not provide the secure context required by installation and other browser APIs.

## Build for a static host

```sh
npm ci
npm run build
```

The default deployment path is `/`. For a subdirectory, set `VITE_BASE_PATH` in `.env` or the build environment before building:

```sh
VITE_BASE_PATH=/minijour/ npm run build
```

Use a leading and trailing slash. This controls asset URLs and the PWA identity; keep it stable after installation. The build emits a landing `index.html` and an actual `journal/index.html`, so the host needs no single-page-app rewrites. The manifest starts at `journal/` and covers both pages. A visit to either page caches both for offline use. Visiting the landing page does not open the local journal database.

Publish `dist/`. Keep a stable origin and path: browser storage belongs to the origin and Dropbox checks redirect URIs exactly. Build with the final hosting path; changing it requires rebuilding. Keep license notices and corresponding source available when distributing builds; see the [release guide](releasing.md).

Encrypted sync is browser-to-Dropbox; the website host does not hold passwords or journal keys. Keep deployments trustworthy: anyone controlling the served JavaScript could read unlocked data. Update all devices together when moving from the legacy plaintext cloud format; old builds keep writing to the old folder.

The service worker caches app assets including Automerge's WebAssembly, not Dropbox requests or journal data. Updates wait for the user to choose reload after pending local edits save.

## GitHub Pages

The default project URL is `https://folinimarc.github.io/minijour/`; it is not necessarily deployed yet. Register `https://folinimarc.github.io/minijour/journal/` as the Dropbox redirect URI.

1. Choose **Settings → Pages → Source → GitHub Actions**.
2. Add public repository variable `VITE_DROPBOX_APP_KEY` under **Settings → Secrets and variables → Actions → Variables**.
3. The release workflow sets `VITE_BASE_PATH` to `/<repository-name>/`. For a custom domain root, set the repository variable `VITE_BASE_PATH` to `/`.
4. Allow the `github-pages` environment to deploy the intended release tags.
5. Follow the [release procedure](releasing.md). The public site is deployed from release tags rather than each development commit.

Pages supports public repositories on GitHub Free. Private source repositories require an eligible paid plan; they can publish a public website. Journal data still stays on users' devices and their Dropbox accounts.

When upgrading older deployments, add the new `/journal/` redirect URI before deploying. Keep the old root redirect URI registered until in-flight sign-ins from old app versions are finished. Root callbacks are forwarded to the journal while preserving the original OAuth attempt. Existing browser data stays in the same IndexedDB database. The manifest ID matches the former root launch URL; older installed apps that still launch there are forwarded directly to writing. The journal's wordmark opens the information page deliberately.

For a custom domain, configure Pages and update Dropbox's redirect URI, then test installation at the final address.

## Verify before inviting users

Automated tests mock Dropbox. Verify these steps with real accounts and devices:

- Authorize Dropbox in a browser and installed PWA.
- Write offline, reconnect, and retrieve the text on another device.
- Capture and choose a photo, then verify cross-device download.
- Export and restore a backup in a separate browser profile.
- Update all devices before using permanent photo cleanup. Test review/cancel, deletion sync, and reconnecting an offline device; older clients stop syncing when they encounter deletion records.
- Install, reload offline, and update at the actual hosted subdirectory URL.
- Check the on-screen keyboard and record browsers/devices tested.

Review repository history and public documentation before changing visibility. Release automation does not change repository visibility or configure your Dropbox account.
