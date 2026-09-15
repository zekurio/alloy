//! Wire types for the recorder JSON protocol.
//!
//! These are shared with the desktop host, so every serde attribute here is
//! part of the protocol: renaming a field or a variant changes the JSON.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default, rename = "deadlineUnixMs")]
    pub deadline_unix_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<RecordingStatus>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureParams {
    pub settings: RecordingSettings,
    pub agent_state_folder: PathBuf,
    pub output_folder: String,
    pub replay_scratch_folder: String,
    pub obs_runtime_dir: Option<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarVersion {
    pub name: &'static str,
    pub version: &'static str,
    pub protocol_version: u32,
    pub capabilities: &'static [&'static str],
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSettings {
    pub enabled: bool,
    pub capture_mode: RecordingCaptureMode,
    pub selected_display_id: String,
    pub allowed_games: Vec<RecordingAllowedGame>,
    #[serde(default)]
    pub denied_games: Vec<RecordingAllowedGame>,
    pub audio_mode: RecordingAudioMode,
    pub audio_devices: Vec<RecordingAudioDeviceSelection>,
    pub audio_applications: Vec<RecordingAudioApplicationSelection>,
    pub encoder: RecordingEncoder,
    pub gpu: String,
    pub codec: RecordingCodec,
    pub quality_profile: RecordingQualityProfile,
    pub resolution: RecordingResolution,
    pub fps: u32,
    pub bitrate: RecordingBitrate,
    pub custom_quality: RecordingQualitySettings,
    pub replay_buffer_seconds: u32,
    pub buffer_storage: RecordingBufferStorage,
    pub output_folder: String,
    pub hotkeys: RecordingHotkeys,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingAllowedGame {
    pub id: String,
    pub name: String,
    pub executable: Option<String>,
    pub path: Option<String>,
    #[serde(default)]
    pub window_class: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingGameProcess {
    pub id: String,
    pub name: String,
    pub process_id: u32,
    pub executable: Option<String>,
    pub path: Option<String>,
    pub window_title: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingGameGuessSource {
    DiscordDetectable,
    Manual,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingGameGuessMatchKind {
    Executable,
    Manual,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingGameGuess {
    pub source: RecordingGameGuessSource,
    pub source_id: Option<String>,
    pub name: String,
    pub aliases: Vec<String>,
    pub executable: Option<String>,
    pub path: Option<String>,
    pub window_title: Option<String>,
    pub window_class: Option<String>,
    pub icon_url: Option<String>,
    pub confidence: u8,
    pub match_kind: RecordingGameGuessMatchKind,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingDisplay {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
    pub thumbnail_data_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingQualitySettings {
    pub resolution: RecordingResolution,
    pub fps: u32,
    pub bitrate: RecordingBitrate,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingHotkeys {
    #[serde(default)]
    pub screenshot: String,
    pub clip: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingAudioMode {
    Devices,
    Applications,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingAudioDeviceKind {
    Output,
    Input,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingAudioDevice {
    pub id: String,
    pub label: String,
    pub kind: RecordingAudioDeviceKind,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingAudioDeviceSelection {
    pub id: String,
    pub label: String,
    pub kind: RecordingAudioDeviceKind,
    pub enabled: bool,
    pub volume: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingAudioApplicationSelection {
    pub id: String,
    pub name: String,
    pub window: String,
    pub executable: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    pub process_id: Option<u32>,
    pub enabled: bool,
    pub volume: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingAudioLevelTarget {
    Device,
    Application,
}

/// One live loudness sample. `peak` is the linear peak amplitude (0..1) as
/// reported by WASAPI, pre-volume; the UI scales it by the row volume.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingAudioLevel {
    pub target: RecordingAudioLevelTarget,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<RecordingAudioDeviceKind>,
    pub id: String,
    pub peak: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingGame {
    pub id: Option<String>,
    pub name: String,
    pub process_id: u32,
    pub executable: Option<String>,
    pub path: Option<String>,
    pub icon_url: Option<String>,
    pub window_title: Option<String>,
    pub window_class: Option<String>,
    pub started_at: Option<String>,
    pub guess: Option<RecordingGameGuess>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingCaptureMode {
    Game,
    Display,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingEncoder {
    Hardware,
    Software,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingCodec {
    H264,
    Hevc,
    Av1,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingQualityProfile {
    Low,
    Standard,
    High,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingResolution {
    Source,
    #[serde(rename = "720p")]
    R720p,
    #[serde(rename = "1080p")]
    R1080p,
    #[serde(rename = "1440p")]
    R1440p,
    #[serde(rename = "2160p")]
    R2160p,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct RecordingBitrate(pub String);

impl RecordingBitrate {
    pub fn auto() -> Self {
        Self("auto".to_string())
    }

    pub fn mbps(value: &str) -> Self {
        Self(value.to_string())
    }

    pub fn custom_kbps(&self) -> Option<u32> {
        if self.0 == "auto" {
            return None;
        }
        self.0
            .parse::<u32>()
            .ok()
            .and_then(|value| value.checked_mul(1000))
            .filter(|value| *value > 0)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingBufferStorage {
    Memory,
    Disk,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingCapture {
    pub id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: Option<u64>,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub game: Option<RecordingGame>,
    pub source: RecordingCaptureSource,
    pub kind: RecordingCaptureKind,
    pub post_process: Option<RecordingCapturePostProcess>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingTelemetry {
    pub sampled_at: String,
    pub capture_mode: RecordingCaptureMode,
    pub capture_source: Option<RecordingCaptureSource>,
    pub buffer_storage: RecordingBufferStorage,
    pub encoder: RecordingEncoder,
    pub codec: RecordingCodec,
    pub video_encoder: Option<String>,
    pub audio_encoder: Option<String>,
    pub gpu: String,
    pub gpu_adapter: u32,
    pub gpu_label: Option<String>,
    pub base_width: u32,
    pub base_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub output_active: bool,
    pub paused: bool,
    pub active_fps: Option<f64>,
    pub average_frame_time_ms: Option<f64>,
    pub frame_interval_ms: Option<f64>,
    pub render_total_frames: Option<u32>,
    pub render_lagged_frames: Option<u32>,
    pub render_lagged_percent: Option<f64>,
    pub output_total_frames: Option<u32>,
    pub output_dropped_frames: Option<u32>,
    pub output_dropped_percent: Option<f64>,
    pub output_total_bytes: Option<u64>,
}

/// `Display` is the default so a capture recovered without a source is filed
/// as a desktop capture instead of claiming a game.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum RecordingCaptureSource {
    Game,
    #[default]
    Display,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum RecordingCaptureKind {
    #[default]
    Replay,
    Screenshot,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RecordingCapturePostProcess {
    TrimTail {
        #[serde(rename = "keepMs")]
        keep_ms: u64,
    },
    ConcatSegments {
        #[serde(rename = "segmentPaths")]
        segment_paths: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub backend: RecordingBackendState,
    pub mode: RecordingMode,
    pub capture_mode: RecordingCaptureMode,
    pub run_state: RecordingRunState,
    pub replay_active: bool,
    pub active_game: Option<String>,
    pub active_game_detail: Option<RecordingGame>,
    pub active_display: Option<RecordingDisplay>,
    pub focused: bool,
    pub current_source: Option<RecordingCaptureSource>,
    pub current_capture: Option<RecordingCapture>,
    pub replay_buffer_seconds: u32,
    pub available_gpus: Vec<String>,
    pub available_codecs: Vec<RecordingCodec>,
    pub available_audio_devices: Vec<RecordingAudioDevice>,
    pub available_audio_applications: Vec<RecordingAudioApplicationSelection>,
    pub telemetry: Option<RecordingTelemetry>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingBackendState {
    Missing,
    Ready,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum RecordingMode {
    Idle,
    ReplayBuffer,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum RecordingRunState {
    Idle,
    Paused,
    ReplayBuffer,
    Stopping,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingActionResult {
    pub ok: bool,
    pub status: RecordingStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture: Option<RecordingCapture>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RecordingEvent {
    ClipHotkey,
    ScreenshotHotkey,
    Status {
        status: RecordingStatus,
    },
    ReplayBufferStarted {
        status: RecordingStatus,
    },
    GameStarted {
        game: RecordingGame,
        status: RecordingStatus,
    },
    GameFocusChanged {
        game: Option<RecordingGame>,
        focused: bool,
        status: RecordingStatus,
    },
    GameEnded {
        game: RecordingGame,
        status: RecordingStatus,
    },
    CaptureReady {
        capture: RecordingCapture,
        status: RecordingStatus,
    },
    Telemetry {
        telemetry: RecordingTelemetry,
        status: RecordingStatus,
    },
    Error {
        error: String,
        status: RecordingStatus,
    },
    AudioLevels {
        levels: Vec<RecordingAudioLevel>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct EventEnvelope {
    pub event: RecordingEvent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VideoDimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveReplayClipParams {
    pub requested_at_unix_ms: u64,
    pub duration_seconds: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayNotificationSoundParams {
    pub path: String,
    pub volume: f32,
}

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            capture_mode: RecordingCaptureMode::Game,
            selected_display_id: String::new(),
            allowed_games: Vec::new(),
            denied_games: Vec::new(),
            audio_mode: RecordingAudioMode::Devices,
            audio_devices: crate::settings::default_audio_device_selections()
                .into_iter()
                .filter(|device| device.kind == RecordingAudioDeviceKind::Output)
                .collect(),
            audio_applications: Vec::new(),
            encoder: RecordingEncoder::Hardware,
            gpu: "auto".to_string(),
            codec: RecordingCodec::H264,
            quality_profile: RecordingQualityProfile::Custom,
            resolution: RecordingResolution::R1080p,
            fps: 60,
            bitrate: RecordingBitrate::auto(),
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::R1080p,
                fps: 60,
                bitrate: RecordingBitrate::auto(),
            },
            replay_buffer_seconds: 90,
            buffer_storage: RecordingBufferStorage::Memory,
            output_folder: String::new(),
            hotkeys: RecordingHotkeys {
                screenshot: "F7".to_string(),
                clip: "F8".to_string(),
            },
        }
    }
}
