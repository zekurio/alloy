//! Host-side types for the recorder protocol.
//!
//! The wire shapes themselves live in `alloy_recorder::types` — the recorder is
//! the single definition of the JSON that crosses the stdio pipe. This module
//! only re-exports them and adds what is genuinely host-only: the settings the
//! host keeps on top of the recorder's, the spawn options, and the on-disk
//! state files.

use std::{
    ops::{Deref, DerefMut},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};

pub use alloy_recorder::protocol::{
    RECORDER_PROTOCOL_VERSION as AGENT_PROTOCOL_VERSION, SIDE_CAR_NAME as AGENT_NAME,
};
pub use alloy_recorder::types::{
    EventEnvelope, PlayNotificationSoundParams as PlayNotificationSoundRequest,
    RecordingActionResult, RecordingAllowedGame, RecordingAudioApplicationSelection,
    RecordingAudioDevice, RecordingAudioDeviceKind, RecordingAudioDeviceSelection,
    RecordingAudioLevel, RecordingAudioLevelTarget, RecordingAudioMode, RecordingBackendState,
    RecordingBitrate, RecordingBufferStorage, RecordingCapture, RecordingCaptureKind,
    RecordingCaptureMode, RecordingCapturePostProcess, RecordingCaptureSource, RecordingCodec,
    RecordingDisplay, RecordingEncoder, RecordingEvent, RecordingGame, RecordingGameGuess,
    RecordingGameGuessMatchKind, RecordingGameGuessSource, RecordingGameProcess, RecordingHotkeys,
    RecordingMode, RecordingQualityProfile, RecordingQualitySettings, RecordingResolution,
    RecordingRunState, RecordingStatus, RecordingTelemetry, Request as WireRequest,
    Response as WireResponse, SaveReplayClipParams as SaveReplayClipRequest,
};

pub use alloy_recorder::types::RecordingSettings as RecorderSettings;

/// The recorder's `version` reply, owned so the host can deserialize it. The
/// recorder serializes the same shape from `&'static str` fields.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarVersion {
    pub name: String,
    pub version: String,
    pub protocol_version: u32,
    pub capabilities: Vec<String>,
}

/// Recording settings as the desktop app stores them: everything the recorder
/// understands, plus the notification-sound preferences the host acts on itself
/// (the recorder only plays a file when asked via `playNotificationSound`).
///
/// The recorder half is flattened, so the JSON the host persists and sends in
/// `configure` is the recorder's own shape with `notificationSounds` alongside.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSettings {
    #[serde(flatten)]
    pub recorder: RecorderSettings,
    #[serde(default)]
    pub notification_sounds: RecordingNotificationSounds,
}

impl Deref for RecordingSettings {
    type Target = RecorderSettings;

    fn deref(&self) -> &Self::Target {
        &self.recorder
    }
}

impl DerefMut for RecordingSettings {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.recorder
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingNotificationSoundSettings {
    pub enabled: bool,
    pub volume: u32,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingNotificationSounds {
    pub replay_buffer_started: RecordingNotificationSoundSettings,
    pub clip_saved: RecordingNotificationSoundSettings,
}

impl Default for RecordingNotificationSounds {
    fn default() -> Self {
        let default_sound = || RecordingNotificationSoundSettings {
            enabled: true,
            volume: 100,
            path: String::new(),
        };
        Self {
            replay_buffer_started: default_sound(),
            clip_saved: default_sound(),
        }
    }
}

/// The status the host reports while the recorder is absent or not yet
/// configured. The recorder never sends this; it is assembled locally.
pub fn unavailable_status(
    settings: &RecordingSettings,
    message: Option<String>,
) -> RecordingStatus {
    RecordingStatus {
        backend: RecordingBackendState::Missing,
        mode: RecordingMode::Idle,
        capture_mode: settings.capture_mode.clone(),
        run_state: RecordingRunState::Idle,
        replay_active: false,
        active_game: None,
        active_game_detail: None,
        active_display: None,
        focused: false,
        current_source: None,
        current_capture: None,
        replay_buffer_seconds: settings.replay_buffer_seconds,
        available_gpus: Vec::new(),
        available_codecs: vec![RecordingCodec::H264],
        available_audio_devices: Vec::new(),
        available_audio_applications: settings.audio_applications.clone(),
        telemetry: None,
        message,
    }
}

/// The status carried by an event, when it carries one.
pub fn event_status(event: &RecordingEvent) -> Option<&RecordingStatus> {
    match event {
        RecordingEvent::Status { status }
        | RecordingEvent::ReplayBufferStarted { status }
        | RecordingEvent::GameStarted { status, .. }
        | RecordingEvent::GameFocusChanged { status, .. }
        | RecordingEvent::GameEnded { status, .. }
        | RecordingEvent::CaptureReady { status, .. }
        | RecordingEvent::Telemetry { status, .. }
        | RecordingEvent::Error { status, .. } => Some(status),
        RecordingEvent::ClipHotkey
        | RecordingEvent::ScreenshotHotkey
        | RecordingEvent::AudioLevels { .. } => None,
    }
}

/// The capture announced by a `capture-ready` event.
pub fn event_capture(event: &RecordingEvent) -> Option<&RecordingCapture> {
    match event {
        RecordingEvent::CaptureReady { capture, .. } => Some(capture),
        _ => None,
    }
}

/// Disk usage for the capture output folder, as the settings UI shows it. Host
/// only: the recorder never reports storage.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStorageInfo {
    pub output_folder: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub clips_bytes: u64,
}

/// The host's on-disk recovery queue of captures the recorder produced but the
/// capture library has not finalized yet.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureManifest {
    pub version: u32,
    pub captures: Vec<RecordingCapture>,
}

