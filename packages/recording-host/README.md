# Alloy recording host

`alloy-recording-host` owns the process boundary between the Tauri shell and
the existing `alloy-agent` OBS executable. The agent remains a separate
Windows executable. The host starts it, validates its protocol handshake,
serializes requests, reads events, and restarts it after an unexpected exit.

The main entry point is `RecorderHost`:

```rust,ignore
let host = RecorderHost::new(
    RecorderHostOptions::new(agent, state_dir)
        .output_folder(output_dir)
        .replay_scratch_folder(replay_scratch_dir)
        .obs_runtime_dir(obs_runtime_dir),
)?;

let events = host.subscribe_events();
let settings = host.get_settings().await;
host.set_settings(settings).await?;
let status = host.configure().await?;
```

`set_settings` validates and persists the settings file. Call `configure` or
`restart` after the write when the new settings must be active. This mirrors
the Electron shell, which persisted settings before it pushed a configure
request.

The host persists a small raw capture manifest in the state directory. It does
not rewrite media. `CaptureReady` events and action results keep the recorder's
`postProcess` field, including `trim-tail` and `concat-segments`. The capture
library can therefore finalize the file before it exposes the capture to the
renderer. A capture is retained until that consumer completes finalization.

After the library stores a finalized capture, call
`host.complete_capture(capture).await`. This removes the raw recovery entry and
keeps later recorder status updates from restoring stale capture metadata.

On Windows, an automatic Discord game catalog is stored under the recording
state folder when no cache path is supplied. The first refresh runs in the
background. A stale or unavailable network response leaves the last valid
cache in place.

The host accepts only protocol version 1 from a process named `alloy-agent`.
Requests have deadlines, stdout and stderr are drained in background tasks,
and a stalled process is terminated by the heartbeat watchdog. Respawns are
delayed and capped; repeated short-lived crashes leave the backend in the
error state until an explicit restart.
