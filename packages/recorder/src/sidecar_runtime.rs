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
                    "desktop-capture",
                    "audio-devices",
                    "audio-applications",
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

const MIN_GAME_WINDOW_WIDTH: u32 = 320;
const MIN_GAME_WINDOW_HEIGHT: u32 = 200;
const MIN_GAME_WINDOW_AREA: u32 = 160_000;

#[derive(Clone, Copy)]
struct KnownGameDetection {
    name: &'static str,
    executables: &'static [&'static str],
    path_markers: &'static [&'static str],
}

const KNOWN_GAME_DETECTIONS: &[KnownGameDetection] = &[
    KnownGameDetection {
        name: "Apex Legends",
        executables: &["r5apex.exe"],
        path_markers: &["/steamapps/common/apex legends/"],
    },
    KnownGameDetection {
        name: "Counter-Strike 2",
        executables: &["cs2.exe"],
        path_markers: &["/steamapps/common/counter-strike global offensive/"],
    },
    KnownGameDetection {
        name: "Dota 2",
        executables: &["dota2.exe"],
        path_markers: &["/steamapps/common/dota 2 beta/"],
    },
    KnownGameDetection {
        name: "Elden Ring",
        executables: &["eldenring.exe"],
        path_markers: &["/steamapps/common/elden ring/"],
    },
    KnownGameDetection {
        name: "Fortnite",
        executables: &["fortniteclient-win64-shipping.exe"],
        path_markers: &["/fortnite/fortnitegame/binaries/win64/"],
    },
    KnownGameDetection {
        name: "Grand Theft Auto V",
        executables: &["gta5.exe", "gta5_enhanced.exe"],
        path_markers: &["/steamapps/common/grand theft auto v/", "/grand theft auto v/"],
    },
    KnownGameDetection {
        name: "Helldivers 2",
        executables: &["helldivers2.exe"],
        path_markers: &["/steamapps/common/helldivers 2/"],
    },
    KnownGameDetection {
        name: "League of Legends",
        executables: &["league of legends.exe"],
        path_markers: &["/riot games/league of legends/"],
    },
    KnownGameDetection {
        name: "Minecraft",
        executables: &["minecraft.windows.exe", "javaw.exe"],
        path_markers: &["/.minecraft/", "/minecraft launcher/runtime/"],
    },
    KnownGameDetection {
        name: "Overwatch 2",
        executables: &["overwatch.exe"],
        path_markers: &["/overwatch/"],
    },
    KnownGameDetection {
        name: "Roblox",
        executables: &["robloxplayerbeta.exe", "win10universal.exe"],
        path_markers: &["/roblox/versions/", "/robloxcorporation/"],
    },
    KnownGameDetection {
        name: "Rocket League",
        executables: &["rocketleague.exe"],
        path_markers: &["/rocketleague/binaries/win64/"],
    },
    KnownGameDetection {
        name: "Valorant",
        executables: &["valorant-win64-shipping.exe"],
        path_markers: &["/riot games/valorant/live/shootergame/binaries/win64/"],
    },
];

const NON_GAME_EXECUTABLES: &[&str] = &[
    "1password",
    "1password.exe",
    "1password-browsersupport.exe",
    "alloy",
    "alloy.exe",
    "alloy-recorder.exe",
    "applicationframehost.exe",
    "battle.net.exe",
    "cmd.exe",
    "codex",
    "codex.exe",
    "code - insiders.exe",
    "code.exe",
    "cursor.exe",
    "discord.exe",
    "dwm.exe",
    "electron",
    "electron.exe",
    "epicgameslauncher.exe",
    "explorer.exe",
    "firefox.exe",
    "gog galaxy",
    "goggalaxy.exe",
    "chrome.exe",
    "msedge.exe",
    "obs32.exe",
    "obs64.exe",
    "powershell",
    "riotclientservices.exe",
    "searchhost.exe",
    "shellexperiencehost.exe",
    "slack.exe",
    "spotify.exe",
    "startmenuexperiencehost.exe",
    "steam.exe",
    "teams.exe",
    "textinputhost.exe",
    "wezterm",
    "windowsterminal",
    "windsurf.exe",
    "xboxapp.exe",
    "xboxpcapp.exe",
];

const NON_GAME_PATH_MARKERS: &[&str] = &[
    "/1password/",
    "/appdata/local/programs/microsoft vs code/",
    "/appdata/local/programs/codex/",
    "/appdata/local/1password/",
    "/appdata/local/discord/",
    "/appdata/local/slack/",
    "/common files/",
    "/epic games/launcher/",
    "/gog galaxy/",
    "/google/chrome/",
    "/internet explorer/",
    "/microsoft/edge/application/",
    "/microsoft/teams/",
    "/obs-studio/",
    "/riot client/",
    "/steam/bin/",
    "/steam/package/",
    "/steam/steamapps/downloading/",
    "/steam/steamapps/workshop/",
    "/windows/system32/",
    "/windows/syswow64/",
];

