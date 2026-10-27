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

The agent process lives under `recorder/src/agent/`:

- `runtime.rs` dispatches requests and publishes status snapshots.
- `recorder/` owns capture state, output lifetime, replay files, and
  screenshots. Its state is private; the runtime calls its configure, status,
  tick, save, and shutdown methods.
- `obs/` loads libobs and configures sources and encoders. FFI declarations
  live in `obs/bindings.rs`; `obs/platform/` holds each platform's source ids,
  module list, and runtime layout. It does not depend on recorder state.
- `platform/` discovers games, displays, GPUs, and audio, meters audio levels,
  and hooks hotkeys: Win32, WASAPI, and COM on Windows, `/proc`, sysfs, and
  PipeWire in `platform/linux/`. It does not depend on the recorder or
  libobs.
- `game_matching.rs` matches processes against the Discord catalog and the
  allow and deny lists. `quality.rs` resolves resolution, frame rate, and
  bitrate.
- `events.rs` owns the protocol output; `time.rs` holds shared timestamp
  helpers.

Use Rust modules and explicit imports, not textual `include!` files or a shared
import prelude. Keep implementation types private to their owning module unless
a caller needs them.

### Linux recorder

The agent loads libobs from `ALLOY_OBS_RUNTIME_DIR`, an installed prefix with
`lib/libobs.so.0`, `lib/obs-plugins`, and `share/obs`, or from the system. It
opens only the modules it needs: from that prefix and beside its libobs, or,
with the system's libobs, also from `OBS_PLUGINS_PATH`, the system, or
`~/.config/obs-studio/plugins`, since a module built for another libobs may
not load safely. `nix build .#alloy-obs-runtime`
builds a matching prefix with every plugin below and libpipewire.

- Game capture uses
  [obs-vkcapture](https://github.com/nowrep/obs-vkcapture), which captures
  Vulkan and OpenGL games directly on Wayland and X11. A game only connects
  when its Vulkan loader finds the layer and `OBS_VKCAPTURE=1` is set in its
  environment; OpenGL games need the `obs-gamecapture` wrapper. The source
  matches the name the layer reports: the Wine program's `comm` (its
  executable, cut to 15 bytes) for Proton games, the executable's file name
  for native ones. A game that sends no frames within two minutes falls back
  to display capture. Only one process can host obs-vkcapture at a time, so
  OBS Studio with the plugin and Alloy exclude each other.
- Display capture on Wayland goes through the screen-sharing portal (OBS's
  `linux-pipewire`). The dialog asks once; the portal's restore token is kept
  in the agent state folder, so later sessions reopen the chosen screen. The
  agent runs a GLib main loop for the portal's D-Bus replies, and stops the
  buffer if no picture arrives within two minutes. On X11 it captures a RandR
  monitor with OBS's `linux-capture`, listed through `xrandr`.
- Audio goes through PipeWire with
  [obs-pipewire-audio-capture](https://github.com/dimtpap/obs-pipewire-audio-capture),
  which the agent requires, since OBS has no PipeWire audio of its own.
  Devices are keyed by node name, a sink for an output and a source for an
  input; the plugin reconnects to that name whenever the node appears, and
  follows the default device for `default`. Applications are matched by
  binary or, for Wine, by the application name Wine reports. The agent loads
  libpipewire like libobs, from the runtime prefix or the system, to list
  devices, defaults, and applications and to meter their levels. The plugin
  connects to a device once its node reports `audio.channels`; hardware
  devices always do, but a virtual sink made for testing needs it set.
- GPUs are DRM render nodes; the selected one is the VAAPI device. OBS's
  NVENC and QSV encoders work as on Windows.
- `ffmpeg_muxer` and `replay_buffer` start OBS's `obs-ffmpeg-mux` from the
  agent's folder, so it has to be installed beside `alloy-agent`;
  `build-agent.mjs` links it. Protocol output goes to a private copy of
  stdout, since the helper prints to the stdout it inherits.
- The agent registers no hotkeys, since Wayland gives applications no global
  key hook. It leaves `hotkeys` out of `capabilities`, and the host binds the
  shortcuts instead; see [Global shortcuts on Linux](#global-shortcuts-on-linux).

The agent, libobs, and the graphics drivers must share one glibc. On NixOS,
build them from the same nixpkgs as the system. Games need obs-vkcapture's
layer, 32-bit too for 32-bit games, and the variable:

```nix
{
  hardware.graphics.extraPackages = [ pkgs.obs-studio-plugins.obs-vkcapture ];
  hardware.graphics.extraPackages32 = [
    pkgs.pkgsi686Linux.obs-studio-plugins.obs-vkcapture
  ];
  environment.sessionVariables.OBS_VKCAPTURE = "1";
}
```

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

Requires Node 24, the pinned pnpm version, and Rust. The installer also needs
Windows with the C++ build tools; recording works on Windows and on Linux (see
[Linux](#linux)). Start a compatible Alloy server, then run from the
repository root:

```sh
pnpm install
pnpm desktop:obs:install --version 32.1.2   # Windows only
pnpm desktop:dev
```

`desktop:dev` builds the recorder, stages FFmpeg on Windows, builds the addon,
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

The shell runs and records on Linux for development; packages come later. See
[Linux recorder](#linux-recorder) for the OBS runtime and the plugins games
need. The host hands the agent `resources/obs-runtime`, or
`ALLOY_OBS_RUNTIME_DIR` when set; without libobs there, the agent uses the
system's OBS. devenv provides Rust, `pkg-config`, and ALSA for the addon. The
Electron binary npm downloads does not run on NixOS, so devenv sets
`ELECTRON_EXEC_PATH` to nixpkgs' Electron, which can trail the pinned version
by a few releases. Media tools come from `PATH` unless `ALLOY_FFMPEG` and
`ALLOY_FFPROBE` point elsewhere. Folders follow XDG: data in
`~/.local/share/dev.zekurio.alloy`, caches in `~/.cache/dev.zekurio.alloy`,
the browser profile in `~/.config/dev.zekurio.alloy`.

### Global shortcuts on Linux

`host/src/global_shortcuts.rs` binds the clip and screenshot shortcuts through
the desktop's GlobalShortcuts portal; the Windows recorder hooks the keys
itself. At startup the shell passes the app id (`dev.zekurio.alloy`) and the
translated descriptions. The host registers the id with
`org.freedesktop.host.portal.Registry`, since the portal refuses an app
without one and a terminal start has none, then creates a session and binds
`clip` and `screenshot` with the saved hotkeys as preferred triggers.

The desktop asks the user only for shortcut ids it hasn't seen, so binding on
every start is silent after the first. From then on the desktop owns the keys:
the settings show its trigger descriptions, and **Change shortcuts** opens its
own settings (`ConfigureShortcuts`, portal version 2). A press saves a clip or
a screenshot through the same path as `--action`. Without the portal (GNOME
before 48, most wlroots compositors) the settings say so, and a desktop
shortcut that runs the app with `--action clip` or `--action screenshot` is
the fallback.

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
