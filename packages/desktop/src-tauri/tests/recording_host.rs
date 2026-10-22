//! Agent start pacing. Unix only: a shell script stands in for the agent.
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use alloy_desktop::recording_host::{RecorderHost, RecorderHostOptions};
use tempfile::TempDir;

/// Stands in for an agent that can never start, like one whose OBS fails to
/// initialize: it logs each launch and rejects every request.
fn failing_agent(temp: &TempDir) -> (PathBuf, PathBuf) {
    let launches = temp.path().join("launches");
    let script = temp.path().join("failing-agent");
    let body = r#"#!/bin/sh
echo launch >> "LAUNCHES"
while read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/^{"id":\([0-9]*\).*/\1/p')
  printf '{"id":%s,"ok":false,"error":"OBS failed to start."}\n' "$id"
done
"#;
    std::fs::write(
        &script,
        body.replace("LAUNCHES", launches.to_str().unwrap()),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    (script, launches)
}

fn launches(log: &Path) -> usize {
    std::fs::read_to_string(log).map_or(0, |text| text.lines().count())
}

fn options(temp: &TempDir, agent: PathBuf) -> RecorderHostOptions {
    let mut options = RecorderHostOptions::new(agent, temp.path().join("state"))
        .heartbeat_interval(Duration::ZERO);
    options.shutdown_request_timeout = Duration::from_millis(500);
    options.graceful_exit_timeout = Duration::from_millis(500);
    options
}

#[tokio::test]
async fn requests_wait_out_a_failed_start() {
    let temp = TempDir::new().unwrap();
    let (agent, log) = failing_agent(&temp);
    let mut options = options(&temp, agent);
    options.respawn_delay = Duration::from_millis(300);
    options.max_respawn_backoff = Duration::from_millis(600);
    // Only requests start the agent in this test.
    options.max_consecutive_respawns = 0;
    let host = RecorderHost::new(options).unwrap();

    let first = host.list_displays().await.unwrap_err().to_string();
    assert!(first.contains("OBS failed to start."), "{first}");
    assert_eq!(launches(&log), 1);

    // Polling requests, like the audio meter heartbeat, get the same failure
    // back instead of launching another agent.
    for _ in 0..10 {
        let error = host.subscribe_audio_levels().await.unwrap_err();
        assert_eq!(error.to_string(), first);
    }
    assert_eq!(launches(&log), 1);

    // After the window a request tries again, and the next window is longer.
    tokio::time::sleep(Duration::from_millis(350)).await;
    host.list_displays().await.unwrap_err();
    assert_eq!(launches(&log), 2);
    tokio::time::sleep(Duration::from_millis(350)).await;
    host.list_displays().await.unwrap_err();
    assert_eq!(launches(&log), 2);

    // Saving settings and restarting each get one attempt at once.
    host.set_settings(host.get_settings().await).await.unwrap();
    host.configure().await.unwrap_err();
    assert_eq!(launches(&log), 3);
    host.restart().await.unwrap_err();
    assert_eq!(launches(&log), 4);

    host.shutdown().await;
}

#[tokio::test]
async fn automatic_respawns_stop_after_the_limit() {
    let temp = TempDir::new().unwrap();
    let (agent, log) = failing_agent(&temp);
    let mut options = options(&temp, agent);
    options.respawn_delay = Duration::from_millis(50);
    options.max_respawn_backoff = Duration::from_millis(100);
    options.max_consecutive_respawns = 2;
    let host = RecorderHost::new(options).unwrap();

    host.list_displays().await.unwrap_err();
    tokio::time::sleep(Duration::from_secs(2)).await;
    // The request's launch plus two respawns.
    assert_eq!(launches(&log), 3);

    host.shutdown().await;
}
