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
    long_recording: RecordingLongRecordingSettings,
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
struct RecordingLongRecordingSettings {
    auto_record_games: bool,
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
    clips: Vec<RecordingClipHotkey>,
    bookmark: String,
    screenshot: String,
    toggle_long_recording: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecordingClipHotkey {
    id: String,
    hotkey: String,
    duration_seconds: u32,
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
    chapter_status: RecordingChapterStatus,
    chapter_error: Option<String>,
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
    LongRecording,
    Screenshot,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RecordingChapterStatus {
    None,
    Ok,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    backend: RecordingBackendState,
    mode: RecordingMode,
    capture_mode: RecordingCaptureMode,
    run_state: RecordingRunState,
    replay_active: bool,
    long_recording_active: bool,
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
    Recording,
    ReplayBuffer,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
enum RecordingRunState {
    Idle,
    Recording,
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
    RecordingStarted {
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
    LongRecording,
    ReplayBuffer,
}

#[derive(Clone)]
enum OutputConfig {
    File { path: String },
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

#[derive(Default)]
struct Recorder {
    obs: Option<LibObs>,
    obs_video_config: Option<ObsVideoConfig>,
    settings: Option<RecordingSettings>,
    output_folder: Option<PathBuf>,
    replay_scratch_folder: Option<PathBuf>,
    obs_runtime_dir: Option<PathBuf>,
    available_encoders: Vec<String>,
    available_codecs: Vec<RecordingCodec>,
    cached_gpus: Vec<String>,
    cached_gpus_at: Option<Instant>,
    cached_audio_devices: Vec<RecordingAudioDeviceSelection>,
    cached_audio_devices_at: Option<Instant>,
    cached_audio_applications: Vec<RecordingAudioApplicationSelection>,
    cached_audio_applications_at: Option<Instant>,
    cached_audio_applications_game_key: Option<String>,
    replay_session: Option<ActiveSession>,
    long_session: Option<ActiveSession>,
    manual_long_recording: bool,
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
    started_at: SystemTime,
    can_pause: bool,
    paused: bool,
    paused_at: Option<SystemTime>,
    total_paused: Duration,
    owns_capture: bool,
    bookmarks: Vec<RecordingBookmark>,
}

#[derive(Clone, Debug)]
struct RecordingBookmark {
    requested_at: SystemTime,
    position_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordingActionRequest {
    requested_at_unix_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveReplayClipParams {
    requested_at_unix_ms: u64,
    duration_seconds: u32,
}

struct LibObs {
    _library: Library,
    obs_startup: unsafe extern "C" fn(*const c_char, *const c_char, *const c_char) -> bool,
    obs_initialized: unsafe extern "C" fn() -> bool,
    obs_shutdown: unsafe extern "C" fn(),
    obs_add_data_path: unsafe extern "C" fn(*const c_char),
    obs_add_module_path: unsafe extern "C" fn(*const c_char, *const c_char),
    obs_load_all_modules: unsafe extern "C" fn(),
    obs_open_module: unsafe extern "C" fn(*mut *mut ObsModule, *const c_char, *const c_char) -> i32,
    obs_init_module: unsafe extern "C" fn(*mut ObsModule) -> bool,
    obs_post_load_modules: unsafe extern "C" fn(),
    obs_reset_audio: unsafe extern "C" fn(*const ObsAudioInfo) -> bool,
    obs_reset_video: unsafe extern "C" fn(*mut ObsVideoInfo) -> i32,
    obs_set_video_levels: Option<unsafe extern "C" fn(f32, f32)>,
    obs_get_video: unsafe extern "C" fn() -> *mut ObsVideo,
    obs_get_audio: unsafe extern "C" fn() -> *mut ObsAudio,
    obs_enum_encoder_types: unsafe extern "C" fn(usize, *mut *const c_char) -> bool,
    obs_data_create: unsafe extern "C" fn() -> *mut ObsData,
    obs_data_release: unsafe extern "C" fn(*mut ObsData),
    obs_data_set_string: unsafe extern "C" fn(*mut ObsData, *const c_char, *const c_char),
    obs_data_set_int: unsafe extern "C" fn(*mut ObsData, *const c_char, i64),
    obs_data_set_bool: unsafe extern "C" fn(*mut ObsData, *const c_char, bool),
    obs_source_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        *mut ObsData,
    ) -> *mut ObsSource,
    obs_source_release: unsafe extern "C" fn(*mut ObsSource),
    obs_source_remove: unsafe extern "C" fn(*mut ObsSource),
    obs_source_set_audio_mixers: unsafe extern "C" fn(*mut ObsSource, u32),
    obs_source_set_volume: unsafe extern "C" fn(*mut ObsSource, f32),
    obs_source_get_signal_handler: unsafe extern "C" fn(*const ObsSource) -> *mut SignalHandler,
    obs_source_get_proc_handler: unsafe extern "C" fn(*const ObsSource) -> *mut ProcHandler,
    signal_handler_connect:
        unsafe extern "C" fn(*mut SignalHandler, *const c_char, SignalCallback, *mut c_void),
    signal_handler_disconnect:
        unsafe extern "C" fn(*mut SignalHandler, *const c_char, SignalCallback, *mut c_void),
    obs_set_output_source: unsafe extern "C" fn(u32, *mut ObsSource),
    obs_scene_create_private: unsafe extern "C" fn(*const c_char) -> *mut ObsScene,
    obs_scene_release: unsafe extern "C" fn(*mut ObsScene),
    obs_scene_get_source: unsafe extern "C" fn(*const ObsScene) -> *mut ObsSource,
    obs_scene_add: unsafe extern "C" fn(*mut ObsScene, *mut ObsSource) -> *mut ObsSceneItem,
    obs_sceneitem_set_bounds_type: unsafe extern "C" fn(*mut ObsSceneItem, i32),
    obs_sceneitem_set_bounds_alignment: unsafe extern "C" fn(*mut ObsSceneItem, u32),
    obs_sceneitem_set_bounds: unsafe extern "C" fn(*mut ObsSceneItem, *const Vec2),
    obs_sceneitem_set_scale_filter: unsafe extern "C" fn(*mut ObsSceneItem, i32),
    obs_video_encoder_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        *mut ObsData,
    ) -> *mut ObsEncoder,
    obs_audio_encoder_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        usize,
        *mut ObsData,
    ) -> *mut ObsEncoder,
    obs_encoder_set_video: unsafe extern "C" fn(*mut ObsEncoder, *mut ObsVideo),
    obs_encoder_set_audio: unsafe extern "C" fn(*mut ObsEncoder, *mut ObsAudio),
    obs_encoder_release: unsafe extern "C" fn(*mut ObsEncoder),
    obs_output_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        *mut ObsData,
    ) -> *mut ObsOutput,
    obs_output_update: unsafe extern "C" fn(*mut ObsOutput, *mut ObsData),
    obs_output_start: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_stop: unsafe extern "C" fn(*mut ObsOutput),
    obs_output_force_stop: unsafe extern "C" fn(*mut ObsOutput),
    obs_output_active: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_can_pause: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_pause: unsafe extern "C" fn(*mut ObsOutput, bool) -> bool,
    obs_output_paused: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_release: unsafe extern "C" fn(*mut ObsOutput),
    obs_output_get_last_error: unsafe extern "C" fn(*mut ObsOutput) -> *const c_char,
    obs_output_get_proc_handler: unsafe extern "C" fn(*mut ObsOutput) -> *mut ProcHandler,
    obs_output_set_video_encoder: unsafe extern "C" fn(*mut ObsOutput, *mut ObsEncoder),
    obs_output_set_audio_encoder: unsafe extern "C" fn(*mut ObsOutput, *mut ObsEncoder, usize),
    proc_handler_call: unsafe extern "C" fn(*mut ProcHandler, *const c_char, *mut CallData) -> bool,
    calldata_get_data:
        unsafe extern "C" fn(*const CallData, *const c_char, *mut c_void, usize) -> bool,
    calldata_get_string:
        unsafe extern "C" fn(*const CallData, *const c_char, *mut *const c_char) -> bool,
    bfree: unsafe extern "C" fn(*mut c_void),
}

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            capture_mode: RecordingCaptureMode::Game,
            selected_display_id: String::new(),
            long_recording: RecordingLongRecordingSettings {
                auto_record_games: false,
            },
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
                clips: vec![RecordingClipHotkey {
                    id: "default".to_string(),
                    hotkey: "F8".to_string(),
                    duration_seconds: 90,
                }],
                bookmark: "F8".to_string(),
                screenshot: "F7".to_string(),
                toggle_long_recording: "Alt+F7".to_string(),
            },
        }
    }
}

