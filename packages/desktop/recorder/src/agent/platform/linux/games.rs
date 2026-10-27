//! Game detection from `/proc`. Wayland tells clients nothing about other
//! applications' windows, so a running allowed game counts as the focused
//! one. Only the user's own processes are visible in enough detail to match.

use std::{collections::HashSet, fs, os::unix::fs::MetadataExt};

use super::desktop_entries::desktop_application;
use crate::agent::{
    game_matching::{
        candidate_game_detection_match, path_file_name, readable_detected_game_name,
        user_facing_process_name, ProcessDisplayName,
    },
    platform::{DetectedGame, GameDetection},
    time::now_iso,
};
use crate::types::{
    RecordingGame, RecordingGameGuess, RecordingGameGuessSource, RecordingGameProcess,
    RecordingSettings,
};

/// Wine and Proton processes that run beside every Windows game.
const WINE_HELPERS: &[&str] = &[
    "conhost.exe",
    "crashpad_handler.exe",
    "explorer.exe",
    "plugplay.exe",
    "rpcss.exe",
    "rundll32.exe",
    "services.exe",
    "start.exe",
    "steam.exe",
    "svchost.exe",
    "tabtip.exe",
    "wineboot.exe",
    "winedevice.exe",
    "winemenubuilder.exe",
];

/// Desktop and helper processes that hold a GPU device but are not games.
const DESKTOP_PROCESSES: &[&str] = &[
    "alloy-agent",
    "alloy-desktop",
    "cosmic-comp",
    "gamescope",
    "gnome-shell",
    "Hyprland",
    "kded6",
    "krunner",
    "kwin_wayland",
    "kwin_x11",
    "mutter",
    "niri",
    "obs",
    "obs-ffmpeg-mux",
    "pipewire",
    "plasmashell",
    "steamwebhelper",
    "sway",
    "WebKitWebProcess",
    "wireplumber",
    "Xwayland",
];

/// Userspace GPU drivers: Mesa, the Vulkan loader, and NVIDIA's libraries.
const GPU_DRIVER_LIBRARIES: &[&str] = &[
    "libgallium",
    "libvulkan",
    "libGLX_",
    "libEGL_",
    "libnvidia-",
];

/// The obs-vkcapture layer's name buffer holds 47 bytes and a terminator.
const VKCAPTURE_NAME_MAX_BYTES: usize = 47;

struct Process {
    pid: u32,
    start_ticks: u64,
    path: Option<String>,
    executable: Option<String>,
}

pub(in crate::agent) fn detect_game_activity(
    active_game: Option<&DetectedGame>,
    settings: &RecordingSettings,
) -> Option<GameDetection> {
    let candidates: Vec<_> = own_processes()
        .into_iter()
        .filter_map(|process| detected_game(process, settings))
        .collect();
    // Keep the active game while it runs, so a second allowed game does not
    // take over its buffer.
    let game = active_game
        .and_then(|active| {
            candidates
                .iter()
                .find(|candidate| candidate.window_key == active.window_key)
                .cloned()
        })
        .or_else(|| {
            candidates
                .into_iter()
                .max_by_key(|game| (game.detection_score, game.process_start_ticks))
        })?;
    Some(GameDetection {
        game,
        focused: true,
    })
}

pub(in crate::agent) fn is_detected_game_alive(game: &DetectedGame) -> bool {
    start_ticks(game.game.process_id) == Some(game.process_start_ticks)
}

/// The name the PipeWire application audio capture matches for a game: the
/// Windows executable for a Proton game, which Wine reports as the stream's
/// application name, and otherwise the running binary's file name, which
/// PipeWire and PulseAudio clients report from `/proc/self/exe`. For a
/// Nix-wrapped game that is `.name-wrapped`, not the executable shown.
pub(in crate::agent) fn audio_target(game: &DetectedGame) -> Option<String> {
    game.game
        .path
        .as_deref()
        .and_then(path_file_name)
        .or_else(|| game.game.executable.clone())
        .filter(|target| !target.is_empty())
}

fn detected_game(process: Process, settings: &RecordingSettings) -> Option<DetectedGame> {
    let path = process.path.as_deref();
    let executable = process.executable.as_deref();
    if executable.is_some_and(is_wine_helper) {
        return None;
    }
    let candidate = candidate_game_detection_match(path, executable, None, None, None, settings)?;
    // Windows only counts a catalog match once the process has a game-like
    // window. Without window information, it counts once the process
    // renders, as in the picker; a game the user allowed always counts.
    if !matches!(candidate.source, RecordingGameGuessSource::Manual) && !uses_gpu(process.pid) {
        return None;
    }
    let name = readable_detected_game_name(&candidate, path, None, executable);
    let guess = RecordingGameGuess {
        source: candidate.source,
        source_id: candidate.source_id,
        name: candidate.name,
        aliases: candidate.aliases,
        executable: process.executable.clone(),
        path: process.path.clone(),
        window_title: None,
        window_class: None,
        icon_url: candidate.icon_url.clone(),
        confidence: candidate.confidence,
        match_kind: candidate.match_kind,
    };
    let Process {
        pid, start_ticks, ..
    } = process;
    Some(DetectedGame {
        game: RecordingGame {
            id: candidate.id,
            name,
            process_id: pid,
            executable: process.executable,
            path: process.path,
            icon_url: candidate.icon_url,
            window_title: None,
            window_class: None,
            started_at: Some(now_iso()),
            guess: Some(guess),
        },
        obs_window: vkcapture_client_name(pid),
        window_key: format!("pid:{pid}:{start_ticks}"),
        process_start_ticks: start_ticks,
        capture_dimensions: None,
        hdr_enabled: false,
        detection_score: candidate.detection_score,
    })
}

