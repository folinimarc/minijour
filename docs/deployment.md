# Deployment guide

[Back to the README](../README.md)

minijour builds into static HTML, CSS, JavaScript, icons, and WebAssembly. It needs HTTPS and no application server. Every user connects their own cloud account; provider app keys identify the application, not a shared storage account.

## Configure cloud providers

Provider setup is a website-operator task. Register each provider's application once and supply its public configuration before building. Visitors see only configured providers, connect their own accounts, and choose or enter their cloud password. The frontend has no developer setup fields.

| Implemented provider | Build variable |
| --- | --- |
| Dropbox | `VITE_DROPBOX_APP_KEY` |

Copy `.env.example` to `.env` for local builds, or supply variables in CI. With no provider configured, cloud controls are hidden; local writing and ZIP backups still work. Configuration is part of the static build, so changes require rebuilding and deploying, followed by updating installed PWAs.

Removing a provider from a deployment stops that build from opening its saved connection. Local entries, credentials, and account ownership remain on the device; restoring the original configuration allows sync to resume. A journal stays bound to its original provider, application, and account to prevent accidental uploads elsewhere. Replacing an app key is not a migration to a new app.

Dropbox is currently the only implementation. Google Drive and OneDrive are possible future integrations; no configuration for them is available yet. See [adding a provider](development.md#add-a-cloud-provider).

### Dropbox

Register one app in the [Dropbox App Console](https://www.dropbox.com/developers/apps):

1. Choose **Scoped access** and **App folder**.
2. Enable and submit `files.metadata.read`, `files.content.read`, and `files.content.write`.
3. Register the exact production OAuth redirect URI, including the journal path and trailing slash: `https://your-host/journal/`, or `https://folinimarc.github.io/minijour/journal/` on project Pages. Add a localhost URI separately for development.
4. Copy `.env.example` to `.env` and set `VITE_DROPBOX_APP_KEY` before building, or supply that environment variable in CI.
5. Enable additional users for testing, and follow Dropbox's production-approval process before wider distribution.

The app key is public and included in the browser build. Never put an app secret, access token, or refresh token in a `VITE_` variable. Authorization uses code flow with SHA-256 PKCE and state validation. Tokens stay on the authorizing device and refresh automatically.

With a configured key, visitors choose **Connect Dropbox**, then create or enter their cloud password. Devices sharing a journal use the same website configuration and Dropbox account.

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

Encrypted sync is browser-to-Dropbox; the website host does not hold passwords or journal keys. Keep deployments trustworthy: anyone controlling the served JavaScript could read unlocked data.

The service worker caches app assets including Automerge's WebAssembly, not Dropbox requests or journal data. Updates wait for the user to choose reload after pending local edits save.

## GitHub Pages

The project Pages URL is `https://folinimarc.github.io/minijour/`. Register `https://folinimarc.github.io/minijour/journal/` as the Dropbox redirect URI.

1. Choose **Settings → Pages → Source → GitHub Actions**.
2. Add public repository variable `VITE_DROPBOX_APP_KEY` under **Settings → Secrets and variables → Actions → Variables**. Changing it does not update an existing static deployment: build and deploy a new release, then accept the installed PWA update if needed.
3. The release workflow sets `VITE_BASE_PATH` to `/<repository-name>/`. For a custom domain root, set the repository variable `VITE_BASE_PATH` to `/`.
4. Allow the `github-pages` environment to deploy the intended release tags.
5. Follow the [release procedure](releasing.md). The public site is deployed from release tags rather than each development commit.

Pages supports public repositories on GitHub Free. Private source repositories require an eligible paid plan; they can publish a public website. Journal data still stays on users' devices and their Dropbox accounts.

Register the `/journal/` redirect URI for the deployed path. OAuth callbacks belong to that page; the home page does not forward callbacks. Installed apps launch directly into the journal, and its wordmark opens the information page.

For a custom domain, configure Pages and update Dropbox's redirect URI, then test installation at the final address.

## Verify before inviting users

Automated tests mock Dropbox. Verify these steps with real accounts and devices:

- Authorize Dropbox in a browser and installed PWA.
- Write offline, reconnect, and retrieve the text on another device.
- Capture and choose a photo, then verify cross-device download.
- Export and restore a backup in a separate browser profile.
- Test photo-cleanup review/cancel, deletion sync, and reconnecting an offline device.
- Install, reload offline, and update at the actual hosted subdirectory URL.
- Check the on-screen keyboard and record browsers/devices tested.

Review repository history and public documentation before changing visibility. Release automation does not change repository visibility or configure your Dropbox account.
