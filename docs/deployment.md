# Deployment guide

[Back to the README](../README.md)

minijour builds into static HTML, CSS, JavaScript, icons, and WebAssembly. It needs HTTPS and no application server. Every user connects their own Dropbox account; the app key identifies the application, not a shared storage account.

## Configure Dropbox

Register one app in the [Dropbox App Console](https://www.dropbox.com/developers/apps):

1. Choose **Scoped access** and **App folder**.
2. Enable and submit `files.metadata.read`, `files.content.read`, and `files.content.write`.
3. Register the exact production OAuth redirect URI, including path and trailing slash. Add a localhost URI separately for development.
4. Copy `.env.example` to `.env` and set `VITE_DROPBOX_APP_KEY` before building, or supply that environment variable in CI.
5. Enable additional users for testing, and follow Dropbox's production-approval process before wider distribution.

The app key is public and included in the browser build. Never put an app secret, access token, or refresh token in a `VITE_` variable. Authorization uses code flow with SHA-256 PKCE and state validation. Tokens stay on the authorizing device and refresh automatically.

With a configured key, visitors should only need **Connect Dropbox**. Builds without a key expose manual configuration for self-hosting and development. Use the same app key and Dropbox account on devices that should share a journal.

Dropbox permits HTTP OAuth redirects for `localhost`, for example `http://localhost:5173/`. Use HTTPS on actual devices: HTTP LAN addresses do not provide the secure context required by installation and other browser APIs.

## Build for a static host

```sh
npm ci
npm run build
```

Publish `dist/`. Keep a stable origin and path: browser storage belongs to the origin and Dropbox checks redirect URIs exactly. Relative asset URLs support subdirectory hosting. Keep license notices and corresponding source available when distributing builds; see the [release guide](releasing.md).

The service worker caches app assets including Automerge's WebAssembly, not Dropbox requests or journal data. Updates wait for the user to choose reload after pending local edits save.

## GitHub Pages

The default project URL is `https://folinimarc.github.io/minijour/`; it is not necessarily deployed yet. Register that exact redirect URI if you use it.

1. Choose **Settings → Pages → Source → GitHub Actions**.
2. Add public repository variable `VITE_DROPBOX_APP_KEY` under **Settings → Secrets and variables → Actions → Variables**.
3. Allow the `github-pages` environment to deploy the intended release tags.
4. Follow the [release procedure](releasing.md). The public site is deployed from release tags rather than each development commit.

Pages supports public repositories on GitHub Free. Private source repositories require an eligible paid plan; they can publish a public website. Journal data still stays on users' devices and their Dropbox accounts.

For a custom domain, configure Pages and update Dropbox's redirect URI, then test installation at the final address.

## Verify before inviting users

Automated tests mock Dropbox. Verify these steps with real accounts and devices:

- Authorize Dropbox in a browser and installed PWA.
- Write offline, reconnect, and retrieve the text on another device.
- Capture and choose a photo, then verify cross-device download.
- Export and restore a backup in a separate browser profile.
- Install, reload offline, and update at the actual hosted subdirectory URL.
- Check the on-screen keyboard and record browsers/devices tested.

Review repository history and public documentation before changing visibility. Release automation does not change repository visibility or configure your Dropbox account.
