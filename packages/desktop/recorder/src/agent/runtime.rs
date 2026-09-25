use std::{
    collections::VecDeque,
    fs,
    io::{self, BufRead, Write},
    path::Path,
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::json;

use crate::{
    agent::{
        notification_sounds::play_notification_sound,
        platform::{
            hotkeys, list_displays, list_game_processes, stop_audio_level_events,
            subscribe_audio_level_events,
        },
        recorder::Recorder,
        time::timestamp_millis,
        watchdog::RecorderProgress,
    },
    protocol::{RECORDER_PROTOCOL_VERSION, SIDE_CAR_NAME},
    types::{
        ConfigureParams, PlayNotificationSoundParams, RecordingStatus, Request, Response,
        SaveReplayClipParams, SidecarVersion,
    },
};

const TICK_INTERVAL: Duration = Duration::from_millis(500);

fn response_ok<T: Serialize>(
    id: u64,
    result: T,
    status: impl FnOnce() -> RecordingStatus,
) -> Response {
    let result = match serde_json::to_value(result) {
        Ok(value) => value,
        Err(error) => {
            return response_error(
                id,
                format!("Failed to serialize response: {error}"),
                status(),
            );
        }
    };

    Response {
        id,
        ok: true,
        result: Some(result),
        error: None,
        status: None,
    }
}

fn response_error(id: u64, error: String, status: RecordingStatus) -> Response {
    Response {
        id,
        ok: false,
        result: None,
        error: Some(error),
        status: Some(status),
    }
}

fn write_response(response: Response) {
    match serde_json::to_string(&response) {
        Ok(line) => {
            let _ = writeln!(io::stdout().lock(), "{line}");
            let _ = io::stdout().flush();
        }
        Err(error) => eprintln!("[{SIDE_CAR_NAME}] failed to serialize response: {error}"),
    }
}

fn sidecar_version() -> SidecarVersion {
    SidecarVersion {
        name: SIDE_CAR_NAME,
        version: env!("CARGO_PKG_VERSION"),
        protocol_version: RECORDER_PROTOCOL_VERSION,
        capabilities: &[
            "screenshots",
            "game-capture",
            "audio-devices",
            "audio-applications",
            "game-processes",
            "display-capture",
            "displays",
            "replay-buffer",
            "notification-sounds",
            "audio-levels",
            "telemetry",
        ],
    }
}

/// Requests the stdin thread can answer immediately without the recorder.
/// Status is served from the shared snapshot so reads stay instant even while
/// the recorder thread is busy starting/stopping OBS outputs. Audio level
/// metering runs on its own thread, so subscriptions also bypass the recorder
/// (which can block for seconds while OBS outputs start).
fn handle_io_request(request: &Request, status: &Mutex<RecordingStatus>) -> Option<Response> {
    match request.method.as_str() {
        "version" => Some(response_ok(request.id, sidecar_version(), || {
            snapshot_status(status)
        })),
        "status" => Some(response_ok(request.id, snapshot_status(status), || {
            snapshot_status(status)
        })),
        "subscribeAudioLevels" => {
            subscribe_audio_level_events();
            Some(response_ok(request.id, json!(null), || {
                snapshot_status(status)
            }))
        }
        "stopAudioLevels" => {
            stop_audio_level_events();
            Some(response_ok(request.id, json!(null), || {
                snapshot_status(status)
            }))
        }
        "playNotificationSound" => Some(
            match serde_json::from_value::<PlayNotificationSoundParams>(request.params.clone()) {
                Ok(params) => match play_notification_sound(params) {
                    Ok(()) => response_ok(request.id, json!(null), || snapshot_status(status)),
                    Err(error) => response_error(request.id, error, snapshot_status(status)),
                },
                Err(error) => response_error(
                    request.id,
                    format!("Invalid notification sound params: {error}"),
                    snapshot_status(status),
                ),
            },
        ),
        _ => None,
    }
}

fn snapshot_status(status: &Mutex<RecordingStatus>) -> RecordingStatus {
    match status.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn publish_status(status: &Mutex<RecordingStatus>, recorder: &Recorder) {
    let next = recorder.status();
    match status.lock() {
        Ok(mut guard) => *guard = next,
        Err(poisoned) => *poisoned.into_inner() = next,
    }
}

fn handle_request(recorder: &mut Recorder, request: Request) -> Response {
    match request.method.as_str() {
        "configure" => match serde_json::from_value::<ConfigureParams>(request.params) {
            Ok(params) => match prepare_agent_state(&params.agent_state_folder)
                .and_then(|()| recorder.configure(params))
            {
                Ok(status) => response_ok(request.id, status, || recorder.status()),
                Err(error) => response_error(request.id, error, recorder.status()),
            },
            Err(error) => response_error(
                request.id,
                format!("Invalid configure params: {error}"),
                recorder.status(),
            ),
        },
        "listGameProcesses" => response_ok(request.id, list_game_processes(), || recorder.status()),
        "listDisplays" => response_ok(request.id, list_displays(), || recorder.status()),
        "saveScreenshot" => {
            let result = recorder.save_screenshot();
            response_ok(request.id, result, || recorder.status())
        }
        "saveReplayClip" => match serde_json::from_value::<SaveReplayClipParams>(request.params) {
            Ok(params) => {
                let result = recorder.save_replay_clip(params);
                response_ok(request.id, result, || recorder.status())
            }
            Err(error) => response_error(
                request.id,
                format!("Invalid replay clip params: {error}"),
                recorder.status(),
            ),
        },
        "shutdown" => {
            recorder.shutdown();
            response_ok(request.id, recorder.status(), || recorder.status())
        }
        method => response_error(
            request.id,
            format!("Unknown Alloy agent method: {method}"),
            recorder.status(),
        ),
    }
}

fn prepare_agent_state(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path.join("jobs")).map_err(|error| {
        format!(
            "Failed to create Alloy agent state folder {}: {error}",
            path.display()
        )
    })
}

struct RecorderRequest {
    request: Request,
    superseded_configure_ids: Vec<u64>,
}

fn recv_recorder_request(
    rx: &mpsc::Receiver<Request>,
    pending: &mut VecDeque<Request>,
    timeout: Duration,
) -> Result<RecorderRequest, mpsc::RecvTimeoutError> {
    let request = match pending.pop_front() {
        Some(request) => request,
        None => rx.recv_timeout(timeout)?,
    };

    if request.method == "configure" {
        return Ok(coalesce_configure_requests(rx, pending, request));
    }

    Ok(RecorderRequest {
        request,
        superseded_configure_ids: Vec::new(),
    })
}

fn coalesce_configure_requests(
    rx: &mpsc::Receiver<Request>,
    pending: &mut VecDeque<Request>,
    first: Request,
) -> RecorderRequest {
    let mut request = first;
    let mut superseded_configure_ids = Vec::new();

    while let Some(next) = pending.pop_front().or_else(|| rx.try_recv().ok()) {
        if next.method == "configure" {
            superseded_configure_ids.push(request.id);
            request = next;
            continue;
        }

        pending.push_back(next);
        break;
    }

    RecorderRequest {
        request,
        superseded_configure_ids,
    }
}

fn response_for_id(response: &Response, id: u64) -> Response {
    Response {
        id,
        ok: response.ok,
        result: response.result.clone(),
        error: response.error.clone(),
        status: response.status.clone(),
    }
}

fn request_expired(request: &Request, now_unix_ms: u128) -> bool {
    request.method != "configure"
        && request
            .deadline_unix_ms
            .is_some_and(|deadline| now_unix_ms >= u128::from(deadline))
}

/// Runs the agent: hotkey hook, watchdog, stdin request loop.
pub fn run() {
    hotkeys::start();
    let (tx, rx) = mpsc::channel::<Request>();
    let status = Arc::new(Mutex::new(Recorder::default().status()));
    // Allow normal configure and output shutdown work to finish. If OBS blocks
    // beyond this deadline, exit so the desktop host can start a fresh recorder.
    let progress = Arc::new(RecorderProgress::new(
        Instant::now(),
        Duration::from_secs(90),
    ));
    let watched_progress = Arc::clone(&progress);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        if watched_progress.stalled(Instant::now()) {
            eprintln!(
                "[{SIDE_CAR_NAME}] recorder made no progress for 90 seconds; exiting for recovery"
            );
            // DLL shutdown handlers can wait on the blocked OBS thread too.
            // SAFETY: This is our own process. The desktop host owns its restart.
            unsafe {
                use windows_sys::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
                TerminateProcess(GetCurrentProcess(), 1);
            }
        }
    });

    let io_status = Arc::clone(&status);
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    eprintln!("[{SIDE_CAR_NAME}] failed to read stdin: {error}");
                    break;
                }
            };
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<Request>(&line) {
                Ok(request) => {
                    if let Some(response) = handle_io_request(&request, &io_status) {
                        write_response(response);
                        continue;
                    }
                    if tx.send(request).is_err() {
                        break;
                    }
                }
                Err(error) => eprintln!("[{SIDE_CAR_NAME}] invalid request: {error}"),
            }
        }
    });

    let mut recorder = Recorder::default();
    let mut pending_requests = VecDeque::new();
    let mut next_tick = Instant::now() + TICK_INTERVAL;

    loop {
        let timeout = next_tick.saturating_duration_since(Instant::now());
        match recv_recorder_request(&rx, &mut pending_requests, timeout) {
            Ok(batch) => {
                let expired = request_expired(&batch.request, timestamp_millis());
                let should_shutdown = !expired && batch.request.method == "shutdown";
                let response = if expired {
                    response_error(
                        batch.request.id,
                        format!(
                            "Alloy agent {} request expired before execution.",
                            batch.request.method
                        ),
                        recorder.status(),
                    )
                } else {
                    handle_request(&mut recorder, batch.request)
                };
                publish_status(&status, &recorder);
                progress.completed(Instant::now());
                for id in batch.superseded_configure_ids {
                    write_response(response_for_id(&response, id));
                }
                write_response(response);
                if should_shutdown {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        // Tick on a steady cadence so detection and output upkeep cannot be
        // starved by a busy request stream.
        if Instant::now() >= next_tick {
            recorder.tick();
            publish_status(&status, &recorder);
            progress.completed(Instant::now());
            next_tick = Instant::now() + TICK_INTERVAL;
        }
    }

    recorder.shutdown();
}

#[cfg(test)]
mod tests {
    use std::{collections::VecDeque, sync::mpsc, time::Duration};

    use serde_json::json;

    use super::{recv_recorder_request, request_expired, response_for_id};
    use crate::types::{Request, Response};

    fn request(id: u64, method: &str, deadline_unix_ms: Option<u64>) -> Request {
        Request {
            id,
            method: method.to_string(),
            params: json!(null),
            deadline_unix_ms,
        }
    }

    #[test]
    fn request_deadline_is_inclusive_and_does_not_expire_configure() {
        assert!(!request_expired(&request(1, "saveScreenshot", Some(10)), 9));
        assert!(request_expired(&request(1, "saveScreenshot", Some(10)), 10));
        assert!(!request_expired(&request(1, "saveScreenshot", None), 10));
        assert!(!request_expired(&request(1, "configure", Some(10)), 10));
    }

    #[test]
    fn configure_coalescing_stops_at_an_intervening_capture_request() {
        let (tx, rx) = mpsc::channel();
        tx.send(request(1, "configure", None)).unwrap();
        tx.send(request(2, "configure", None)).unwrap();
        tx.send(request(3, "saveScreenshot", None)).unwrap();
        tx.send(request(4, "configure", None)).unwrap();
        let mut pending = VecDeque::new();

        let first = recv_recorder_request(&rx, &mut pending, Duration::from_secs(0)).unwrap();
        assert_eq!(first.request.id, 2);
        assert_eq!(first.superseded_configure_ids, [1]);

        let capture = recv_recorder_request(&rx, &mut pending, Duration::from_secs(0)).unwrap();
        assert_eq!(capture.request.id, 3);

        let last = recv_recorder_request(&rx, &mut pending, Duration::from_secs(0)).unwrap();
        assert_eq!(last.request.id, 4);
    }

    #[test]
    fn superseded_response_changes_only_the_id() {
        let response = Response {
            id: 9,
            ok: false,
            result: None,
            error: Some("configuration failed".to_string()),
            status: None,
        };

        let superseded = response_for_id(&response, 7);

        assert_eq!(superseded.id, 7);
        assert_eq!(superseded.ok, response.ok);
        assert_eq!(superseded.result, response.result);
        assert_eq!(superseded.error, response.error);
        assert_eq!(superseded.status, response.status);
    }
}
