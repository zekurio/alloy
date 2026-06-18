struct CallData {
    stack: *mut u8,
    size: usize,
    capacity: usize,
    fixed: bool,
}

impl Default for CallData {
    fn default() -> Self {
        Self {
            stack: ptr::null_mut(),
            size: 0,
            capacity: 0,
            fixed: false,
        }
    }
}

#[repr(C)]
struct ObsVideoInfo {
    graphics_module: *const c_char,
    fps_num: u32,
    fps_den: u32,
    base_width: u32,
    base_height: u32,
    output_width: u32,
    output_height: u32,
    output_format: i32,
    adapter: u32,
    gpu_conversion: bool,
    colorspace: i32,
    range: i32,
    scale_type: i32,
}

#[repr(C)]
struct ObsAudioInfo {
    samples_per_sec: u32,
    speakers: i32,
}

#[repr(C)]
struct Vec2 {
    x: f32,
    y: f32,
}

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<RecordingStatus>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureParams {
    settings: RecordingSettings,
    output_folder: String,
    replay_scratch_folder: String,
    obs_runtime_dir: Option<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarVersion {
    name: &'static str,
    version: &'static str,
    protocol_version: u32,
    capabilities: &'static [&'static str],
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingSettings {
    enabled: bool,
    capture_mode: RecordingCaptureMode,
    selected_display_id: String,
    allowed_games: Vec<RecordingAllowedGame>,
    #[serde(default)]
    denied_games: Vec<RecordingAllowedGame>,
    audio_mode: RecordingAudioMode,
    audio_devices: Vec<RecordingAudioDeviceSelection>,
    audio_applications: Vec<RecordingAudioApplicationSelection>,
    encoder: RecordingEncoder,
    gpu: String,
    codec: RecordingCodec,
    quality_profile: RecordingQualityProfile,
    resolution: RecordingResolution,
    fps: u32,
    bitrate: RecordingBitrate,
    custom_quality: RecordingQualitySettings,
    replay_buffer_seconds: u32,
    buffer_storage: RecordingBufferStorage,
    output_folder: String,
    hotkeys: RecordingHotkeys,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingAllowedGame {
    id: String,
    name: String,
    executable: Option<String>,
    path: Option<String>,
    #[serde(default)]
    window_class: Option<String>,
    #[serde(default)]
    icon_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingGameProcess {
    id: String,
    name: String,
    process_id: u32,
    executable: Option<String>,
    path: Option<String>,
    window_title: Option<String>,
    icon_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingGameGuessSource {
    DiscordDetectable,
    Manual,
    Plays,
    SteamPath,
    WindowsStore,
    Heuristic,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingGameGuessMatchKind {
    Executable,
    Path,
    Manual,
    Heuristic,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingGameGuess {
    source: RecordingGameGuessSource,
    source_id: Option<String>,
    name: String,
    aliases: Vec<String>,
    executable: Option<String>,
    path: Option<String>,
    window_title: Option<String>,
    window_class: Option<String>,
    icon_url: Option<String>,
    confidence: u8,
    match_kind: RecordingGameGuessMatchKind,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingDisplay {
    id: String,
    electron_id: Option<String>,
    name: String,
    width: u32,
    height: u32,
    primary: bool,
    thumbnail_data_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingQualitySettings {
    resolution: RecordingResolution,
    fps: u32,
    bitrate: RecordingBitrate,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingHotkeys {
    clip: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingAudioMode {
    Devices,
    Applications,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingAudioDeviceKind {
    Output,
    Input,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingAudioDeviceSelection {
    id: String,
    label: String,
    kind: RecordingAudioDeviceKind,
    enabled: bool,
    volume: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingAudioApplicationSelection {
    id: String,
    name: String,
    window: String,
    executable: Option<String>,
    #[serde(default)]
    icon_url: Option<String>,
    process_id: Option<u32>,
    enabled: bool,
    volume: u32,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingAudioLevelTarget {
    Device,
    Application,
}

/// One live loudness sample. `peak` is the linear peak amplitude (0..1) as
/// reported by WASAPI, pre-volume; the UI scales it by the row volume.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RecordingAudioLevel {
    target: RecordingAudioLevelTarget,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<RecordingAudioDeviceKind>,
    id: String,
    peak: f32,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingGame {
    id: Option<String>,
    name: String,
    process_id: u32,
    executable: Option<String>,
    path: Option<String>,
    icon_url: Option<String>,
    window_title: Option<String>,
    window_class: Option<String>,
    started_at: Option<String>,
    guess: Option<RecordingGameGuess>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingCaptureMode {
    Game,
    Display,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingEncoder {
    Hardware,
    Software,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingCodec {
    H264,
    Hevc,
    Av1,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingQualityProfile {
    Low,
    Standard,
    High,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingResolution {
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
#[serde(untagged)]
enum RecordingBitrate {
    Auto(String),
    Mbps(String),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingBufferStorage {
    Memory,
    Disk,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingCapture {
    id: String,
    filename: String,
    content_type: String,
    size_bytes: Option<u64>,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    game: Option<RecordingGame>,
    source: RecordingCaptureSource,
    kind: RecordingCaptureKind,
    post_process: Option<RecordingCapturePostProcess>,
    created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
enum RecordingCaptureSource {
    Game,
    Display,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
enum RecordingCaptureKind {
    Replay,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum RecordingCapturePostProcess {
    TrimTail {
        #[serde(rename = "keepMs")]
        keep_ms: u64,
    },
    ConcatSegments {
        #[serde(rename = "segmentPaths")]
        segment_paths: Vec<String>,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    backend: RecordingBackendState,
    mode: RecordingMode,
    capture_mode: RecordingCaptureMode,
    run_state: RecordingRunState,
    replay_active: bool,
    active_game: Option<String>,
    active_game_detail: Option<RecordingGame>,
    active_display: Option<RecordingDisplay>,
    focused: bool,
    current_source: Option<RecordingCaptureSource>,
    current_capture: Option<RecordingCapture>,
    replay_buffer_seconds: u32,
    available_gpus: Vec<String>,
    available_codecs: Vec<RecordingCodec>,
    available_audio_devices: Vec<RecordingAudioDeviceSelection>,
    available_audio_applications: Vec<RecordingAudioApplicationSelection>,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum RecordingBackendState {
    Missing,
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
enum RecordingMode {
    Idle,
    ReplayBuffer,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
enum RecordingRunState {
    Idle,
    Paused,
    ReplayBuffer,
    Stopping,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingActionResult {
    ok: bool,
    status: RecordingStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    capture: Option<RecordingCapture>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum RecordingEvent {
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
    Error {
        error: String,
        status: RecordingStatus,
    },
    AudioLevels {
        levels: Vec<RecordingAudioLevel>,
    },
}

#[derive(Serialize)]
struct EventEnvelope {
    event: RecordingEvent,
}

#[derive(Clone, Debug)]
struct DetectedGame {
    game: RecordingGame,
    obs_window: Option<String>,
    window_key: String,
    window_handle: isize,
    fullscreen: bool,
    force_display_capture: bool,
    capture_dimensions: Option<VideoDimensions>,
    hdr_enabled: bool,
    detection_score: i32,
}

#[derive(Clone, Debug)]
struct GameDetection {
    game: DetectedGame,
    focused: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VideoDimensions {
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ObsVideoConfig {
    base: VideoDimensions,
    output: VideoDimensions,
    fps: u32,
    hdr_enabled: bool,
}

#[derive(Clone, Copy)]
struct VideoGraph {
    scene: *mut ObsScene,
    source: *mut ObsSource,
    output_source: *mut ObsSource,
    source_kind: OutputSourceKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActiveOutputKind {
    ReplayBuffer,
}

#[derive(Clone)]
enum OutputConfig {
    ReplayBuffer {
        scratch_directory: PathBuf,
        output_directory: PathBuf,
        storage: RecordingBufferStorage,
        replay_seconds: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OutputSourceKind {
    Game,
    Display,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ObsEncoderDescriptor {
    id: String,
    kind: ObsEncoderKind,
    codec: String,
    caps: u32,
    display_name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ObsEncoderKind {
    Audio,
    Video,
}

impl ObsEncoderDescriptor {
    fn has_cap(&self, cap: u32) -> bool {
        self.caps & cap != 0
    }

    fn is_internal_or_deprecated(&self) -> bool {
        self.has_cap(OBS_ENCODER_CAP_INTERNAL) || self.has_cap(OBS_ENCODER_CAP_DEPRECATED)
    }
}

/// Codec support detected for the current GPU, cached so the settings UI can
/// render supported codecs without an active recording.
#[derive(Clone, Debug, Default)]
struct CodecCaps {
    /// Codecs the hardware (GPU) encoders can create.
    hardware: Vec<RecordingCodec>,
    /// Whether the software x264 encoder is present.
    software_h264: bool,
}

#[derive(Default)]
struct Recorder {
    obs: Option<LibObs>,
    obs_video_config: Option<ObsVideoConfig>,
    settings: Option<RecordingSettings>,
    output_folder: Option<PathBuf>,
    replay_scratch_folder: Option<PathBuf>,
    obs_runtime_dir: Option<PathBuf>,
    available_encoders: Vec<ObsEncoderDescriptor>,
    available_codecs: Vec<RecordingCodec>,
    /// Encoder capabilities probed independently of an active recording so the
    /// settings UI can show supported codecs while recording is disabled.
    codec_caps: Option<CodecCaps>,
    /// Adapter + GPU label + runtime the cached `codec_caps` were probed
    /// against; a change invalidates the cache and triggers a re-probe.
    codec_caps_key: Option<(u32, Option<String>, Option<PathBuf>)>,
    /// Adapter + GPU label + runtime and time of the last failed capability
    /// probe, so retries from the tick loop back off instead of spinning OBS up
    /// twice a second.
    codec_caps_failed_probe: Option<((u32, Option<String>, Option<PathBuf>), Instant)>,
    cached_gpus: Vec<String>,
    cached_gpus_at: Option<Instant>,
    cached_audio_devices: Vec<RecordingAudioDeviceSelection>,
    cached_audio_devices_at: Option<Instant>,
    cached_audio_applications: Vec<RecordingAudioApplicationSelection>,
    cached_audio_applications_at: Option<Instant>,
    cached_audio_applications_game_key: Option<String>,
    replay_session: Option<ActiveSession>,
    active_display: Option<RecordingDisplay>,
    active_game: Option<DetectedGame>,
    focused: bool,
    missing_game_ticks: u8,
    last_capture: Option<RecordingCapture>,
    last_error: Option<String>,
}

struct ActiveSession {
    kind: ActiveOutputKind,
    output: *mut ObsOutput,
    video_encoder: *mut ObsEncoder,
    audio_encoder: *mut ObsEncoder,
    video_graph: VideoGraph,
    video_config: ObsVideoConfig,
    audio_sources: Vec<*mut ObsSource>,
    source_kind: OutputSourceKind,
    output_config: OutputConfig,
    capture: RecordingCapture,
    can_pause: bool,
    paused: bool,
    owns_capture: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveReplayClipParams {
    requested_at_unix_ms: u64,
    duration_seconds: u32,
}

include!("sidecar_obs_bindings.rs");

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            capture_mode: RecordingCaptureMode::Game,
            selected_display_id: String::new(),
            allowed_games: Vec::new(),
            denied_games: Vec::new(),
            audio_mode: RecordingAudioMode::Devices,
            audio_devices: default_audio_devices()
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
            bitrate: RecordingBitrate::Auto("auto".to_string()),
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::R1080p,
                fps: 60,
                bitrate: RecordingBitrate::Auto("auto".to_string()),
            },
            replay_buffer_seconds: 90,
            buffer_storage: RecordingBufferStorage::Memory,
            output_folder: String::new(),
            hotkeys: RecordingHotkeys {
                clip: "F8".to_string(),
            },
        }
    }
}