impl LibObs {
    fn load(runtime_dir: Option<&Path>) -> Result<Self, String> {
        let mut errors = Vec::new();
        for candidate in libobs_candidates(runtime_dir) {
            let library = unsafe { Library::new(&candidate) };
            let library = match library {
                Ok(library) => library,
                Err(error) => {
                    errors.push(format!("{}: {error}", candidate.display()));
                    continue;
                }
            };

            return unsafe {
                Ok(Self {
                    obs_startup: load_symbol(&library, b"obs_startup\0")?,
                    obs_initialized: load_symbol(&library, b"obs_initialized\0")?,
                    obs_shutdown: load_symbol(&library, b"obs_shutdown\0")?,
                    obs_add_data_path: load_symbol(&library, b"obs_add_data_path\0")?,
                    obs_add_module_path: load_symbol(&library, b"obs_add_module_path\0")?,
                    obs_load_all_modules: load_symbol(&library, b"obs_load_all_modules\0")?,
                    obs_open_module: load_symbol(&library, b"obs_open_module\0")?,
                    obs_init_module: load_symbol(&library, b"obs_init_module\0")?,
                    obs_post_load_modules: load_symbol(&library, b"obs_post_load_modules\0")?,
                    obs_reset_audio: load_symbol(&library, b"obs_reset_audio\0")?,
                    obs_reset_video: load_symbol(&library, b"obs_reset_video\0")?,
                    obs_set_video_levels: load_optional_symbol(
                        &library,
                        b"obs_set_video_levels\0",
                    ),
                    obs_get_video: load_symbol(&library, b"obs_get_video\0")?,
                    obs_get_audio: load_symbol(&library, b"obs_get_audio\0")?,
                    obs_enum_encoder_types: load_symbol(&library, b"obs_enum_encoder_types\0")?,
                    obs_data_create: load_symbol(&library, b"obs_data_create\0")?,
                    obs_data_release: load_symbol(&library, b"obs_data_release\0")?,
                    obs_data_set_string: load_symbol(&library, b"obs_data_set_string\0")?,
                    obs_data_set_int: load_symbol(&library, b"obs_data_set_int\0")?,
                    obs_data_set_bool: load_symbol(&library, b"obs_data_set_bool\0")?,
                    obs_source_create: load_symbol(&library, b"obs_source_create\0")?,
                    obs_source_release: load_symbol(&library, b"obs_source_release\0")?,
                    obs_source_remove: load_symbol(&library, b"obs_source_remove\0")?,
                    obs_source_set_audio_mixers: load_symbol(
                        &library,
                        b"obs_source_set_audio_mixers\0",
                    )?,
                    obs_source_set_volume: load_symbol(&library, b"obs_source_set_volume\0")?,
                    obs_source_get_signal_handler: load_symbol(
                        &library,
                        b"obs_source_get_signal_handler\0",
                    )?,
                    obs_source_get_proc_handler: load_symbol(
                        &library,
                        b"obs_source_get_proc_handler\0",
                    )?,
                    signal_handler_connect: load_symbol(&library, b"signal_handler_connect\0")?,
                    signal_handler_disconnect: load_symbol(
                        &library,
                        b"signal_handler_disconnect\0",
                    )?,
                    obs_set_output_source: load_symbol(&library, b"obs_set_output_source\0")?,
                    obs_scene_create_private: load_symbol(
                        &library,
                        b"obs_scene_create_private\0",
                    )?,
                    obs_scene_release: load_symbol(&library, b"obs_scene_release\0")?,
                    obs_scene_get_source: load_symbol(&library, b"obs_scene_get_source\0")?,
                    obs_scene_add: load_symbol(&library, b"obs_scene_add\0")?,
                    obs_sceneitem_set_bounds_type: load_symbol(
                        &library,
                        b"obs_sceneitem_set_bounds_type\0",
                    )?,
                    obs_sceneitem_set_bounds_alignment: load_symbol(
                        &library,
                        b"obs_sceneitem_set_bounds_alignment\0",
                    )?,
                    obs_sceneitem_set_bounds: load_symbol(
                        &library,
                        b"obs_sceneitem_set_bounds\0",
                    )?,
                    obs_sceneitem_set_scale_filter: load_symbol(
                        &library,
                        b"obs_sceneitem_set_scale_filter\0",
                    )?,
                    obs_video_encoder_create: load_symbol(&library, b"obs_video_encoder_create\0")?,
                    obs_audio_encoder_create: load_symbol(&library, b"obs_audio_encoder_create\0")?,
                    obs_encoder_set_video: load_symbol(&library, b"obs_encoder_set_video\0")?,
                    obs_encoder_set_audio: load_symbol(&library, b"obs_encoder_set_audio\0")?,
                    obs_encoder_release: load_symbol(&library, b"obs_encoder_release\0")?,
                    obs_output_create: load_symbol(&library, b"obs_output_create\0")?,
                    obs_output_update: load_symbol(&library, b"obs_output_update\0")?,
                    obs_output_start: load_symbol(&library, b"obs_output_start\0")?,
                    obs_output_stop: load_symbol(&library, b"obs_output_stop\0")?,
                    obs_output_force_stop: load_symbol(&library, b"obs_output_force_stop\0")?,
                    obs_output_active: load_symbol(&library, b"obs_output_active\0")?,
                    obs_output_can_pause: load_symbol(&library, b"obs_output_can_pause\0")?,
                    obs_output_pause: load_symbol(&library, b"obs_output_pause\0")?,
                    obs_output_paused: load_symbol(&library, b"obs_output_paused\0")?,
                    obs_output_release: load_symbol(&library, b"obs_output_release\0")?,
                    obs_output_get_last_error: load_symbol(
                        &library,
                        b"obs_output_get_last_error\0",
                    )?,
                    obs_output_get_proc_handler: load_symbol(
                        &library,
                        b"obs_output_get_proc_handler\0",
                    )?,
                    obs_output_set_video_encoder: load_symbol(
                        &library,
                        b"obs_output_set_video_encoder\0",
                    )?,
                    obs_output_set_audio_encoder: load_symbol(
                        &library,
                        b"obs_output_set_audio_encoder\0",
                    )?,
                    proc_handler_call: load_symbol(&library, b"proc_handler_call\0")?,
                    calldata_get_data: load_symbol(&library, b"calldata_get_data\0")?,
                    calldata_get_string: load_symbol(&library, b"calldata_get_string\0")?,
                    bfree: load_symbol(&library, b"bfree\0")?,
                    _library: library,
                })
            };
        }

        let detail = if errors.is_empty() {
            "no candidates were tried".to_string()
        } else {
            errors.join("; ")
        };
        Err(format!("Could not load libobs ({detail})."))
    }