impl Default for CaptureManifest {
    fn default() -> Self {
        Self {
            version: 1,
            captures: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecorderHostOptions {
    pub executable: PathBuf,
    pub state_dir: PathBuf,
    pub agent_state_folder: PathBuf,
    pub output_folder: PathBuf,
    pub replay_scratch_folder: PathBuf,
    pub obs_runtime_dir: Option<PathBuf>,
    pub discord_detection_cache_path: Option<PathBuf>,
    pub request_timeout: std::time::Duration,
    pub configure_timeout: std::time::Duration,
    pub shutdown_request_timeout: std::time::Duration,
    pub graceful_exit_timeout: std::time::Duration,
    pub forced_exit_timeout: std::time::Duration,
    pub respawn_delay: std::time::Duration,
    pub respawn_streak_reset: std::time::Duration,
    pub max_consecutive_respawns: u32,
    pub heartbeat_interval: std::time::Duration,
    pub max_line_bytes: usize,
}

impl RecorderHostOptions {
    pub fn new(executable: impl Into<PathBuf>, state_dir: impl Into<PathBuf>) -> Self {
        let state_dir = state_dir.into();
        Self {
            executable: executable.into(),
            agent_state_folder: state_dir.join("agent"),
            output_folder: state_dir.join("captures"),
            replay_scratch_folder: state_dir.join("replay-buffer"),
            state_dir,
            obs_runtime_dir: None,
            discord_detection_cache_path: None,
            request_timeout: std::time::Duration::from_secs(20),
            configure_timeout: std::time::Duration::from_secs(45),
            // OBS may take up to eight seconds to flush and stop an output.
            // Keep the force windows below bounded after this request grace.
            shutdown_request_timeout: std::time::Duration::from_secs(10),
            graceful_exit_timeout: std::time::Duration::from_millis(1_500),
            forced_exit_timeout: std::time::Duration::from_millis(1_500),
            respawn_delay: std::time::Duration::from_secs(3),
            respawn_streak_reset: std::time::Duration::from_secs(60),
            max_consecutive_respawns: 5,
            heartbeat_interval: std::time::Duration::from_secs(30),
            max_line_bytes: 4 * 1024 * 1024,
        }
    }

    pub fn agent_state_folder(mut self, path: impl Into<PathBuf>) -> Self {
        self.agent_state_folder = path.into();
        self
    }

    pub fn output_folder(mut self, path: impl Into<PathBuf>) -> Self {
        self.output_folder = path.into();
        self
    }

    pub fn replay_scratch_folder(mut self, path: impl Into<PathBuf>) -> Self {
        self.replay_scratch_folder = path.into();
        self
    }

    pub fn obs_runtime_dir(mut self, path: Option<PathBuf>) -> Self {
        self.obs_runtime_dir = path;
        self
    }

    pub fn discord_detection_cache_path(mut self, path: Option<PathBuf>) -> Self {
        self.discord_detection_cache_path = path;
        self
    }

    pub fn heartbeat_interval(mut self, interval: std::time::Duration) -> Self {
        self.heartbeat_interval = interval;
        self
    }
}
