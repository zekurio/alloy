fn emit_event(event: RecordingEvent) {
    let envelope = EventEnvelope { event };
    if let Ok(line) = serde_json::to_string(&envelope) {
        println!("{line}");
        let _ = io::stdout().flush();
    }
}

fn response_ok<T: Serialize>(id: u64, result: T) -> Response {
    Response {
        id,
        ok: true,
        result: Some(serde_json::to_value(result).unwrap_or_else(|_| json!(null))),
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
            println!("{line}");
            let _ = io::stdout().flush();
        }
        Err(error) => eprintln!("[{SIDE_CAR_NAME}] failed to serialize response: {error}"),
    }
}

fn handle_request(recorder: &mut Recorder, request: Request) -> Response {
    match request.method.as_str() {
        "version" => response_ok(
            request.id,
            SidecarVersion {
                name: SIDE_CAR_NAME,
                version: env!("CARGO_PKG_VERSION"),
                protocol_version: RECORDER_PROTOCOL_VERSION,
                capabilities: &[
                    "game-capture",
                    "audio-devices",
                    "audio-applications",
                    "game-processes",
                    "replay-buffer",
                ],
            },
        ),
        "configure" => match serde_json::from_value::<ConfigureParams>(request.params) {
            Ok(params) => match recorder.configure(params) {
                Ok(status) => response_ok(request.id, status),
                Err(error) => response_error(request.id, error, recorder.status()),
            },
            Err(error) => response_error(
                request.id,
                format!("Invalid configure params: {error}"),
                recorder.status(),
            ),
        },
        "status" => response_ok(request.id, recorder.status()),
        "listGameProcesses" => response_ok(request.id, list_game_processes()),
        "saveReplayClip" => response_ok(request.id, recorder.save_replay_clip()),
        "stopRecording" => response_ok(request.id, recorder.stop_recording()),
        "shutdown" => {
            recorder.shutdown();
            response_ok(request.id, recorder.status())
        }
        method => response_error(
            request.id,
            format!("Unknown recording sidecar method: {method}"),
            recorder.status(),
        ),
    }
}

fn detect_game_activity(
    active_game: Option<&DetectedGame>,
    settings: &RecordingSettings,
) -> Option<GameDetection> {
    platform_detect_game_activity(active_game, settings)
}

fn is_detected_game_alive(game: &DetectedGame) -> bool {
    platform_process_alive(game.game.process_id)
}

fn refresh_capture_metadata(game: &mut DetectedGame) {
    platform_refresh_capture_metadata(game);
}

fn platform_refresh_capture_metadata(game: &mut DetectedGame) {
    windows_detector::refresh_capture_metadata(game);
}

fn application_icon_url(path: &str) -> Option<String> {
    windows_detector::application_icon_data_url(path)
}

fn application_display_name(path: &str) -> Option<String> {
    windows_detector::application_display_name(path)
}

fn platform_audio_applications() -> Vec<RecordingAudioApplicationSelection> {
    windows_detector::audio_applications()
}

fn list_game_processes() -> Vec<RecordingGameProcess> {
    windows_detector::game_processes()
}

fn primary_display_dimensions() -> Option<VideoDimensions> {
    platform_primary_display_dimensions()
}

fn primary_display_id() -> Option<String> {
    platform_primary_display_id()
}

fn platform_primary_display_dimensions() -> Option<VideoDimensions> {
    windows_detector::primary_display_dimensions()
}

fn platform_primary_display_id() -> Option<String> {
    windows_detector::primary_display_id()
}

fn detected_game_from_parts(
    process_id: u32,
    path: Option<String>,
    title: Option<String>,
    class_name: Option<String>,
    window_key: String,
    window_handle: isize,
    fullscreen: bool,
    obs_window: Option<String>,
    capture_dimensions: Option<VideoDimensions>,
    hdr_enabled: bool,
    settings: &RecordingSettings,
) -> Option<DetectedGame> {
    let executable = path.as_deref().and_then(path_file_name);
    let match_ = candidate_game_detection_match(
        path.as_deref(),
        executable.as_deref(),
        title.as_deref(),
        class_name.as_deref(),
        capture_dimensions,
        settings,
    )?;
    let name = readable_detected_game_name(
        &match_,
        path.as_deref(),
        title.as_deref(),
        executable.as_deref(),
    );

    Some(DetectedGame {
        game: RecordingGame {
            id: match_.id,
            name,
            process_id,
            executable,
            icon_url: path.as_deref().and_then(application_icon_url),
            path,
            window_title: title,
            window_class: class_name,
            started_at: Some(now_iso()),
        },
        obs_window,
        window_key,
        window_handle,
        fullscreen,
        force_display_capture: match_.force_display_capture,
        capture_dimensions,
        hdr_enabled,
        detection_score: match_.detection_score,
    })
}