    unsafe fn start(
        &self,
        runtime_dir: Option<&Path>,
        video_config: ObsVideoConfig,
        adapter: u32,
    ) -> Result<(), String> {
        self.add_paths(runtime_dir);
        let locale = CString::new("en-US").expect("static string has no nul byte");
        if !(self.obs_startup)(locale.as_ptr(), ptr::null(), ptr::null()) {
            return Err("OBS startup failed.".to_string());
        }
        if !(self.obs_initialized)() {
            return Err("OBS did not finish initialization.".to_string());
        }

        self.load_modules(runtime_dir)?;
        (self.obs_post_load_modules)();
        self.reset_audio()?;
        self.reset_video(video_config, adapter)?;
        Ok(())
    }

    unsafe fn shutdown(&self) {
        if (self.obs_initialized)() {
            (self.obs_shutdown)();
        }
    }

    unsafe fn add_paths(&self, runtime_dir: Option<&Path>) {
        let Some(runtime_dir) = runtime_dir else {
            return;
        };

        for data_path in [
            runtime_dir.join("data/libobs"),
            runtime_dir.join("data/effects"),
            runtime_dir.join("share/obs/libobs"),
        ] {
            self.add_data_path(&data_path);
        }

        for (bin_path, data_path) in [
            (
                runtime_dir.join("obs-plugins/64bit"),
                runtime_dir.join("data/obs-plugins/%module%"),
            ),
            (
                runtime_dir.join("obs-plugins"),
                runtime_dir.join("data/obs-plugins/%module%"),
            ),
            (
                runtime_dir.join("lib/obs-plugins"),
                runtime_dir.join("share/obs/obs-plugins/%module%"),
            ),
            (
                runtime_dir.join("lib64/obs-plugins"),
                runtime_dir.join("share/obs/obs-plugins/%module%"),
            ),
        ] {
            self.add_module_path(&bin_path, &data_path);
        }
    }

