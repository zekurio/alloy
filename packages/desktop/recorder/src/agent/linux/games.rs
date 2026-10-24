//! Game detection from `/proc`. Wayland tells clients nothing about other
//! applications' windows, so a running allowed game counts as the active one.
//! Only the user's own processes are visible in enough detail to match.

use std::{collections::HashSet, fs, os::unix::fs::MetadataExt};

use crate::agent::{
    game_matching::{
        candidate_game_detection_match, path_file_name, readable_detected_game_name,
        user_facing_process_name, ProcessDisplayName,
    },
    time::now_iso,
};
use crate::types::{RecordingGame, RecordingGameGuess, RecordingGameProcess, RecordingSettings};

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
    "gpu-screen-recorder",
    "gsr-kms-server",
    "Hyprland",
    "kded6",
    "krunner",
    "kwin_wayland",
    "kwin_x11",
    "mutter",
    "niri",
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProcessId {
    pid: u32,
    /// Start time in clock ticks, so a recycled pid is a different process.
    start_ticks: u64,
}

struct Process {
    id: ProcessId,
    path: Option<String>,
    executable: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct DetectedGame {
    pub(super) game: RecordingGame,
    pub(super) key: String,
    process: ProcessId,
    detection_score: i32,
}

pub(super) fn detect_game(settings: &RecordingSettings) -> Option<DetectedGame> {
    own_processes()
        .into_iter()
        .filter_map(|process| detected_game(process, settings))
        .max_by_key(|game| (game.detection_score, game.process.start_ticks))
}

pub(super) fn game_alive(game: &DetectedGame) -> bool {
    start_ticks(game.process.pid) == Some(game.process.start_ticks)
}

pub(super) fn game_allowed(game: &DetectedGame, settings: &RecordingSettings) -> bool {
    candidate_game_detection_match(
        game.game.path.as_deref(),
        game.game.executable.as_deref(),
        None,
        None,
        None,
        settings,
    )
    .is_some()
}

fn detected_game(process: Process, settings: &RecordingSettings) -> Option<DetectedGame> {
    let path = process.path.as_deref();
    let executable = process.executable.as_deref();
    if executable.is_some_and(is_wine_helper) {
        return None;
    }
    let candidate = candidate_game_detection_match(path, executable, None, None, None, settings)?;
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
    let ProcessId { pid, start_ticks } = process.id;
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
        key: format!("pid:{pid}:{start_ticks}"),
        process: process.id,
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
            }) && uses_gpu(process.id.pid)
        })
        .filter_map(|process| {
            let path = process.path?;
            let key = path.to_lowercase();
            if !seen.insert(key.clone()) {
                return None;
            }
            let name = user_facing_process_name(ProcessDisplayName {
                path: Some(&path),
                preferred: None,
                title: None,
                executable: process.executable.as_deref(),
                fallback: process.executable.as_deref(),
                preserve_preferred: false,
            })
            .unwrap_or_else(|| format!("Process {}", process.id.pid));
            Some(RecordingGameProcess {
                id: key,
                name,
                process_id: process.id.pid,
                executable: process.executable,
                path: Some(path),
                window_title: None,
                icon_url: None,
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
                id: ProcessId { pid, start_ticks },
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

/// Nix wraps programs as `.name-wrapped` behind a `name` script.
fn unwrapped_executable(executable: String) -> String {
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
