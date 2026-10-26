//! Platform discovery behind one API: games, displays, audio applications and
//! level meters, and the hotkey hook. Windows reads windows, WASAPI and COM;
//! Linux reads `/proc`, sysfs and PulseAudio in `linux`.

use std::process::Command;

use crate::agent::game_matching::candidate_game_detection_match;
use crate::types::{RecordingDisplay, RecordingGame, RecordingSettings, VideoDimensions};

#[cfg(windows)]
mod audio_levels;
#[cfg(windows)]
pub(in crate::agent) mod com;
#[cfg(windows)]
pub(in crate::agent) mod hotkeys;
#[cfg(target_os = "linux")]
pub(in crate::agent) mod linux;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
mod windows_audio;

#[cfg(windows)]
pub(in crate::agent) use audio_levels::{stop_audio_level_events, subscribe_audio_level_events};
#[cfg(target_os = "linux")]
pub(in crate::agent) use linux::{
    audio_applications, detect_game_activity, hotkeys, is_detected_game_alive, list_displays,
    list_game_processes, primary_display_id, refresh_capture_metadata, stop_audio_level_events,
    subscribe_audio_level_events,
};
#[cfg(windows)]
pub(in crate::agent) use windows::{
    audio_applications, detect_game_activity, is_detected_game_alive, list_displays,
    list_game_processes, primary_display_id,
};
#[cfg(windows)]
pub(in crate::agent) use windows_audio::{application_display_name, refresh_capture_metadata};

#[derive(Clone, Debug)]
pub(in crate::agent) struct DetectedGame {
    pub(in crate::agent) game: RecordingGame,
    /// What OBS game capture targets: the `title:class:exe` window selector
    /// on Windows, the name obs-vkcapture's layer reports on Linux.
    pub(in crate::agent) obs_window: Option<String>,
    pub(in crate::agent) window_key: String,
    #[cfg(windows)]
    pub(in crate::agent) window_handle: isize,
    /// Start time in clock ticks, so a recycled pid is a different process.
    #[cfg(target_os = "linux")]
    pub(in crate::agent) process_start_ticks: u64,
    #[cfg(windows)]
    pub(in crate::agent) fullscreen: bool,
    pub(in crate::agent) capture_dimensions: Option<VideoDimensions>,
    pub(in crate::agent) hdr_enabled: bool,
    pub(in crate::agent) detection_score: i32,
}

#[derive(Clone, Debug)]
pub(in crate::agent) struct GameDetection {
    pub(in crate::agent) game: DetectedGame,
    pub(in crate::agent) focused: bool,
}

pub(in crate::agent) fn detected_game_allowed(
    detected: &DetectedGame,
    settings: &RecordingSettings,
) -> bool {
    candidate_game_detection_match(
        detected.game.path.as_deref(),
        detected.game.executable.as_deref(),
        detected.game.window_title.as_deref(),
        detected.game.window_class.as_deref(),
        detected.capture_dimensions,
        settings,
    )
    .is_some()
}

pub(in crate::agent) fn selected_display(settings: &RecordingSettings) -> Option<RecordingDisplay> {
    let displays = list_displays();
    if !settings.selected_display_id.trim().is_empty() {
        if let Some(display) = displays
            .iter()
            .find(|display| display.id == settings.selected_display_id)
            .cloned()
        {
            return Some(display);
        }
    }
    displays
        .iter()
        .find(|display| display.primary)
        .cloned()
        .or_else(|| displays.into_iter().next())
}

pub(in crate::agent) fn selected_display_dimensions(
    settings: &RecordingSettings,
) -> Option<VideoDimensions> {
    selected_display(settings).map(|display| VideoDimensions {
        width: display.width,
        height: display.height,
    })
}

pub(in crate::agent) fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let mut process = Command::new(command);
    process.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x0800_0000);
    }
    let output = process.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(windows)]
pub(in crate::agent) fn obs_window_selector(
    title: &str,
    class_name: &str,
    executable: &str,
) -> String {
    format!(
        "{}:{}:{}",
        obs_window_selector_component(title),
        obs_window_selector_component(class_name),
        obs_window_selector_component(executable)
    )
}

#[cfg(windows)]
fn obs_window_selector_component(value: &str) -> String {
    value.replace('#', "#22").replace(':', "#3A")
}

pub(in crate::agent) fn valid_capture_dimensions(dimensions: VideoDimensions) -> bool {
    const MIN_VALID_CAPTURE_DIMENSION_SUM: u32 = 1120;
    dimensions.width.saturating_add(dimensions.height) >= MIN_VALID_CAPTURE_DIMENSION_SUM
}

pub(in crate::agent) fn audio_application_id_from_parts(
    executable: Option<&str>,
    class_name: Option<&str>,
    process_id: u32,
) -> String {
    if let Some(executable) = executable {
        return format!("exe:{}", executable.to_ascii_lowercase());
    }
    if let Some(class_name) = class_name {
        return format!("class:{}", class_name.to_ascii_lowercase());
    }
    format!("process:{process_id}")
}