    unsafe fn add_data_path(&self, path: &Path) {
        if !path.exists() {
            return;
        }
        if let Ok(path) = cstring_path(path) {
            (self.obs_add_data_path)(path.as_ptr());
        }
    }

    unsafe fn add_module_path(&self, bin_path: &Path, data_path: &Path) {
        if !bin_path.exists() {
            return;
        }
        let Ok(bin_path) = cstring_path(bin_path) else {
            return;
        };
        let Ok(data_path) = cstring_path(data_path) else {
            return;
        };
        (self.obs_add_module_path)(bin_path.as_ptr(), data_path.as_ptr());
    }

    unsafe fn load_modules(&self, runtime_dir: Option<&Path>) -> Result<(), String> {
        let Some(runtime_dir) = runtime_dir else {
            (self.obs_load_all_modules)();
            return Ok(());
        };

        for module in platform_modules() {
            if let Err(error) = self.load_module(runtime_dir, module.name) {
                if module.required {
                    return Err(error);
                }
                eprintln!("[{SIDE_CAR_NAME}] optional OBS module skipped: {error}");
            }
        }
        Ok(())
    }

    unsafe fn load_module(&self, runtime_dir: &Path, module: &str) -> Result<(), String> {
        let bin_path = module_bin_path(runtime_dir, module);
        if !bin_path.exists() {
            return Ok(());
        }

        let data_path = runtime_dir.join("data/obs-plugins").join(module);
        let bin_path = cstring_path(&bin_path)?;
        let data_path = if data_path.exists() {
            Some(cstring_path(&data_path)?)
        } else {
            None
        };

        let mut loaded_module: *mut ObsModule = ptr::null_mut();
        let result = (self.obs_open_module)(
            &mut loaded_module,
            bin_path.as_ptr(),
            data_path
                .as_ref()
                .map(|path| path.as_ptr())
                .unwrap_or(ptr::null()),
        );
        if result != 0 {
            return Err(format!(
                "OBS module {module} failed to open with code {result}."
            ));
        }
        if loaded_module.is_null() {
            return Err(format!("OBS module {module} did not return a module handle."));
        }
        if !(self.obs_init_module)(loaded_module) {
            return Err(format!("OBS module {module} failed to initialize."));
        }
        Ok(())
    }

