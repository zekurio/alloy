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
    RecordingActionResult, RecordingBackendState, RecordingCapture, RecordingCaptureKind,
    RecordingCodec, RecordingDisplay, RecordingEvent, RecordingGameProcess, RecordingStatus,
    Request as WireRequest, Response as WireResponse,
    SaveReplayClipParams as SaveReplayClipRequest,
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
        replay_active: false,
        active_game: None,
        active_game_detail: None,
        active_display: None,
        available_gpus: Vec::new(),
        available_codecs: vec![RecordingCodec::H264],
        available_audio_devices: Vec::new(),
        available_audio_applications: settings.audio_applications.clone(),
        message,
    }
}

/// The status carried by an event, when it carries one.
pub fn event_status(event: &RecordingEvent) -> Option<&RecordingStatus> {
    match event {
        RecordingEvent::Status { status }
        | RecordingEvent::ReplayBufferStarted { status }
        | RecordingEvent::CaptureReady { status, .. } => Some(status),
        RecordingEvent::ClipHotkey
        | RecordingEvent::ScreenshotHotkey
        | RecordingEvent::AudioLevels { .. } => None,
    }
}

/// The capture announced by a `capture-ready` event.
pub fn event_capture(event: &RecordingEvent) -> Option<&RecordingCapture> {
    match event {
        RecordingEvent::CaptureReady { capture, .. } => Some(capture.as_ref()),
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

/// Where the recorder host and its agent keep their files.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecorderHostOptions {
    pub executable: PathBuf,
    /// Settings and the capture recovery queue.
    pub state_dir: PathBuf,
    /// Regenerable host data: the agent's scratch state in `agent/` and the
    /// Discord detection cache.
    pub cache_dir: PathBuf,
    pub output_folder: PathBuf,
    pub replay_scratch_folder: PathBuf,
    pub obs_runtime_dir: PathBuf,
}

impl RecorderHostOptions {
    pub(super) fn agent_state_folder(&self) -> PathBuf {
        self.cache_dir.join("agent")
    }
}
