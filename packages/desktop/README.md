# Alloy desktop

The Windows desktop app loads an Alloy server's web UI through Tauri.
`src-tauri/` contains the native host; `recorder/` contains the separate OBS
recorder process, `alloy-agent`.

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

## Run

Requires Windows, Node 24, the pinned pnpm version, Rust, Windows C++ build tools,
and WebView2. Start a compatible Alloy server, then run from the repository root:

```sh
pnpm install
pnpm desktop:obs:install --version 32.1.2
pnpm tauri:dev
```

Enter the server origin serving both the web UI and `/api/*`. HTTP is allowed
only on loopback; other servers require HTTPS. Restart Tauri after changing the
bundled connection screen.

## Build and check

```sh
pnpm tauri:build
pnpm tauri:dist:win:installer
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test -p alloy-agent --locked
pnpm --filter @alloy/desktop test:native
```

Builds bundle the recorder, OBS, and FFmpeg. `test:native` tests only the host.
A successful build does not validate recording or playback. For affected flows,
check on Windows:

- Login, cancellation, session refresh after restart, server switching, and
  incompatible-server rejection.
- Recording, screenshots, recorder crash recovery, and capture while in the tray.
- H.264, HEVC, and AV1 playback, seeking, editing, export, and upload.
- Installer setup, updates, and uninstall.

For cookie changes, test HTTPS on a registrable domain and loopback with stale
host-only and domain-scoped cookies. After login and refresh, only host-only
`alloy_access` and `alloy_refresh` cookies should remain and survive restart.
Forgetting the server must remove both scopes, including stale path variants.
Never log or screenshot token values.

## Storage and logs

- `%APPDATA%\dev.zekurio.alloy`: settings, saved servers, and capture manifest.
- `%LOCALAPPDATA%\dev.zekurio.alloy`: WebView2 profiles, caches, temporary media,
  and `logs\alloy-desktop.log`.
- `%USERPROFILE%\Videos\Alloy`: default recordings folder.
- `%TEMP%\Alloy\replay`: default replay buffer.

Open the host log through Settings > Desktop > App > Diagnostics > Open logs folder.
It includes recorder stderr, not browser console or server logs. Review before sharing.
