# Alloy desktop

The desktop app is an Electron shell around an Alloy server's web UI. Its
native work is in Rust:

- `src/main/`: the Electron main process. It owns the windows, the tray,
  single instance, autostart, updates, cookies, and the IPC bridge, and checks
  every call against the calling window and its selected server.
- `src/preload/`: `connect.ts` gives the bundled connect screen
  (`src/connect/`) its commands; `server.ts` installs the native bridge for
  the selected server's web app as `window.alloyDesktop`, bridge contract 1.
- `host/` (`alloy-desktop`): the recorder client, the capture library and its
  loopback media server, downloads, server checks, browser sign-in,
  preferences, update signature checks, and the host log. It knows nothing
  about windows; the shell passes it folders, dialog results, and cookies.
- `native/` (`alloy-desktop-native`): the napi-rs addon that loads `host`
  into the main process. `src/main/native.ts` declares its exports.
- `recorder/`: the separate OBS recorder process, `alloy-agent`.
- `update-signer/` (`alloy-update-signer`): release tooling that signs the
  installer for the update check; see `.github/RELEASING.md`.

Desktop capture records the selected display while game detection continues.
Saved clips and screenshots use the detected game's metadata and folder, or
`Desktop` when no game is detected. The game at save time determines the label
even if a replay spans a game switch; switching or closing games does not reset
the display replay buffer. Game capture still follows the game window and keeps
its game identity for replays saved during the post-close grace period.

## Recorder code

The host imports `recorder/src/{types,protocol,settings,names}.rs`. Keep these
platform-neutral and keep the JSON wire types in `types.rs`.

The Windows-only process lives under `recorder/src/agent/`:

- `runtime.rs` dispatches requests and publishes status snapshots.
- `recorder/` owns capture state, output lifetime, replay files, and screenshots.
  Its state is private; the runtime calls its configure, status, tick, save, and
  shutdown methods.
- `obs/` loads libobs and configures sources and encoders. FFI declarations live
  in `obs/bindings.rs`; it does not depend on recorder state.
- `platform/` handles Windows discovery, game matching, COM, audio metering, and
  hotkeys. It does not depend on the recorder or libobs.
- `events.rs` writes protocol events; `time.rs` holds shared timestamp helpers.

Use Rust modules and explicit imports, not textual `include!` files or a shared
import prelude. Keep implementation types private to their owning module unless
a caller needs them.

## Capture library media work

`host/src/capture_library/` owns everything the host does to capture
files after the recorder writes them. Jobs are async functions; each one
starts its tools through `work.rs`, never through its own `Command`:

- `MediaWork` is the only ffmpeg/ffprobe runner. It bounds concurrent
  processes per lane (`Export` for export encodes and copies, `Finalize` for
  recorder post-processing, `Light` for frame grabs, `Probe` for ffprobe),
  cancels them when the library shuts down, and collapses concurrent
  requests for one job key (`exclusive`). Lanes don't share slots, so
  saving a clip never waits for an export.
  Manifest and file system calls in async jobs go through `spawn_blocking`,
  and temporary files are `TempFile`s, which delete themselves when a job
  fails or its future is dropped.
