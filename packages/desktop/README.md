# @alloy/desktop

Electron application for Alloy Desktop. It connects to a self-hosted Alloy
server, records through the Rust sidecar, and ships an installer-owned native
bridge around the server-owned React app.

## How it works

The main window loads the selected server origin directly. It uses that
server's normal browser build, history routes, HTTP stack, event streams,
uploads, media, and HttpOnly cookies. Electron does not proxy application
traffic.

Login still happens in the system browser because OAuth providers may reject
embedded flows and passkeys belong to a browser profile. Main opens
`/api/auth/desktop/authorize`, receives a loopback PKCE code on `127.0.0.1`, and
stores the exchanged session in Electron's cookie jar.

There is one local renderer surface:

- `src/renderer/index.html`: connect UI with `window.alloyNative`.

The sandboxed main preload receives the selected origin through a
main-controlled argument and exposes `window.alloyDesktop` only on that exact
origin. Main independently requires the selected BrowserWindow, top-level
frame, exact origin, and bridge contract before privileged IPC. Browser
permissions are deny-by-default. HTTP Alloy servers are allowed only for
loopback development; remote servers must use HTTPS.

`alloy-capture://` provides bounded local capture playback and
`alloy-asset://` provides the allowlisted image cache. Everything else stays on
the server origin.

Recording is delegated to `packages/recorder`. Development builds use
`packages/recorder/dist`; packaged builds bundle that artifact under Electron
resources as the immutable fallback recorder runtime.

## Layout

```text
packages/desktop/
  src/main/      Electron lifecycle, windows, IPC, auth, tray, recorder client
  src/preload/   contextBridge scripts for the connect window and web app
  src/renderer/  Local connect/recovery entry
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

`pnpm dev:all` starts the web development origin at
`http://localhost:5173`. Connect the desktop shell to that URL; Vite keeps the
renderer and its proxied `/api` requests on one origin while preserving HMR.
Production desktops connect to the Alloy server origin itself.

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
- Extracted audio-track cache: `%APPDATA%\Alloy Desktop\recording-audio-tracks`
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
offers an explicit restart action in the server-hosted app. It never forces a restart
while Alloy is running. Before starting the NSIS installer, Alloy stops capture
services so the installer can safely replace their files.

The publish workflow promotes the compatible server container before it
publishes the installer, blockmap, and `latest.yml`. The new desktop therefore
never updates onto a server without its required web bridge. Existing bundled
desktop releases remain compatible with the additive server release.

GitHub Release assets are desktop-only: the unsigned Windows NSIS installer,
blockmap, updater metadata, and checksums from `packages/desktop/release`.
Electron Updater checks the SHA-512 value in `latest.yml`, but the installer is
not code-signed yet. Windows code signing remains required before Alloy can
claim publisher identity or remove SmartScreen warnings.
