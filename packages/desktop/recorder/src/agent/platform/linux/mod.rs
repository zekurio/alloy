//! Linux discovery: games from `/proc`, displays from the Wayland or X11
//! session, GPUs from DRM render nodes, and audio devices, applications and
//! level meters from PipeWire.

mod audio;
mod displays;
mod games;
mod gpus;
mod pipewire;
pub(in crate::agent) mod session;

pub(in crate::agent) use audio::{
    audio_applications, audio_devices, default_audio_device_id, stop_audio_level_events,
    subscribe_audio_level_events,
};
pub(in crate::agent) use displays::{list_displays, primary_display_id, x11_screen_index};
pub(in crate::agent) use games::{
    audio_target, detect_game_activity, is_detected_game_alive, list_game_processes,
};
pub(in crate::agent) use gpus::{render_node, render_nodes};

use super::DetectedGame;

/// Wayland gives applications no global key hook, so the agent registers
/// nothing. Binding the clip and screenshot shortcuts through the
/// GlobalShortcuts portal and sending them as requests is left to the desktop
/// shell.
pub(in crate::agent) mod hotkeys {
    use crate::types::RecordingSettings;

    pub(in crate::agent) fn configure(_settings: &RecordingSettings) {}
}

/// Linux reports no window size or HDR state for another client, so a game's
/// capture metadata stays as detected.
pub(in crate::agent) fn refresh_capture_metadata(_game: &mut DetectedGame) {}
