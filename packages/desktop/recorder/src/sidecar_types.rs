#[repr(C)]
// SAFETY: This is passed to libobs as `struct calldata`; field order and C
// layout must stay in sync with OBS because C reads and writes these offsets.
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

#[derive(Clone, Debug)]
struct DetectedGame {
    game: RecordingGame,
    obs_window: Option<String>,
    window_key: String,
    window_handle: isize,
    fullscreen: bool,
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
struct ObsVideoConfig {
    base: VideoDimensions,
    output: VideoDimensions,
    fps: u32,
    hdr_enabled: bool,
}

struct VideoGraph {
    scene: *mut ObsScene,
    source: *mut ObsSource,
    output_source: *mut ObsSource,
    source_kind: OutputSourceKind,
}

struct AudioGraph {
    /// Audio capture sources attached directly to OBS output channels
    /// `AUDIO_OUTPUT_CHANNEL_BASE + i` in order.
    sources: Vec<*mut ObsSource>,
    /// Settings selector paired with each entry in `sources`, so volume edits
    /// can update the live graph without rebuilding it.
    selectors: Vec<String>,
}

#[derive(Clone)]
struct ReplayBufferConfig {
    scratch_directory: PathBuf,
    output_directory: PathBuf,
    storage: RecordingBufferStorage,
    replay_seconds: u32,
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

/// Inputs a codec capability probe depends on; cached results are only valid
/// while these stay unchanged.
#[derive(PartialEq, Eq)]
struct CodecCapsKey {
    adapter: u32,
    gpu_label: Option<String>,
    runtime_dir: Option<PathBuf>,
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
    /// Probe inputs the cached `codec_caps` were probed against; a change
    /// invalidates the cache and triggers a re-probe.
    codec_caps_key: Option<CodecCapsKey>,
    /// Probe inputs and time of the last failed capability probe, so retries
    /// from the tick loop back off instead of spinning OBS up twice a second.
    codec_caps_failed_probe: Option<(CodecCapsKey, Instant)>,
    cached_gpus: Vec<String>,
    cached_gpus_at: Option<Instant>,
    cached_audio_devices: Vec<RecordingAudioDevice>,
    cached_audio_devices_at: Option<Instant>,
    cached_audio_applications: Vec<RecordingAudioApplicationSelection>,
    cached_audio_applications_at: Option<Instant>,
    cached_audio_applications_game_key: Option<String>,
    replay_session: Option<ActiveSession>,
    active_display: Option<RecordingDisplay>,
    active_game: Option<DetectedGame>,
    focused: bool,
    missing_game_ticks: u8,
    last_telemetry_event_at: Option<Instant>,
    last_capture: Option<RecordingCapture>,
    last_error: Option<String>,
}

struct ActiveSession {
    output: *mut ObsOutput,
    video_encoder: *mut ObsEncoder,
    /// Reads OBS mixer 0, which contains every audio source.
    audio_encoder: *mut ObsEncoder,
    video_encoder_id: String,
    audio_encoder_id: String,
    video_codec: RecordingCodec,
    video_graph: VideoGraph,
    video_config: ObsVideoConfig,
    audio_graph: AudioGraph,
    source_kind: OutputSourceKind,
    output_config: ReplayBufferConfig,
    capture: RecordingCapture,
    target_game_key: Option<String>,
    game_content_expires_at: Option<Instant>,
    game_capture_hook_wait: Option<GameCaptureHookWait>,
    can_pause: bool,
    paused: bool,
}

#[derive(Debug)]
struct GameCaptureHookWait {
    started_at: Instant,
    last_logged_attempt: u32,
}

include!("sidecar_obs_bindings.rs");
