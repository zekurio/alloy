# @alloy/desktop

Electron application for Alloy Desktop. It connects to a self-hosted Alloy
server, records through the Rust sidecar, and runs an installer-owned build of
the React app.

## How it works

The main window loads `alloy-app://app/desktop.html`; it never executes HTML or
JavaScript from the selected server. The browser and desktop builds share the
source in `packages/web`, while Electron main, preload, and the desktop renderer
ship together.

The bundled app sends `/api/*` requests to its fixed local origin. Main proxies
only those paths to the selected server through Electron's persistent session,
so HttpOnly access and refresh cookies never enter renderer JavaScript. Login
still happens in the system browser because passkeys belong to the server's web
origin and OAuth providers may reject embedded flows. Main opens
`/api/auth/desktop/authorize`, receives a loopback PKCE code on `127.0.0.1`, and
stores the exchanged session in Electron's cookie jar.

There are two local renderer surfaces:

- `src/renderer/index.html`: connect UI with `window.alloyNative`.
- `src/renderer/desktop.html`: the bundled web app with the lockstep
  `window.alloyDesktop` native API.

Main allows native IPC only from the exact local document and main frame,
denies browser permissions by default, and opens only selected-server links in
the system browser. HTTP Alloy servers are allowed only for loopback development;
remote servers must use HTTPS.

Recording is delegated to `packages/recorder`. Development builds use
`packages/recorder/dist`; packaged builds bundle that artifact under Electron
resources as the immutable fallback recorder runtime.

## Layout

```text
packages/desktop/
  src/main/      Electron lifecycle, windows, IPC, auth, tray, recorder client
  src/preload/   contextBridge scripts for the connect window and web app
  src/renderer/  Connect entry and bundled-web desktop entry
  src/shared/    IPC channel names and payload types
  scripts/       Electron runtime and icon helpers
  assets/        Desktop icons and build resources
```

## Commands

From the repository root:

```bash
pnpm --filter @alloy/desktop dev
pnpm --filter @alloy/desktop build
pnpm test packages/desktop
pnpm --filter @alloy/desktop typecheck
pnpm --filter @alloy/desktop preview
```

Packaging commands:

```bash
pnpm desktop:obs:install
pnpm desktop:build
pnpm desktop:dist:win
pnpm desktop:dist:win:installer
```

The `dev` and `build` scripts build the Alloy agent from `@alloy/recorder`
first. Its recorder lane needs an OBS runtime, but development does not require
a system-wide OBS install. Stage the official portable OBS Windows x64 ZIP into
`packages/recorder/dist`:

```bash
pnpm desktop:obs:install
```

The installer downloads the latest OBS release by default. Pin a specific
release with `ALLOY_OBS_VERSION=32.1.2 pnpm desktop:obs:install` or
`pnpm desktop:obs:install -- --version 32.1.2`.

You can still point at an existing runtime instead:

```bash
set ALLOY_OBS_RUNTIME_DIR=C:\Path\To\obs-studio
pnpm desktop:dist:win:installer
```

`ALLOY_OBS_RUNTIME_DIR` may point at the OBS root, `bin`, or `bin/64bit`.
Release builds require `obs.dll` in either the staged or configured runtime.

## Runtime Paths

- Preferences: `%APPDATA%\Alloy Desktop\preferences.json`
- Capture manifest (titles, upload metadata, game info): `%APPDATA%\Alloy Desktop\recording-library.json`
- Capture thumbnails + BlurHash metadata: `%APPDATA%\Alloy Desktop\recording-thumbnails`
- Remote asset cache (game icons etc.): `%APPDATA%\Alloy Desktop\asset-cache`
- Temporary imports and exports: `%APPDATA%\Alloy Desktop\recording-library-imports`, `%APPDATA%\Alloy Desktop\recording-exports`
- Housekeeping task ledger: `%APPDATA%\Alloy Desktop\housekeeping\state.json`
- Browser session/cache: `%APPDATA%\Alloy Desktop\session`
- Logs: `%APPDATA%\Alloy Desktop\logs`
- Updater installer cache: `%LOCALAPPDATA%\@alloydesktop-updater`
- Replay scratch: `%TEMP%\Alloy\replay-buffer`
- Default captures: `%USERPROFILE%\Videos\Alloy`
- Bundled recorder/OBS runtime: installed app `resources`

## Release

Desktop releases ship on a single channel. Launching Alloy does not check the
GitHub release feed or delay recorder and hotkey startup. The app schedules its
first background check four hours after launch and repeats the check every four
hours while it remains open. A manual check is also available under Desktop
Settings.

When Alloy finds an update, it downloads the update in the background and
offers an explicit restart action in the bundled app. It never forces a restart
while Alloy is running. Before starting the NSIS installer, Alloy stops capture
services so the installer can safely replace their files.

The publish workflow uploads the installer, blockmap, and `latest.yml` before
it promotes the server container's `latest` tag. This order matters at the
one-time bundled-renderer cutover. Afterward, desktop/server skew is handled by
exact HTTP contract IDs from `/api/server-info`; the desktop supports contract
1 and the pre-cut server's equivalent API baseline.

GitHub Release assets are desktop-only: the unsigned Windows NSIS installer,
blockmap, updater metadata, and checksums from `packages/desktop/release`.
Electron Updater checks the SHA-512 value in `latest.yml`, but the installer is
not code-signed yet. Windows code signing remains required before Alloy can
claim publisher identity or remove SmartScreen warnings.