const BLOCKED_WINDOW_WORDS: &[&str] = &[
    "splash",
    "splashscreen",
    "splashwindow",
    "launcher",
    "updater",
    "setup",
    "installer",
    "crash",
    "console",
    "cheat",
    "overlay",
    "devtools",
];

const WHITELISTED_GAME_CLASS_MARKERS: &[&str] = &[
    "steam_app_",
    "unitywndclass",
    "unrealwindow",
    "riotwindowclass",
    "cryengine",
    "sdl_app",
    "glfw",
    "lwjgl",
    "godot",
    "winit",
    "monogame",
    "xna",
    "valve001",
];

fn detect_game_activity(active_game: Option<&DetectedGame>) -> Option<GameDetection> {
    platform_detect_game_activity(active_game)
}

fn is_detected_game_alive(game: &DetectedGame) -> bool {
    platform_process_alive(game.game.process_id)
}

fn platform_audio_applications() -> Vec<RecordingAudioApplicationSelection> {
    #[cfg(windows)]
    {
        windows_detector::audio_applications()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

fn primary_display_dimensions() -> Option<VideoDimensions> {
    platform_primary_display_dimensions()
}

fn primary_display_id() -> Option<String> {
    platform_primary_display_id()
}

#[cfg(windows)]
fn platform_primary_display_dimensions() -> Option<VideoDimensions> {
    windows_detector::primary_display_dimensions()
}

#[cfg(windows)]
fn platform_primary_display_id() -> Option<String> {
    windows_detector::primary_display_id()
}

#[cfg(not(windows))]
fn platform_primary_display_dimensions() -> Option<VideoDimensions> {
    None
}

#[cfg(not(windows))]
fn platform_primary_display_id() -> Option<String> {
    None
}

fn detected_game_from_parts(
    process_id: u32,
    path: Option<String>,
    title: Option<String>,
    class_name: Option<String>,
    window_key: String,
    fullscreen: bool,
    obs_window: Option<String>,
    capture_dimensions: Option<VideoDimensions>,
) -> Option<DetectedGame> {
    let executable = path.as_deref().and_then(path_file_name);
    let classification = classify_game_candidate(
        path.as_deref(),
        executable.as_deref(),
        title.as_deref(),
        class_name.as_deref(),
        fullscreen,
        capture_dimensions,
    )?;
    let name = title
        .clone()
        .filter(|title| !title.trim().is_empty())
        .or(classification.name)
        .or_else(|| executable.clone())
        .unwrap_or_else(|| format!("Game {process_id}"));
    Some(DetectedGame {
        game: RecordingGame {
            id: None,
            name,
            process_id,
            executable,
            path,
            window_title: title,
            window_class: class_name,
            started_at: Some(now_iso()),
        },
        obs_window,
        window_key,
        capture_dimensions,
        detection_score: classification.score,
    })
}

#[derive(Clone, Debug)]
struct GameCandidateClassification {
    score: i32,
    name: Option<String>,
}

fn classify_game_candidate(
    path: Option<&str>,
    executable: Option<&str>,
    title: Option<&str>,
    class_name: Option<&str>,
    fullscreen: bool,
    dimensions: Option<VideoDimensions>,
) -> Option<GameCandidateClassification> {
    let executable = executable.unwrap_or_default().to_ascii_lowercase();
    let normalized_path = normalized_path(path.unwrap_or_default());
    let path_lower = normalized_path.to_ascii_lowercase();
    let title_lower = title.unwrap_or_default().to_ascii_lowercase();
    let class_name = class_name.unwrap_or_default().to_ascii_lowercase();
    if executable.is_empty() && class_name.is_empty() && path_lower.is_empty() {
        return None;
    }

    if path_lower.starts_with("c:/windows/") || path_lower.starts_with("/windows/") {
        return None;
    }

    if is_known_non_game_candidate(&path_lower, &executable, &class_name) {
        return None;
    }

    if BLOCKED_WINDOW_WORDS.iter().any(|blocked| {
        title_lower.contains(blocked)
            || class_name.contains(blocked)
            || executable.contains(blocked)
    }) {
        return None;
    }

    let valid_window = dimensions.is_some_and(is_valid_game_window_dimensions);
    let valid_aspect = dimensions.is_some_and(is_valid_game_aspect_ratio);

    if let Some(name) = known_game_name_from_path(&path_lower, &executable) {
        return Some(GameCandidateClassification {
            score: if valid_window { 95 } else { 75 },
            name: Some(name.to_string()),
        });
    }

    if let Some(name) = steam_game_name_from_path(path.unwrap_or_default()) {
        return Some(GameCandidateClassification {
            score: if valid_window { 90 } else { 80 },
            name: Some(name),
        });
    }

    if let Some(name) = xbox_game_name_from_path(path.unwrap_or_default()) {
        return Some(GameCandidateClassification {
            score: if valid_window { 88 } else { 78 },
            name: Some(name),
        });
    }

    if let Some(name) = store_game_name_from_path(
        path.unwrap_or_default(),
        &[
            "/epic games/",
            "/gog galaxy/games/",
            "/ea games/",
            "/ubisoft/ubisoft game launcher/games/",
        ],
    ) {
        return Some(GameCandidateClassification {
            score: if valid_window { 84 } else { 72 },
            name: Some(name),
        });
    }

    let normalized_class_name = class_name.replace(' ', "");
    let has_game_window_class = WHITELISTED_GAME_CLASS_MARKERS
        .iter()
        .any(|marker| normalized_class_name.contains(marker));
    if valid_window && valid_aspect && has_game_window_class {
        return Some(GameCandidateClassification {
            score: 72,
            name: None,
        });
    }

    if fullscreen
        && valid_window
        && valid_aspect
        && has_probable_game_path_marker(&path_lower)
        && (has_game_window_class || has_game_executable_shape(&executable, &path_lower))
    {
        return Some(GameCandidateClassification {
            score: 55,
            name: None,
        });
    }

    None
}

fn is_valid_game_window_dimensions(dimensions: VideoDimensions) -> bool {
    dimensions.width >= MIN_GAME_WINDOW_WIDTH
        && dimensions.height >= MIN_GAME_WINDOW_HEIGHT
        && dimensions
            .width
            .saturating_mul(dimensions.height)
            >= MIN_GAME_WINDOW_AREA
}

fn is_valid_game_aspect_ratio(dimensions: VideoDimensions) -> bool {
    if dimensions.height == 0 {
        return false;
    }
    let aspect_ratio = dimensions.width as f32 / dimensions.height as f32;
    (1.20..=3.80).contains(&aspect_ratio)
}

fn normalized_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn is_known_non_game_candidate(path_lower: &str, executable: &str, class_name: &str) -> bool {
    if NON_GAME_EXECUTABLES
        .iter()
        .any(|blocked| executable == *blocked || class_name.contains(blocked))
    {
        return true;
    }

    NON_GAME_PATH_MARKERS
        .iter()
        .any(|marker| path_lower.contains(marker))
}

fn known_game_name_from_path(path_lower: &str, executable: &str) -> Option<&'static str> {
    KNOWN_GAME_DETECTIONS.iter().find_map(|game| {
        let executable_match = game
            .executables
            .iter()
            .any(|candidate| executable == *candidate);
        let path_match = game
            .path_markers
            .iter()
            .any(|marker| path_lower.contains(marker));
        (path_match || (executable_match && executable != "javaw.exe")).then_some(game.name)
    })
}

fn has_game_executable_shape(executable: &str, path_lower: &str) -> bool {
    if !executable.ends_with(".exe") {
        return false;
    }

    let file_stem = executable.trim_end_matches(".exe");
    let executable_looks_like_runtime =
        matches!(file_stem, "game" | "client" | "shipping" | "win64" | "win32" | "main");
    !executable_looks_like_runtime
        && path_lower.contains("/binaries/")
        && (path_lower.contains("/win64/") || path_lower.contains("/win32/"))
}

fn path_file_name(path: &str) -> Option<String> {
    path.rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
}

fn clean_game_name(value: &str) -> Option<String> {
    let name = value.trim().trim_matches('"').trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn store_game_name_from_path(path: &str, markers: &[&str]) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    markers.iter().find_map(|marker| {
        let marker_index = lower.find(marker)?;
        let start = marker_index + marker.len();
        normalized[start..]
            .split('/')
            .next()
            .and_then(clean_game_name)
    })
}

fn has_probable_game_path_marker(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    [
        "/steamapps/common/",
        "/epic games/",
        "/gog galaxy/games/",
        "/ea games/",
        "/ubisoft/ubisoft game launcher/games/",
        "/windowsapps/",
        "/xboxgames/",
        "/binaries/win64/",
        "/binaries/win32/",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn steam_game_name_from_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    let marker = "/steamapps/common/";
    let marker_index = lower.find(marker)?;
    let install_dir_start = marker_index + marker.len();
    let install_dir = normalized[install_dir_start..]
        .split('/')
        .next()
        .and_then(clean_game_name)?;

    let steamapps_dir = &normalized[..marker_index + "/steamapps".len()];
    if let Ok(entries) = fs::read_dir(Path::new(steamapps_dir)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("acf") {
                continue;
            }
            let Ok(contents) = fs::read_to_string(path) else {
                continue;
            };
            let Some(acf_install_dir) = extract_acf_value(&contents, "installdir") else {
                continue;
            };
            if acf_install_dir.eq_ignore_ascii_case(&install_dir) {
                return extract_acf_value(&contents, "name").or(Some(install_dir));
            }
        }
    }

    Some(install_dir)
}

fn extract_acf_value(contents: &str, key: &str) -> Option<String> {
    for line in contents.lines() {
        let trimmed = line.trim();
        let values = quoted_values(trimmed);
        if values.first().copied() == Some(key) {
            return values.get(1).and_then(|value| clean_game_name(value));
        }
    }
    None
}

fn quoted_values(value: &str) -> Vec<&str> {
    let mut values = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find('"') {
        rest = &rest[start + 1..];
        let Some(end) = rest.find('"') else {
            break;
        };
        values.push(&rest[..end]);
        rest = &rest[end + 1..];
    }
    values
}

fn xbox_game_name_from_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    let marker = "/windowsapps/";
    let marker_index = lower.find(marker)?;
    let package_start = marker_index + marker.len();
    let package_name = normalized[package_start..]
        .split('/')
        .next()
        .and_then(clean_game_name)?;
    let package_dir = &normalized[..package_start + package_name.len()];
    let config_path = Path::new(package_dir).join("MicrosoftGame.config");
    if let Ok(contents) = fs::read_to_string(config_path) {
        if let Some(name) = extract_xml_attribute(&contents, "DefaultDisplayName") {
            return Some(name);
        }
    }
    package_name
        .split('_')
        .next()
        .and_then(clean_game_name)
}

