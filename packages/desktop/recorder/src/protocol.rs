//! Constants that are part of the agent's stdio JSON protocol.

/// Executable stem the desktop host spawns, and the name reported by `version`.
pub const SIDE_CAR_NAME: &str = "alloy-agent";

/// Bumped whenever the request/response shape changes incompatibly.
pub const RECORDER_PROTOCOL_VERSION: u32 = 1;

/// What this platform's recorder can do, for the version handshake and the
/// status. The web hides the controls for anything a recorder leaves out, and
/// the host reports the same set while the recorder is down.
#[cfg(windows)]
pub const RECORDER_CAPABILITIES: &[&str] = &[
    "screenshots",
    "game-capture",
    "audio-devices",
    "audio-applications",
    "audio-volume",
    "game-processes",
    "display-capture",
    "displays",
    "replay-buffer",
    "notification-sounds",
    "audio-levels",
    "hotkeys",
    "telemetry",
];

/// Linux leaves out `hotkeys`: Wayland gives applications no global key hook,
/// so the desktop host binds the shortcuts through the GlobalShortcuts portal
/// (`global_shortcuts.rs`).
#[cfg(not(windows))]
pub const RECORDER_CAPABILITIES: &[&str] = &[
    "screenshots",
    "game-capture",
    "audio-devices",
    "audio-applications",
    "audio-volume",
    "game-processes",
    "display-capture",
    "displays",
    "replay-buffer",
    "notification-sounds",
    "audio-levels",
    "telemetry",
];

/// Content type reported for captured clips.
pub const CONTENT_TYPE_MP4: &str = "video/mp4";
