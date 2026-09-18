# Alloy desktop

This package is the Tauri desktop app. It holds both Rust crates: `src-tauri/`
is the Tauri host and `recorder/` is the OBS capture agent library plus its
`alloy-agent` binary, which runs as a separate process.

## Design

The app bundles a local connection screen. Rust checks the selected server's
HTTP contract and Tauri bridge contract before it opens that server's web UI.
The server still builds and serves the same React app used by browsers.

The reference was [Jellium Desktop](https://github.com/andrewrabert/jellium-desktop/tree/28f2cf16a1f1b819884dd6a72919ca55bdf9bd73).
It loads the server's web UI and adds a native bridge. Jellium uses CEF and mpv;
Alloy uses Tauri and keeps OBS in its existing recorder process.

Sign-in opens the system browser and uses the existing PKCE flow. Rust receives
an authorization code on a temporary loopback callback and exchanges it for
tokens. It sets the WebView's HttpOnly
session cookies before loading the server UI. Tokens do not enter renderer
JavaScript. The WebView then sends normal same-origin API, upload, media, and
event-stream requests. There is no general API proxy.

On Windows, each server origin has a separate persistent WebView profile.
The local connection screen lists saved servers. The selected server's web UI
can also list, switch, and forget saved servers through the desktop bridge.
Forgetting a server removes its saved session. Closing the main window keeps
capture and media work active in the tray. Quit stops the recorder and media
processes.

Autostart registers the app with `--autostart`. Started that way it restores the
saved server and warms up the recorder without showing a window; the tray opens
it when the user asks.

The native bridge grants operations only to the selected server window and
origin. The local connection window has separate permissions. Each remote
window has a unique label. Navigation cannot move a native-enabled window to
another server.

Recorder control lives in the `recording_host` module. Capture storage and
background media work live in the `capture_library` module. FFmpeg handles
native media work. A local file server streams captures and exports with range
support. It does not forward server API requests.

On Windows the app keeps its state in two folders. `%APPDATA%\dev.zekurio.alloy`
holds settings, the saved-server list, recorder settings and the capture
manifest. `%LOCALAPPDATA%\dev.zekurio.alloy` holds everything the app can
regenerate: WebView2 profiles, thumbnails, import staging, export renders,
recorder scratch state, the Discord detection cache and the host log at
`logs\alloy-desktop.log`. Recordings default to `%USERPROFILE%\Videos\Alloy`
and the replay buffer to `%TEMP%\Alloy\replay`.

## Run

Use Node 24, the pinned pnpm version, Rust, and the Windows C++ build tools.
Windows also needs WebView2. Start an Alloy server from this branch first.
Older servers do not advertise the Tauri bridge contract.

```sh
pnpm install
pnpm desktop:obs:install --version 32.1.2
pnpm tauri:dev
```

For local development, enter the web server's origin. It must serve both the
web UI and `/api/*`. HTTP is accepted only for loopback addresses. Other
servers need HTTPS. The connection screen is bundled in both development and
release builds. Rebuild or restart Tauri after changing that screen.

```sh
pnpm tauri:build
pnpm tauri:dist:win:installer
pnpm --filter @alloy/desktop check:native
pnpm --filter @alloy/desktop test:native
pnpm verify
```

Windows builds stage the recorder, OBS, and FFmpeg as app resources. The FFmpeg
installer script pins version 8.1.2 and checks the published SHA-256 hash. It
keeps the upstream license and build notes with the binaries. The archive
cache is local to this package.

Tauri uses its own app data directory and does not read anything the Electron
build wrote. Sign in and select your existing recording folder on the first
start.

## Windows validation

Only Windows can validate the capture runtime. The Windows CI jobs check the
native host and build an unsigned NSIS installer. A build does not establish
playback or recording behavior. Test these on Windows:

- Sign in, restart, refresh an expired session, sign out, and switch servers.
- Cancel login, close during login, and reject an incompatible server.
- Record a clip and a screenshot. Kill the recorder and check recovery.
- Seek and edit large H.264, HEVC, and AV1 captures. Check image thumbnails.
- Export a trim, join replay segments, and upload the result.
- Keep recording and media jobs active while the main window is hidden.
- Install, start, update, and uninstall an NSIS build.

No Windows runtime or performance result has been recorded yet. Record clean
and cached build times, native edit builds, installer size, and total process
memory on a Windows machine before changing the capture pipeline.
