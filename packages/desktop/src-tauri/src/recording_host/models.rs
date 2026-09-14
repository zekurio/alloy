use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AGENT_NAME: &str = "alloy-agent";
pub const AGENT_PROTOCOL_VERSION: u32 = 1;
pub const AGENT_METHODS: &[&str] = &[
    "version",
    "configure",
    "status",
    "listGameProcesses",
    "listDisplays",
    "saveReplayClip",
    "saveScreenshot",
    "playNotificationSound",
    "subscribeAudioLevels",
    "stopAudioLevels",
    "shutdown",
];

pub type RecordingBitrate = String;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarVersion {
    pub name: String,
    pub version: String,
    pub protocol_version: u32,
    pub capabilities: Vec<String>,
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
    pub bitrate: String,
    pub custom_quality: RecordingQualitySettings,
    pub replay_buffer_seconds: u32,
    pub buffer_storage: RecordingBufferStorage,
    pub output_folder: String,
    pub hotkeys: RecordingHotkeys,
    #[serde(default = "RecordingNotificationSounds::default")]
    pub notification_sounds: RecordingNotificationSounds,
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
            audio_devices: vec![RecordingAudioDeviceSelection {
                id: "default".to_string(),
                label: "Default output".to_string(),
                kind: RecordingAudioDeviceKind::Output,
                enabled: true,
                volume: 100,
            }],
            audio_applications: Vec::new(),
            encoder: RecordingEncoder::Hardware,
            gpu: "auto".to_string(),
            codec: RecordingCodec::H264,
            quality_profile: RecordingQualityProfile::Custom,
            resolution: RecordingResolution::R1080p,
            fps: 60,
            bitrate: "auto".to_string(),
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::R1080p,
                fps: 60,
                bitrate: "auto".to_string(),
            },
            replay_buffer_seconds: 90,
            buffer_storage: RecordingBufferStorage::Memory,
            output_folder: String::new(),
            hotkeys: RecordingHotkeys {
                screenshot: "F7".to_string(),
                clip: "F8".to_string(),
            },
            notification_sounds: RecordingNotificationSounds::default(),
        }
    }
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
    pub bitrate: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingHotkeys {
    #[serde(default)]
    pub screenshot: String,
    pub clip: String,
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
#[serde(rename_all = "kebab-case")]
pub enum RecordingBufferStorage {
    Memory,
    Disk,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingCaptureSource {
    Game,
    Display,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingCaptureKind {
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingBackendState {
    Missing,
    Ready,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingMode {
    Idle,
    ReplayBuffer,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingRunState {
    Idle,
    Paused,
    ReplayBuffer,
    Stopping,
    Error,
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

impl RecordingStatus {
    pub fn unavailable(settings: &RecordingSettings, message: Option<String>) -> Self {
        Self {
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

impl RecordingEvent {
    pub fn status(&self) -> Option<&RecordingStatus> {
        match self {
            Self::Status { status }
            | Self::ReplayBufferStarted { status }
            | Self::GameStarted { status, .. }
            | Self::GameFocusChanged { status, .. }
            | Self::GameEnded { status, .. }
            | Self::CaptureReady { status, .. }
            | Self::Telemetry { status, .. }
            | Self::Error { status, .. } => Some(status),
            Self::ClipHotkey | Self::ScreenshotHotkey | Self::AudioLevels { .. } => None,
        }
    }

    pub fn capture(&self) -> Option<&RecordingCapture> {
        match self {
            Self::CaptureReady { capture, .. } => Some(capture),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct EventEnvelope {
    pub event: RecordingEvent,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveReplayClipRequest {
    pub requested_at_unix_ms: u64,
    pub duration_seconds: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayNotificationSoundRequest {
    pub path: String,
    pub volume: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStorageInfo {
    pub output_folder: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub clips_bytes: u64,
}

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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WireRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default, rename = "deadlineUnixMs")]
    pub deadline_unix_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WireResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<RecordingStatus>,
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
