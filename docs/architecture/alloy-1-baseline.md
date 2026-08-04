# Alloy 1.0 baseline

Alloy 1.0 is the first supported product baseline. It intentionally does not
upgrade pre-1.0 development state, database history, web/desktop bridges, or
recorder protocols in place.

## Reset boundary

- The server starts from the single 1.0 baseline migration. Operators must
  provision a fresh database; development migration journals are not accepted.
- Desktop preferences and manifests require their current schema versions.
  No migration or compatibility reader runs against older documents.
- The server-hosted web app requires the current desktop bridge version. An
  older shell gets an update-required screen before desktop APIs are used.
- Electron requires agent protocol v1 before configuration or any work is
  submitted. A mismatched binary is rejected; capability guessing is not a
  compatibility mechanism.
- Persisted manifests and preferences are versioned current-state documents.
  Invalid or older documents are treated as absent, never upgraded in place.

This removes historical compatibility. It does not remove operational
resilience: encoder fallback, capture fallback, crash recovery, storage copy
fallback, retryable jobs, and UI placeholders remain valid current behavior.

## One local agent

The Windows process currently known as the recorder sidecar becomes the Alloy
agent. It is the only long-running native child owned by Electron.

```text
Electron main process
        |
        | strict protocol v1 over stdio
        v
Alloy agent
  |-- recorder lane (latency-sensitive libobs state)
  |-- durable media coordinator (journal + scheduling)
  `-- disposable media-job child processes
```

The recorder lane never performs thumbnails, scrubbers, stem extraction,
proxy generation, muxing, or transcoding. The coordinator persists intent and
state, then launches bounded child processes for that work. A media crash can
fail one job without taking down capture or the agent. Jobs survive Electron
window reloads and are reconciled after an agent restart.

## Media contract

A capture or import is not renderer-ready until its current asset manifest is
committed atomically. The manifest names the immutable source signature and
the prepared assets used by the UI:

- poster and scrubber sheet;
- playback proxy when the source is not a supported direct-play shape;
- independently seekable audio stems;
- duration, dimensions, container, and RFC 6381 codec facts.

The renderer only consumes committed assets. It does not decode whole files to
create derivatives, lazily extract stems on the first mixer interaction, or
fall back to a previous manifest shape. Audio playback uses streamable stems
and a persistent Web Audio graph; changing gain is a graph parameter update,
not a decode or remux operation.

## Job invariants

1. Job identity is deterministic for `(source signature, recipe version)`.
2. Journal writes and asset publication are atomic.
3. Outputs are written to job-scoped temporary paths and renamed only after
   validation.
4. Starting a job never blocks recorder ticks or stdio request handling.
5. Cancel and shutdown terminate only disposable job children; capture owns a
   separate lifetime.
6. Startup reconciles `running` jobs to `queued` and deletes uncommitted
   temporary outputs.
7. Deleting a capture cancels its jobs before pruning committed assets.

## Delivery order

1. Establish the 1.0 versions, strict handshakes, fresh desktop state, and
   fresh database baseline.
2. Rename the recorder runtime to the Alloy agent and make it warm regardless
   of whether recording is enabled.
3. Add the durable coordinator and disposable job execution boundary.
4. Move capture/import probing and derivative generation behind the agent.
5. Switch local playback and mixing to prepared assets, then delete renderer
   generation and lazy main-process extraction in the same change.

Steps 3-5 are one media-pipeline change: no compatibility worker, dual-write,
or temporary renderer fallback is shipped between them.
