# Alloy desktop

The Windows desktop app loads an Alloy server's web UI through Tauri.
`src-tauri/` contains the native host; `recorder/` contains the separate OBS
recorder process, `alloy-agent`.

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

`src-tauri/src/capture_library/` owns everything the host does to capture
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

Requires Windows, Node 24, the pinned pnpm version, Rust, Windows C++ build tools,
and WebView2. Start a compatible Alloy server, then run from the repository root:

```sh
pnpm install
pnpm desktop:obs:install --version 32.1.2
pnpm tauri:dev
```

The installer checks the OBS ZIP against a SHA-256 pinned in
`scripts/install-obs-runtime.mjs` (32.1.2 today), or against the digest GitHub
publishes with the release. It fails if neither is available. When you install
another version for local development, set `ALLOY_OBS_ALLOW_UNVERIFIED=1` to skip
the check; CI and release builds never should.

Enter the server origin serving both the web UI and `/api/*`. HTTP is allowed
only on loopback; other servers require HTTPS. Restart Tauri after changing the
bundled connection screen.

## Build and check

```sh
pnpm tauri:build
pnpm tauri:dist:win:installer
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
pnpm --filter @alloy/desktop test:native
```

Builds bundle the recorder, OBS, and FFmpeg. `test:native` runs the host's
integration tests. Unit tests have been removed; E2E testing is not configured yet.
A successful build does not validate recording or playback. For affected flows,
check on Windows:

- Login, cancellation, session refresh after restart, server switching, and
  incompatible-server rejection.
- Recording, screenshots, recorder crash recovery, and capture while in the tray.
- Desktop capture before starting a game, during a detected game, and after
  switching or closing it. Verify clip/screenshot game metadata and folders while
  the selected display and replay buffer stay unchanged.
- H.264, HEVC, and AV1 playback, seeking, editing, export, and upload.
- Thumbnails and BlurHash placeholders for new clips, screenshots, imports,
  and downloads, and for captures saved by an older build.
- Installer setup, updates, and uninstall.

For cookie changes, test HTTPS on a registrable domain and loopback with stale
host-only and domain-scoped cookies. After login, only a host-only
`alloy_session` cookie should remain and survive restart, including a forced
restart of Windows. A session from an older app (`alloy_refresh`) must restore
without a new sign-in; its `alloy_refresh` cookie stays next to `alloy_session`
until it expires, so not-yet-updated apps still find it. Forgetting the server
must remove both scopes and the legacy names, including stale path variants.
Never log or screenshot token values.

## Storage and logs

- `%APPDATA%\dev.zekurio.alloy`: settings, saved servers, and capture manifest.
- `%LOCALAPPDATA%\dev.zekurio.alloy`: WebView2 profiles, caches, temporary media,
  and `logs\alloy-desktop.log`.
- `%USERPROFILE%\Videos\Alloy`: default recordings folder.
- `%TEMP%\Alloy\replay`: default replay buffer.

Open the host log through Settings > Desktop > App > Diagnostics > Open logs folder.
It includes recorder stderr, not browser console or server logs. Review before sharing.