    unsafe fn reset_audio(&self) -> Result<(), String> {
        let info = ObsAudioInfo {
            samples_per_sec: 48_000,
            speakers: SPEAKERS_STEREO,
        };
        if !(self.obs_reset_audio)(&info) {
            return Err("OBS audio reset failed.".to_string());
        }
        Ok(())
    }

    unsafe fn reset_video(&self, video_config: ObsVideoConfig, adapter: u32) -> Result<(), String> {
        let graphics_module =
            CString::new(platform_graphics_module()).expect("static string has no nul byte");
        let mut info = ObsVideoInfo {
            graphics_module: graphics_module.as_ptr(),
            fps_num: video_config.fps,
            fps_den: 1,
            base_width: video_config.base.width,
            base_height: video_config.base.height,
            output_width: video_config.output.width,
            output_height: video_config.output.height,
            output_format: VIDEO_FORMAT_NV12,
            adapter,
            gpu_conversion: true,
            colorspace: VIDEO_CS_DEFAULT,
            range: VIDEO_RANGE_DEFAULT,
            scale_type: OBS_SCALE_BILINEAR,
        };
        if video_config.hdr_enabled {
            if let Some(obs_set_video_levels) = self.obs_set_video_levels {
                obs_set_video_levels(300.0, 1000.0);
            } else {
                eprintln!(
                    "[{SIDE_CAR_NAME}] OBS HDR video levels are unavailable in this libobs build."
                );
            }
        }
        let code = (self.obs_reset_video)(&mut info);
        if code != OBS_VIDEO_SUCCESS {
            return Err(format!("OBS video reset failed with code {code}."));
        }
        Ok(())
    }

    unsafe fn enumerate_encoders(&self) -> Vec<String> {
        let mut encoders = Vec::new();
        let mut index = 0usize;
        loop {
            let mut id: *const c_char = ptr::null();
            if !(self.obs_enum_encoder_types)(index, &mut id) {
                break;
            }
            if !id.is_null() {
                encoders.push(CStr::from_ptr(id).to_string_lossy().into_owned());
            }
            index += 1;
        }
        encoders
    }

    unsafe fn create_data(&self) -> *mut ObsData {
        (self.obs_data_create)()
    }

    unsafe fn release_data(&self, data: *mut ObsData) {
        if !data.is_null() {
            (self.obs_data_release)(data);
        }
    }

    unsafe fn set_string(&self, data: *mut ObsData, key: &str, value: &str) -> Result<(), String> {
        let key =
            CString::new(key).map_err(|_| "OBS setting key contained a nul byte.".to_string())?;
        let value = CString::new(value)
            .map_err(|_| "OBS setting value contained a nul byte.".to_string())?;
        (self.obs_data_set_string)(data, key.as_ptr(), value.as_ptr());
        Ok(())
    }

    unsafe fn set_int(&self, data: *mut ObsData, key: &str, value: i64) -> Result<(), String> {
        let key =
            CString::new(key).map_err(|_| "OBS setting key contained a nul byte.".to_string())?;
        (self.obs_data_set_int)(data, key.as_ptr(), value);
        Ok(())
    }

    unsafe fn set_bool(&self, data: *mut ObsData, key: &str, value: bool) -> Result<(), String> {
        let key =
            CString::new(key).map_err(|_| "OBS setting key contained a nul byte.".to_string())?;
        (self.obs_data_set_bool)(data, key.as_ptr(), value);
        Ok(())
    }
}
