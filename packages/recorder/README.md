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
- `stopRecording`
- `shutdown`

The `version` method returns the recorder semantic version, protocol version,
and capability list. Desktop should use that to reject incompatible future
runtime updates before calling `configure`.

## Commands

```bash
pnpm --filter @alloy/recorder build
pnpm --filter @alloy/recorder build:release
pnpm --filter @alloy/recorder test
```

Release builds require a valid OBS runtime:

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

Recorder releases use tags named `recorder-vX.Y.Z` and publish a Windows x64
runtime zip plus checksums. This lets sidecar fixes ship independently from the
Electron desktop shell.