/// Processes for the "add a game" picker. Without window information, a
/// process that renders on the GPU stands in for one with a window.
pub(in crate::agent) fn list_game_processes() -> Vec<RecordingGameProcess> {
    let mut seen = HashSet::new();
    let mut items: Vec<_> = own_processes()
        .into_iter()
        .filter(|process| {
            !process.executable.as_deref().is_some_and(|executable| {
                DESKTOP_PROCESSES.contains(&executable) || is_wine_helper(executable)
            }) && uses_gpu(process.pid)
        })
        .filter_map(|process| {
            let path = process.path?;
            let key = path.to_lowercase();
            if !seen.insert(key.clone()) {
                return None;
            }
            let desktop = desktop_application(
                Some(process.pid),
                &[process.executable.as_deref().unwrap_or_default()],
            );
            let name = desktop
                .as_ref()
                .and_then(|desktop| desktop.name.clone())
                .or_else(|| {
                    user_facing_process_name(ProcessDisplayName {
                        path: Some(&path),
                        preferred: None,
                        title: None,
                        executable: process.executable.as_deref(),
                        fallback: process.executable.as_deref(),
                        preserve_preferred: false,
                    })
                })
                .unwrap_or_else(|| format!("Process {}", process.pid));
            Some(RecordingGameProcess {
                id: key,
                name,
                process_id: process.pid,
                executable: process.executable,
                path: Some(path),
                window_title: None,
                icon_url: desktop.and_then(|desktop| desktop.icon_url),
            })
        })
        .collect();
    items.sort_by_key(|item| item.name.to_lowercase());
    items
}

fn own_processes() -> Vec<Process> {
    let Ok(uid) = fs::metadata("/proc/self").map(|metadata| metadata.uid()) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse::<u32>().ok()?;
            if entry.metadata().ok()?.uid() != uid {
                return None;
            }
            let start_ticks = start_ticks(pid)?;
            let path = process_path(pid)?;
            Some(Process {
                pid,
                start_ticks,
                executable: path_file_name(&path).map(unwrapped_executable),
                path: Some(path),
            })
        })
        .collect()
}

fn start_ticks(pid: u32) -> Option<u64> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // Field 22. The command name before it is parenthesized and may contain
    // spaces, so count from the closing parenthesis, which ends field 2.
    stat.rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(19)?
        .parse()
        .ok()
}

/// Wine runs a Windows program with its Windows path as `argv[0]`, or after
/// the loader. Anything else is identified by its executable.
fn process_path(pid: u32) -> Option<String> {
    let cmdline = fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let mut args = cmdline
        .split(|byte| *byte == 0)
        .filter(|arg| !arg.is_empty())
        .map(|arg| String::from_utf8_lossy(arg).into_owned());
    // Kernel threads have no command line.
    let first = args.next()?;
    if is_windows_executable(&first) {
        return Some(first);
    }
    if path_file_name(&first).is_some_and(|name| name.starts_with("wine")) {
        if let Some(program) = args.next().filter(|arg| is_windows_executable(arg)) {
            return Some(program);
        }
    }
    fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

/// The name obs-vkcapture's layer reports for a process, which its capture
/// source compares exactly: `OBS_VKCAPTURE_NAME` when the game sets it, the
/// Wine program's `comm` (its executable, cut to 15 bytes) under the Wine
/// preloader, and the executable's file name otherwise.
fn vkcapture_client_name(pid: u32) -> Option<String> {
    if let Some(name) = environment_value(pid, "OBS_VKCAPTURE_NAME") {
        return Some(truncated(name, VKCAPTURE_NAME_MAX_BYTES));
    }
    let executable = fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    let name = executable.file_name()?.to_string_lossy().into_owned();
    let name = if name == "wine-preloader" || name == "wine64-preloader" {
        fs::read_to_string(format!("/proc/{pid}/comm"))
            .ok()?
            .trim_end_matches('\n')
            .to_string()
    } else {
        name
    };
    Some(truncated(name, VKCAPTURE_NAME_MAX_BYTES))
}

fn environment_value(pid: u32, name: &str) -> Option<String> {
    let environment = fs::read(format!("/proc/{pid}/environ")).ok()?;
    let prefix = format!("{name}=");
    environment
        .split(|byte| *byte == 0)
        .find_map(|entry| entry.strip_prefix(prefix.as_bytes()))
        .map(|value| String::from_utf8_lossy(value).into_owned())
}

fn truncated(mut value: String, max_bytes: usize) -> String {
    if value.len() > max_bytes {
        let mut end = max_bytes;
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        value.truncate(end);
    }
    value
}

/// Nix wraps programs as `.name-wrapped` behind a `name` script.
pub(super) fn unwrapped_executable(executable: String) -> String {
    executable
        .strip_prefix('.')
        .and_then(|name| name.strip_suffix("-wrapped"))
        .map(str::to_string)
        .unwrap_or(executable)
}

fn is_windows_executable(value: &str) -> bool {
    value.to_ascii_lowercase().ends_with(".exe")
}

fn is_wine_helper(executable: &str) -> bool {
    WINE_HELPERS.contains(&executable.to_ascii_lowercase().as_str())
}

/// A process that loaded a userspace GPU driver renders. An open device file
/// is not enough: children inherit it from the process that started them.
fn uses_gpu(pid: u32) -> bool {
    fs::read_to_string(format!("/proc/{pid}/maps")).is_ok_and(|maps| {
        maps.lines()
            .filter_map(|line| line.rsplit_once('/').map(|(_, library)| library))
            .any(|library| {
                GPU_DRIVER_LIBRARIES
                    .iter()
                    .any(|prefix| library.starts_with(prefix))
            })
    })
}