fn extract_xml_attribute(contents: &str, attribute: &str) -> Option<String> {
    let needle = format!("{attribute}=\"");
    let start = contents.find(&needle)? + needle.len();
    let value = contents[start..].split('"').next()?;
    clean_game_name(value)
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

#[cfg(windows)]
fn platform_detect_game_activity(active_game: Option<&DetectedGame>) -> Option<GameDetection> {
    windows_detector::detect_game_activity(active_game)
}

#[cfg(not(windows))]
fn platform_detect_game_activity(active_game: Option<&DetectedGame>) -> Option<GameDetection> {
    linux_detect_game_activity(active_game)
}

#[cfg(windows)]
fn platform_process_alive(process_id: u32) -> bool {
    windows_detector::process_alive(process_id)
}

#[cfg(not(windows))]
fn platform_process_alive(process_id: u32) -> bool {
    Path::new(&format!("/proc/{process_id}")).exists()
}

#[cfg(not(windows))]
fn linux_detect_game_activity(_active_game: Option<&DetectedGame>) -> Option<GameDetection> {
    let active = command_output("sh", &["-c", "xprop -root _NET_ACTIVE_WINDOW 2>/dev/null"])
        .and_then(|output| output.split_whitespace().last().map(str::to_string))?;
    if active == "0x0" {
        return None;
    }
    let props = command_output("xprop", &["-id", &active]).unwrap_or_default();
    let process_id = extract_xprop_u32(&props, "_NET_WM_PID")?;
    let title = extract_xprop_string(&props, "_NET_WM_NAME")
        .or_else(|| extract_xprop_string(&props, "WM_NAME"));
    let class_name = extract_xprop_class(&props);
    let fullscreen = props.contains("_NET_WM_STATE_FULLSCREEN");
    let path = fs::read_link(format!("/proc/{process_id}/exe"))
        .ok()
        .map(|path| path.to_string_lossy().into_owned());
    let obs_window = Some(format!(
        "{active}\r\n{}\r\n{}",
        title.clone().unwrap_or_default(),
        class_name.clone().unwrap_or_default()
    ));
    let game = detected_game_from_parts(
        process_id, path, title, class_name, active, fullscreen, obs_window, None,
    )?;
    Some(GameDetection {
        game,
        focused: true,
    })
}

fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(not(windows))]
fn extract_xprop_u32(props: &str, key: &str) -> Option<u32> {
    props
        .lines()
        .find(|line| line.starts_with(key))
        .and_then(|line| line.split('=').nth(1))
        .and_then(|value| value.trim().parse::<u32>().ok())
}

#[cfg(not(windows))]
fn extract_xprop_string(props: &str, key: &str) -> Option<String> {
    props
        .lines()
        .find(|line| line.starts_with(key))
        .and_then(|line| line.split('"').nth(1))
        .map(str::to_string)
}

#[cfg(not(windows))]
fn extract_xprop_class(props: &str) -> Option<String> {
    props
        .lines()
        .find(|line| line.starts_with("WM_CLASS"))
        .and_then(|line| line.rsplit('"').nth(1))
        .map(str::to_string)
}

#[cfg(windows)]
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
