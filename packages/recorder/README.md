# @alloy/recorder

Rust recording sidecar used by Alloy Desktop. It talks to libobs and communicates
with Electron over newline-delimited JSON on stdio.

## Layout

```text
packages/recorder/
  src/main.rs                         entrypoint and shared constants
  src/sidecar_runtime*.rs             stdio protocol, game detection, platform runtime
  src/sidecar_recorder*.rs            recorder state and output handling
  src/sidecar_obs*.rs                 libobs loading and OBS graph setup
  src/sidecar_types.rs                protocol and recording data types
  scripts/build.mjs                   Cargo build + artifact staging
  dist/                               generated recorder runtime artifact
```

## Protocol

Requests are JSON objects with `id`, `method`, and optional `params`. Responses
include the same `id`, `ok`, and either `result` or `error`.

Supported methods:

- `version`
- `configure`
- `status`
- `saveReplayClip`
- `shutdown`

The `version` method returns the recorder semantic version, protocol version,
and capability list. Desktop should use that to reject incompatible future
runtime updates before calling `configure`.

## Commands

```bash
pnpm --filter @alloy/recorder obs:install
pnpm --filter @alloy/recorder build
pnpm --filter @alloy/recorder build:release
```

Recording needs OBS runtime libraries, but development does not require a
system-wide OBS install. Stage the official portable OBS Windows x64 ZIP into
`dist/obs-runtime`:

```bash
pnpm --filter @alloy/recorder obs:install
```

The installer downloads the latest OBS release by default. Pin a specific
release with `ALLOY_OBS_VERSION=32.1.2 pnpm --filter @alloy/recorder obs:install`
or `pnpm --filter @alloy/recorder obs:install -- --version 32.1.2`.

You can still point at an existing runtime instead:

```bash
set ALLOY_OBS_RUNTIME_DIR=C:\Path\To\obs-studio
pnpm --filter @alloy/recorder build:release
```

The build writes:

```text
packages/recorder/dist/
  recorder.json
  sidecar/alloy-recorder.exe
  obs-runtime/
```

On Windows, OBS helper executables such as `obs-ffmpeg-mux.exe` are copied into
`dist/sidecar` when present.

## Release

Recorder builds ship inside the Alloy desktop installer for stable and nightly
releases. The release workflow stamps the recorder package and Cargo versions to
the desktop release version, builds the Windows x64 runtime, and bundles it into
the Electron app resources.