fn match_allowed_game<'a>(
    allowed_games: &'a [RecordingAllowedGame],
    path: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> Option<&'a RecordingAllowedGame> {
    allowed_games
        .iter()
        .filter(|game| allowed_game_matches(game, path, executable, class_name))
        .max_by_key(|game| allowed_game_match_score(game, path, executable, class_name))
}

fn normalized_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn allowed_game_matches(
    game: &RecordingAllowedGame,
    path: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> bool {
    allowed_game_match_score(game, path, executable, class_name) > 0
}

fn detected_game_allowed(
    detected: &DetectedGame,
    settings: &RecordingSettings,
) -> bool {
    detected_game_still_allowed(detected, settings)
}

fn path_file_name(path: &str) -> Option<String> {
    path.rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
}

fn allowed_game_match_score(
    game: &RecordingAllowedGame,
    path: Option<&str>,
    executable: Option<&str>,
    class_name: Option<&str>,
) -> i32 {
    if let Some(allowed_path) = game.path.as_deref() {
        return if path.is_some_and(|candidate_path| paths_equal(allowed_path, candidate_path)) {
            100
        } else {
            0
        };
    }

    if let (Some(allowed_executable), Some(candidate_executable)) =
        (game.executable.as_deref(), executable)
    {
        if allowed_executable.eq_ignore_ascii_case(candidate_executable) {
            return 80;
        }
    }

    if let (Some(allowed_class), Some(candidate_class)) =
        (game.window_class.as_deref(), class_name)
    {
        if allowed_class.eq_ignore_ascii_case(candidate_class) {
            return 60;
        }
    }

    0
}

fn paths_equal(left: &str, right: &str) -> bool {
    normalized_path(left)
        .trim_end_matches('/')
        .eq_ignore_ascii_case(normalized_path(right).trim_end_matches('/'))
}

fn file_slug(value: &str) -> String {
    let slug: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    slug.split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn file_component(value: &str, fallback: &str) -> String {
    let mut component = String::new();
    let mut previous_was_separator = false;

    for ch in value.trim().chars() {
        let replacement = if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            '-'
        } else {
            ch
        };

        if replacement == '-' || replacement.is_whitespace() {
            if !previous_was_separator && !component.is_empty() {
                component.push(if replacement.is_whitespace() { ' ' } else { '-' });
                previous_was_separator = true;
            }
            continue;
        }

        component.push(replacement);
        previous_was_separator = false;
    }

    let component = component.trim_matches([' ', '.', '-']).to_string();
    if component.is_empty() || is_reserved_windows_name(&component) {
        fallback.to_string()
    } else {
        component
    }
}

fn is_reserved_windows_name(value: &str) -> bool {
    let base = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn platform_detect_game_activity(
    active_game: Option<&DetectedGame>,
    settings: &RecordingSettings,
) -> Option<GameDetection> {
    windows_detector::detect_game_activity(active_game, settings)
}

fn platform_process_alive(process_id: u32) -> bool {
    windows_detector::process_alive(process_id)
}

fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

include!("sidecar_runtime_windows.rs");
include!("sidecar_runtime_tests.rs");
fn main() {
    let (tx, rx) = mpsc::channel::<Request>();
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

            let request = serde_json::from_str::<Request>(&line);
            match request {
                Ok(request) => {
                    if tx.send(request).is_err() {
                        break;
                    }
                }
                Err(error) => eprintln!("[{SIDE_CAR_NAME}] invalid request: {error}"),
            }
        }
    });

    let mut recorder = Recorder::default();

    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(request) => {
                let should_shutdown = request.method == "shutdown";
                write_response(handle_request(&mut recorder, request));
                if should_shutdown {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => recorder.tick(),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    recorder.shutdown();
}

include!("sidecar_runtime_recording.rs");
