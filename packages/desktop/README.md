# @alloy/desktop

Electron shell for Alloy Desktop. It connects to a self-hosted Alloy server,
loads the live web app from that server origin, and exposes a narrow desktop
bridge for local recording and settings.

## How It Works

The remote web app runs with real server-origin cookies. Login happens in the
system browser because Electron Chromium does not provide the full WebAuthn UI
layer for passkeys and some OAuth providers reject embedded browser flows. The
desktop app opens `/api/auth/desktop/authorize`, receives a loopback code on
`127.0.0.1`, and exchanges it for a session that is injected into the Electron
cookie jar.

There are two trust surfaces:

- `src/renderer`: bundled trusted connect UI with `window.alloyNative`.
- Main window: remote server origin with the narrower `window.alloyDesktop`
  bridge.

The main process pins navigation to the connected server origin, denies browser
permission requests by default, and opens normal external URLs in the system
browser. HTTP Alloy servers are allowed only for loopback development; remote
servers must use HTTPS.

Recording is delegated to `packages/recorder`. Development builds use
`packages/recorder/dist`; packaged builds bundle that artifact under Electron
resources as the immutable fallback recorder runtime.

## Layout

```text
packages/desktop/
  src/main/      Electron lifecycle, windows, IPC, auth, tray, recorder client
  src/preload/   contextBridge scripts for the connect window and web app
  src/renderer/  React connect screen
  src/shared/    IPC channel names and payload types
  scripts/       Electron runtime and icon helpers
  assets/        Desktop icons and build resources
```

## Commands

From the repository root:

```bash
pnpm --filter @alloy/desktop dev
pnpm --filter @alloy/desktop build
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

The `dev` and `build` scripts build `@alloy/recorder` first. Recording needs an
OBS runtime, but development does not require a system-wide OBS install. Stage
the official portable OBS Windows x64 ZIP into `packages/recorder/dist`:

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
- Browser session/cache: `%LOCALAPPDATA%\Alloy Desktop\session`
- Logs: `%LOCALAPPDATA%\Alloy Desktop\logs`
- Replay scratch: `%TEMP%\Alloy\replay-buffer`
- Default captures: `%USERPROFILE%\Videos\Alloy`
- Bundled recorder/OBS runtime: installed app `resources`
- Future mutable recorder runtime: `%LOCALAPPDATA%\Alloy Desktop\runtime`

## Release

Desktop releases ship on a single channel. The publish workflow stamps the
desktop package version before building and publishes `latest.yml` next to the
Windows installer, so packaged builds check the GitHub releases feed in the
background. Download and install updates manually from Desktop > Updates.

GitHub Release assets are desktop-only: the unsigned Windows NSIS installer,
blockmap, updater metadata, and checksums from `packages/desktop/release`.