- `media.rs` probes captures, finalizes recorder post-processing, and
  exports. Exports avoid re-encoding: a selection covering a whole uploadable
  MP4 exports the capture itself, and a publish stream-copies a shorter
  selection from the keyframe before it and hands the selection to the server
  as an ingest trim, so the server's frame-exact cut is the only encode.
  Re-encoding is the fallback for codecs the server rejects and for
  keyframes more than 10 s before the selection. A replay tail is
  stream-copied from the keyframe before it too, so a shorter replay runs
  up to one keyframe interval (2 s in Alloy's recordings) longer than
  asked. Without a keyframe within 3 s, the tail is re-encoded to the exact
  length.
- `poster.rs` makes the thumbnail and BlurHash for videos and screenshots.
  Posters render in their own task. A new capture, import, or download is
  announced once its poster is done or after `POSTER_WAIT`; captures
  recovered at startup don't wait. The BlurHash lives in the manifest, and
  the loopback server creates a missing poster on first request. The
  renderer never decodes frames for thumbnails.

## Run

Requires Node 24, the pinned pnpm version, and Rust. Recording and the
installer also need Windows with the C++ build tools. Start a compatible Alloy
server, then run from the repository root:

```sh
pnpm install
pnpm desktop:obs:install --version 32.1.2   # Windows only
pnpm desktop:dev
```

`desktop:dev` stages the recorder and FFmpeg on Windows, builds the addon,
downloads Electron if needed, and starts the shell with the connect screen
served by Vite. Changes to the main process or preloads restart the app.

The installer checks the OBS ZIP against a SHA-256 pinned in
`scripts/install-obs-runtime.mjs` (32.1.2 today), or against the digest GitHub
publishes with the release. It fails if neither is available. When you install
another version for local development, set `ALLOY_OBS_ALLOW_UNVERIFIED=1` to skip
the check; CI and release builds never should.

Enter the server origin serving both the web UI and `/api/*`. HTTP is allowed
only on loopback; other servers require HTTPS.

### Linux

The shell runs on Linux for development; Linux recording (through OBS, as on
Windows) and packages come later, so until then the recorder reports itself
missing. The host hands the agent `resources/obs-runtime`, or
`ALLOY_OBS_RUNTIME_DIR` when set; without libobs there, the agent uses the
system's OBS. devenv provides Rust,
`pkg-config`, and ALSA for the addon. The Electron binary npm downloads does
not run on NixOS, so devenv sets `ELECTRON_EXEC_PATH` to nixpkgs' Electron,
which can trail the pinned version by a few releases. Media tools come from
`PATH` unless `ALLOY_FFMPEG` and `ALLOY_FFPROBE` point elsewhere. Folders follow
XDG: data in `~/.local/share/dev.zekurio.alloy`, caches in
`~/.cache/dev.zekurio.alloy`, the browser profile in
`~/.config/dev.zekurio.alloy`.

## Build and check

```sh
pnpm desktop:build              # stage natives and bundle into out/
pnpm desktop:dist:win:installer # Windows: NSIS installer in release/
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
pnpm --filter @alloy/desktop test:native
```

Builds bundle the recorder, OBS, FFmpeg, and the addon as extra resources;
`electron-builder.yml` lists them, and `nsis/installer.nsh` removes the login
item and transient data on uninstall.
`test:native` runs the host's integration tests. Unit tests have been removed;
E2E testing is not configured yet. A successful build does not validate
recording or playback. For affected flows, check on Windows:

- Login, cancellation, session refresh after restart, server switching, and
  incompatible-server rejection.
- Recording, screenshots, recorder crash recovery, and capture while in the tray.
- Desktop capture before starting a game, during a detected game, and after
  switching or closing it. Verify clip/screenshot game metadata and folders while
  the selected display and replay buffer stay unchanged.
- H.264, HEVC, and AV1 playback, seeking, editing, export, and upload.
- Thumbnails and BlurHash placeholders for new clips, screenshots, imports,
  and downloads.
- Installer setup, updates, and uninstall.

For cookie changes, test HTTPS on a registrable domain and loopback. The shell
sets the session cookie host-only at `/`, as the server does, so after login
only a host-only `alloy_session` cookie should remain and survive restart,
including a forced restart of Windows. Forgetting the server must clear its
profile, and opening the connect screen from the login page must remove every
session cookie, including stale path variants. Never log or screenshot token
values.

## Storage and logs

- `%APPDATA%\dev.zekurio.alloy`: settings, saved servers, and capture manifest.
- `%LOCALAPPDATA%\dev.zekurio.alloy`: caches, temporary media, the browser
  profiles in `electron\`, and `logs\alloy-desktop.log`.
- `%LOCALAPPDATA%\Programs\alloy`: the app.
- `%USERPROFILE%\Videos\Alloy`: default recordings folder.
- `%TEMP%\Alloy\replay`: default replay buffer.

Open the host log through Settings > Desktop > App > Diagnostics > Open logs folder.
It includes the shell's and the recorder's diagnostics, not browser console or
server logs. Review before sharing.
