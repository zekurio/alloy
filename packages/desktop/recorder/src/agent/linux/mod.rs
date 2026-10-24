//! Linux recorder. gpu-screen-recorder captures a monitor and keeps the replay
//! buffer; this module drives one replay process and detects games from
//! `/proc`. Global shortcuts belong to the desktop host, which owns the portal
//! session, so the agent installs no hotkey hook here.

mod games;
mod gsr;
mod recorder;

pub(in crate::agent) use games::list_game_processes;
pub(in crate::agent) use gsr::list_displays;
pub(in crate::agent) use recorder::Recorder;

/// gpu-screen-recorder has no level meters. The agent does not advertise
/// `audio-levels`, so subscribing only succeeds without events.
pub(in crate::agent) fn subscribe_audio_level_events() {}

pub(in crate::agent) fn stop_audio_level_events() {}
