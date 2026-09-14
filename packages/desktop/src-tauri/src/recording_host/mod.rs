mod models;

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env, fmt,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use fs2::{available_space, total_space};
use models::*;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, Notify, RwLock, broadcast, oneshot},
    time::{sleep, timeout},
};

pub use models::{
    AGENT_NAME, AGENT_PROTOCOL_VERSION, CaptureManifest, EventEnvelope,
    PlayNotificationSoundRequest, RecorderHostOptions, RecordingActionResult, RecordingAllowedGame,
    RecordingAudioApplicationSelection, RecordingAudioDevice, RecordingAudioDeviceKind,
    RecordingAudioDeviceSelection, RecordingAudioLevel, RecordingAudioLevelTarget,
    RecordingAudioMode, RecordingBackendState, RecordingBitrate, RecordingBufferStorage,
    RecordingCapture, RecordingCaptureKind, RecordingCaptureMode, RecordingCapturePostProcess,
    RecordingCaptureSource, RecordingCodec, RecordingDisplay, RecordingEncoder, RecordingEvent,
    RecordingGame, RecordingGameGuess, RecordingGameGuessMatchKind, RecordingGameGuessSource,
    RecordingGameProcess, RecordingHotkeys, RecordingMode, RecordingNotificationSoundSettings,
    RecordingNotificationSounds, RecordingQualityProfile, RecordingQualitySettings,
    RecordingResolution, RecordingRunState, RecordingSettings, RecordingStatus,
    RecordingStorageInfo, RecordingTelemetry, SaveReplayClipRequest, SidecarVersion,
};
const SETTINGS_FILE: &str = "recording-settings.json";
const CAPTURES_FILE: &str = "recording-captures.json";
const CAPTURE_EXTENSIONS: &[&str] = &["mp4", "mkv", "mov", "webm", "png", "jpg", "jpeg", "webp"];
const DISCORD_DETECTABLE_URL: &str = "https://discord.com/api/v9/applications/detectable";
const DISCORD_CACHE_FILE_NAME: &str = "discord-detections.v1.json";
const DISCORD_CACHE_SCHEMA_VERSION: u32 = 1;
const DISCORD_CACHE_TTL_SECONDS: i64 = 24 * 60 * 60;
const DISCORD_REFRESH_INTERVAL: Duration = Duration::from_secs(60 * 60);
const DISCORD_FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const DISCORD_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
// The detectable-applications payload is ~13 MB as of 2026 and keeps growing.
const DISCORD_MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const DISCORD_MAX_ROWS: usize = 100_000;

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordDetectionCache {
    schema_version: u32,
    source: String,
    source_url: String,
    fetched_at: Option<String>,
    games: Vec<DiscordDetectionGame>,
    executables: BTreeMap<String, Vec<DiscordExecutableRule>>,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordDetectionGame {
    id: String,
    name: String,
    aliases: Vec<String>,
    icon_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordExecutableRule {
    game_id: String,
    is_launcher: bool,
    score: i32,
}

#[derive(Debug)]
pub enum RecorderHostError {
    Io {
        context: String,
        source: io::Error,
    },
    Json {
        context: String,
        source: serde_json::Error,
    },
    InvalidSettings(String),
    InvalidRequest(String),
    MissingExecutable(PathBuf),
    Protocol(String),
    Process(String),
    Timeout {
        method: String,
    },
    Shutdown,
}

impl fmt::Display for RecorderHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { context, source } => write!(formatter, "{context}: {source}"),
            Self::Json { context, source } => write!(formatter, "{context}: {source}"),
            Self::InvalidSettings(message) => {
                write!(formatter, "Invalid recording settings: {message}")
            }
            Self::InvalidRequest(message) => {
                write!(formatter, "Invalid recording request: {message}")
            }
            Self::MissingExecutable(path) => {
                write!(formatter, "Alloy recorder is missing: {}", path.display())
            }
            Self::Protocol(message) => {
                write!(formatter, "Alloy recorder protocol error: {message}")
            }
            Self::Process(message) => write!(formatter, "Alloy recorder process error: {message}"),
            Self::Timeout { method } => {
                write!(formatter, "Alloy recorder timed out during {method}.")
            }
            Self::Shutdown => formatter.write_str("Alloy recorder host is shut down."),
        }
    }
}

impl std::error::Error for RecorderHostError {}

fn io_error(context: impl Into<String>, source: io::Error) -> RecorderHostError {
    RecorderHostError::Io {
        context: context.into(),
        source,
    }
}

fn json_error(context: impl Into<String>, source: serde_json::Error) -> RecorderHostError {
    RecorderHostError::Json {
        context: context.into(),
        source,
    }
}

#[derive(Debug)]
struct PendingResponse {
    sender: oneshot::Sender<Result<WireResponse, RecorderHostError>>,
}

struct Session {
    id: u64,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, PendingResponse>>,
    next_id: AtomicU64,
    alive: AtomicBool,
    exited: AtomicBool,
    kill_notify: Notify,
}

impl Session {
    fn spawn(inner: &Arc<Inner>) -> Result<Arc<Self>, RecorderHostError> {
        let options = &inner.options;
        if !options.executable.is_file() {
            return Err(RecorderHostError::MissingExecutable(
                options.executable.clone(),
            ));
        }

        let mut command = Command::new(&options.executable);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("ALLOY_RECORDING_HOST", "1");
        configure_runtime_environment(&mut command, options, inner.discord_cache_path.as_deref());

        #[cfg(windows)]
        {
            command.creation_flags(0x0800_0000);
        }

        let mut child = command.spawn().map_err(|source| {
            io_error(
                format!(
                    "Failed to start Alloy recorder {}",
                    options.executable.display()
                ),
                source,
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            RecorderHostError::Process("Alloy recorder stdin was not available.".into())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            RecorderHostError::Process("Alloy recorder stdout was not available.".into())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            RecorderHostError::Process("Alloy recorder stderr was not available.".into())
        })?;
        let id = inner.next_session_id.fetch_add(1, Ordering::Relaxed);
        let session = Arc::new(Self {
            id,
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            exited: AtomicBool::new(false),
            kill_notify: Notify::new(),
        });

        let stdout_session = Arc::clone(&session);
        let stdout_inner = Arc::downgrade(inner);
        let max_line_bytes = options.max_line_bytes;
        tokio::spawn(async move {
            read_stdout(stdout, stdout_session, stdout_inner, max_line_bytes).await;
        });

        let stderr_inner = Arc::downgrade(inner);
        tokio::spawn(async move {
            read_stderr(stderr, stderr_inner, max_line_bytes).await;
        });

        let wait_session = Arc::clone(&session);
        let wait_inner = Arc::downgrade(inner);
        tokio::spawn(async move {
            wait_for_exit(child, wait_session, wait_inner).await;
        });

        if !options.heartbeat_interval.is_zero() {
            let heartbeat_session = Arc::clone(&session);
            let heartbeat_inner = Arc::downgrade(inner);
            let interval = options.heartbeat_interval;
            let request_timeout = options.request_timeout;
            tokio::spawn(async move {
                heartbeat(
                    heartbeat_session,
                    heartbeat_inner,
                    interval,
                    request_timeout,
                )
                .await;
            });
        }

        Ok(session)
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    async fn request(
        &self,
        method: &str,
        params: Value,
        request_timeout: Duration,
    ) -> Result<WireResponse, RecorderHostError> {
        if !self.is_alive() {
            return Err(RecorderHostError::Process(
                "Alloy recorder is not running.".into(),
            ));
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let timeout_millis = u64::try_from(request_timeout.as_millis()).unwrap_or(u64::MAX);
        let request = WireRequest {
            id,
            method: method.to_string(),
            params,
            deadline_unix_ms: Some(now_unix_millis().saturating_add(timeout_millis)),
        };
        let line = serde_json::to_string(&request)
            .map_err(|source| json_error("Failed to encode recorder request", source))?;
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(id, PendingResponse { sender });

        let started = Instant::now();
        let write_result = async {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.write_all(b"\n").await
        }
        .await;
        if let Err(source) = write_result {
            self.pending.lock().await.remove(&id);
            self.mark_dead(RecorderHostError::Process(format!(
                "Failed to write {method}: {source}"
            )))
            .await;
            return Err(io_error(
                format!("Failed to write recorder {method}"),
                source,
            ));
        }

        let remaining = request_timeout.saturating_sub(started.elapsed());
        match timeout(remaining, receiver).await {
            Ok(Ok(Ok(response))) => Ok(response),
            Ok(Ok(Err(error))) => Err(error),
            Ok(Err(_)) => Err(RecorderHostError::Process(
                "Alloy recorder stopped while handling a request.".into(),
            )),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(RecorderHostError::Timeout {
                    method: method.to_string(),
                })
            }
        }
    }

    async fn mark_dead(&self, error: RecorderHostError) {
        if self.alive.swap(false, Ordering::AcqRel) {
            let mut pending = self.pending.lock().await;
            for (_, entry) in pending.drain() {
                let _ = entry
                    .sender
                    .send(Err(RecorderHostError::Process(error.to_string())));
            }
        }
    }

    async fn fail_pending(&self, message: &str) {
        self.alive.store(false, Ordering::Release);
        let mut pending = self.pending.lock().await;
        for (_, entry) in pending.drain() {
            let _ = entry
                .sender
                .send(Err(RecorderHostError::Process(message.to_string())));
        }
    }

    async fn stop(&self, options: &RecorderHostOptions) -> bool {
        let _ = timeout(
            options.shutdown_request_timeout,
            self.request("shutdown", Value::Null, options.shutdown_request_timeout),
        )
        .await;
        self.alive.store(false, Ordering::Release);

        {
            let mut stdin = self.stdin.lock().await;
            let _ = stdin.shutdown().await;
        }

        self.wait_until_exited(options.graceful_exit_timeout).await;
        if self.exited.load(Ordering::Acquire) {
            self.fail_pending("Alloy recorder stopped.").await;
            return true;
        }
        self.kill_notify.notify_one();
        let exited = self.wait_until_exited(options.forced_exit_timeout).await;
        self.fail_pending("Alloy recorder was terminated.").await;
        exited
    }

    async fn wait_until_exited(&self, duration: Duration) -> bool {
        let deadline = Instant::now() + duration;
        while !self.exited.load(Ordering::Acquire) && Instant::now() < deadline {
            sleep(Duration::from_millis(20)).await;
        }
        self.exited.load(Ordering::Acquire)
    }
}

struct RespawnState {
    consecutive: u32,
    last_started: Option<Instant>,
    scheduled: bool,
}

struct Inner {
    options: RecorderHostOptions,
    discord_cache_path: Option<PathBuf>,
    discord_refresh_started: AtomicBool,
    settings: RwLock<RecordingSettings>,
    status: RwLock<RecordingStatus>,
    capabilities: RwLock<Vec<String>>,
    captures: Mutex<CaptureManifest>,
    emitted_captures: Mutex<HashSet<String>>,
    completed_captures: Mutex<HashMap<String, RecordingCapture>>,
    events: broadcast::Sender<RecordingEvent>,
    session: Mutex<Option<Arc<Session>>>,
    start_lock: Mutex<()>,
    configure_lock: Mutex<()>,
    applied_settings: Mutex<Option<RecordingSettings>>,
    respawn: Mutex<RespawnState>,
    shutdown: AtomicBool,
    next_session_id: AtomicU64,
}

#[derive(Clone)]
pub struct RecorderHost {
    inner: Arc<Inner>,
}

impl RecorderHost {
    pub fn new(options: RecorderHostOptions) -> Result<Self, RecorderHostError> {
        fs::create_dir_all(&options.state_dir)
            .map_err(|source| io_error("Failed to create recording state folder", source))?;
        let settings = load_json_or_default(&options.state_dir.join(SETTINGS_FILE))?;
        validate_settings(&settings)?;
        let captures = load_json_or_default(&options.state_dir.join(CAPTURES_FILE))?;
        let discord_cache_path = options
            .discord_detection_cache_path
            .clone()
            .or_else(|| {
                Some(
                    options
                        .state_dir
                        .join("recording")
                        .join(DISCORD_CACHE_FILE_NAME),
                )
            })
            .filter(|path| match prepare_discord_detection_cache(path) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!(
                        "[alloy-recording-host] failed to prepare Discord detection cache {}: {error}",
                        path.display()
                    );
                    false
                }
            });
        let (events, _) = broadcast::channel(256);
        let status = unavailable_status(&settings, None);
        Ok(Self {
            inner: Arc::new(Inner {
                options,
                discord_cache_path,
                discord_refresh_started: AtomicBool::new(false),
                settings: RwLock::new(settings),
                status: RwLock::new(status),
                capabilities: RwLock::new(Vec::new()),
                captures: Mutex::new(captures),
                emitted_captures: Mutex::new(HashSet::new()),
                completed_captures: Mutex::new(HashMap::new()),
                events,
                session: Mutex::new(None),
                start_lock: Mutex::new(()),
                configure_lock: Mutex::new(()),
                applied_settings: Mutex::new(None),
                respawn: Mutex::new(RespawnState {
                    consecutive: 0,
                    last_started: None,
                    scheduled: false,
                }),
                shutdown: AtomicBool::new(false),
                next_session_id: AtomicU64::new(1),
            }),
        })
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<RecordingEvent> {
        self.inner.events.subscribe()
    }

    pub async fn get_settings(&self) -> RecordingSettings {
        self.inner.settings.read().await.clone()
    }

    pub async fn set_settings(
        &self,
        settings: RecordingSettings,
    ) -> Result<RecordingSettings, RecorderHostError> {
        validate_settings(&settings)?;
        write_json_atomic(&self.inner.options.state_dir.join(SETTINGS_FILE), &settings)?;
        *self.inner.settings.write().await = settings.clone();
        *self.inner.applied_settings.lock().await = None;
        self.refresh_status_settings(&settings).await;
        let _ = self.inner.events.send(RecordingEvent::Status {
            status: self.get_status().await,
        });
        Ok(settings)
    }

    pub async fn get_status(&self) -> RecordingStatus {
        self.inner.status.read().await.clone()
    }

    pub async fn configure(&self) -> Result<RecordingStatus, RecorderHostError> {
        let settings = self.get_settings().await;
        self.configure_with_settings(&settings).await
    }

    pub async fn configure_with_settings(
        &self,
        settings: &RecordingSettings,
    ) -> Result<RecordingStatus, RecorderHostError> {
        validate_settings(settings)?;
        let _configure = self.inner.configure_lock.lock().await;
        let session = self.ensure_session().await?;
        if self
            .inner
            .applied_settings
            .lock()
            .await
            .as_ref()
            .is_some_and(|applied| applied == settings)
        {
            let response = session
                .request("status", Value::Null, self.inner.options.request_timeout)
                .await?;
            let status: RecordingStatus = decode_response(response, "status")?;
            self.apply_status(status.clone()).await;
            return Ok(status);
        }
        let response = session
            .request(
                "configure",
                self.configure_params(settings).await?,
                self.inner.options.configure_timeout,
            )
            .await?;
        let status: RecordingStatus = decode_response(response, "configure")?;
        self.apply_status(status.clone()).await;
        *self.inner.applied_settings.lock().await = Some(settings.clone());
        Ok(status)
    }

    pub async fn restart(&self) -> Result<RecordingStatus, RecorderHostError> {
        self.inner.shutdown.store(true, Ordering::Release);
        self.stop_current_session().await;
        {
            let mut respawn = self.inner.respawn.lock().await;
            respawn.consecutive = 0;
            respawn.last_started = None;
            respawn.scheduled = false;
        }
        *self.inner.applied_settings.lock().await = None;
        self.inner.shutdown.store(false, Ordering::Release);
        self.configure().await
    }

    pub async fn shutdown(&self) -> bool {
        self.inner.shutdown.store(true, Ordering::Release);
        self.stop_current_session().await
    }

    pub async fn list_game_processes(
        &self,
    ) -> Result<Vec<RecordingGameProcess>, RecorderHostError> {
        let result = self
            .request_value(
                "listGameProcesses",
                Value::Null,
                self.inner.options.request_timeout,
            )
            .await?;
        decode_value(result, "listGameProcesses")
    }

    pub async fn list_displays(&self) -> Result<Vec<RecordingDisplay>, RecorderHostError> {
        let result = self
            .request_value(
                "listDisplays",
                Value::Null,
                self.inner.options.request_timeout,
            )
            .await?;
        decode_value(result, "listDisplays")
    }

    pub async fn save_replay_clip(
        &self,
        request: SaveReplayClipRequest,
    ) -> Result<RecordingActionResult, RecorderHostError> {
        if request.duration_seconds == 0 || request.duration_seconds > 600 {
            return Err(RecorderHostError::InvalidRequest(
                "Replay duration must be between 1 and 600 seconds.".into(),
            ));
        }
        let result = self
            .request_value(
                "saveReplayClip",
                serde_json::to_value(request)
                    .map_err(|source| json_error("Failed to encode replay request", source))?,
                self.inner.options.request_timeout,
            )
            .await?;
        let result: RecordingActionResult = decode_value(result, "saveReplayClip")?;
        self.remember_action_capture(&result).await?;
        Ok(result)
    }

    pub async fn save_screenshot(&self) -> Result<RecordingActionResult, RecorderHostError> {
        let _session = self.ensure_session().await?;
        if !self
            .inner
            .capabilities
            .read()
            .await
            .iter()
            .any(|capability| capability == "screenshots")
        {
            return Err(RecorderHostError::Protocol(
                "Update the Alloy recorder to save screenshots.".into(),
            ));
        }
        let result = self
            .request_value(
                "saveScreenshot",
                Value::Null,
                self.inner.options.request_timeout,
            )
            .await?;
        let result: RecordingActionResult = decode_value(result, "saveScreenshot")?;
        self.remember_action_capture(&result).await?;
        Ok(result)
    }

    pub async fn subscribe_audio_levels(&self) -> Result<(), RecorderHostError> {
        let result = self
            .request_value(
                "subscribeAudioLevels",
                Value::Null,
                self.inner.options.request_timeout,
            )
            .await?;
        ensure_null_result(result, "subscribeAudioLevels")
    }

    pub async fn stop_audio_levels(&self) -> Result<(), RecorderHostError> {
        let result = self
            .request_value(
                "stopAudioLevels",
                Value::Null,
                self.inner.options.request_timeout,
            )
            .await?;
        ensure_null_result(result, "stopAudioLevels")
    }

    pub async fn play_notification_sound(
        &self,
        request: PlayNotificationSoundRequest,
    ) -> Result<(), RecorderHostError> {
        if request.path.trim().is_empty() || request.path.contains('\0') {
            return Err(RecorderHostError::InvalidRequest(
                "Notification sound path must be non-empty.".into(),
            ));
        }
        if !request.volume.is_finite() || !(0.0..=1.0).contains(&request.volume) {
            return Err(RecorderHostError::InvalidRequest(
                "Notification sound volume must be between 0 and 1.".into(),
            ));
        }
        let result = self
            .request_value(
                "playNotificationSound",
                serde_json::to_value(request)
                    .map_err(|source| json_error("Failed to encode sound request", source))?,
                self.inner.options.request_timeout,
            )
            .await?;
        ensure_null_result(result, "playNotificationSound")
    }

    pub async fn storage_info(&self) -> Result<RecordingStorageInfo, RecorderHostError> {
        let settings = self.get_settings().await;
        let folder = effective_output_folder(&self.inner.options, &settings);
        fs::create_dir_all(&folder).map_err(|source| {
            io_error(
                format!("Failed to create capture folder {}", folder.display()),
                source,
            )
        })?;
        let total_bytes = total_space(&folder).map_err(|source| {
            io_error(
                format!("Failed to read disk size for {}", folder.display()),
                source,
            )
        })?;
        let available_bytes = available_space(&folder).map_err(|source| {
            io_error(
                format!("Failed to read free disk space for {}", folder.display()),
                source,
            )
        })?;
        Ok(RecordingStorageInfo {
            output_folder: folder.to_string_lossy().into_owned(),
            total_bytes,
            used_bytes: total_bytes.saturating_sub(available_bytes),
            available_bytes,
            clips_bytes: sum_capture_bytes(&folder),
        })
    }

    pub async fn captures(&self) -> Vec<RecordingCapture> {
        self.inner.captures.lock().await.captures.clone()
    }

    pub async fn remove_capture(&self, id: &str) -> Result<bool, RecorderHostError> {
        let mut manifest = self.inner.captures.lock().await;
        let before = manifest.captures.len();
        manifest.captures.retain(|capture| capture.id != id);
        if manifest.captures.len() == before {
            return Ok(false);
        }
        write_json_atomic(
            &self.inner.options.state_dir.join(CAPTURES_FILE),
            &*manifest,
        )?;
        Ok(true)
    }

    /// Mark a capture complete after the capture library has persisted it.
    ///
    /// The recorder manifest is the recovery queue for raw captures. Keep the
    /// entry until the caller confirms that finalization and library storage
    /// both succeeded. The completed value also protects status updates from
    /// replacing finalized metadata with the recorder's raw post-process
    /// metadata.
    pub async fn complete_capture(
        &self,
        capture: RecordingCapture,
    ) -> Result<(), RecorderHostError> {
        let mut manifest = self.inner.captures.lock().await;
        let original = manifest.clone();
        let before = manifest.captures.len();
        manifest
            .captures
            .retain(|pending| !captures_match(pending, &capture));
        if manifest.captures.len() != before
            && let Err(error) = write_json_atomic(
                &self.inner.options.state_dir.join(CAPTURES_FILE),
                &*manifest,
            )
        {
            *manifest = original;
            return Err(error);
        }
        drop(manifest);

        {
            let mut completed = self.inner.completed_captures.lock().await;
            for key in capture_identity_keys(&capture) {
                completed.insert(key, capture.clone());
            }
        }

        let mut status = self.inner.status.write().await;
        if status
            .current_capture
            .as_ref()
            .is_some_and(|current| captures_match(current, &capture))
        {
            status.current_capture = Some(capture);
        }
        Ok(())
    }

    async fn ensure_session(&self) -> Result<Arc<Session>, RecorderHostError> {
        ensure_session(&self.inner).await
    }

    async fn configure_params(
        &self,
        settings: &RecordingSettings,
    ) -> Result<Value, RecorderHostError> {
        let output_folder = effective_output_folder(&self.inner.options, settings);
        fs::create_dir_all(&output_folder).map_err(|source| {
            io_error(
                format!(
                    "Failed to create capture folder {}",
                    output_folder.display()
                ),
                source,
            )
        })?;
        fs::create_dir_all(&self.inner.options.agent_state_folder)
            .map_err(|source| io_error("Failed to create recorder state folder", source))?;
        fs::create_dir_all(&self.inner.options.replay_scratch_folder)
            .map_err(|source| io_error("Failed to create replay scratch folder", source))?;
        serde_json::to_value(json!({
            "settings": settings,
            "agentStateFolder": self.inner.options.agent_state_folder,
            "outputFolder": output_folder,
            "replayScratchFolder": self.inner.options.replay_scratch_folder,
            "obsRuntimeDir": self.inner.options.obs_runtime_dir,
            "discordDetectionCachePath": self.inner.discord_cache_path,
        }))
        .map_err(|source| json_error("Failed to encode recorder configuration", source))
    }

    async fn request_value(
        &self,
        method: &str,
        params: Value,
        request_timeout: Duration,
    ) -> Result<Value, RecorderHostError> {
        let session = self.ensure_session().await?;
        let response = session.request(method, params, request_timeout).await?;
        if let Some(status) = response.status.as_ref() {
            self.apply_status(status.clone()).await;
        }
        decode_response(response, method)
    }

    async fn remember_action_capture(
        &self,
        result: &RecordingActionResult,
    ) -> Result<(), RecorderHostError> {
        self.apply_status(result.status.clone()).await;
        if let Some(capture) = &result.capture {
            self.remember_capture(capture.clone()).await?;
        }
        Ok(())
    }

    async fn remember_capture(&self, capture: RecordingCapture) -> Result<(), RecorderHostError> {
        let mut manifest = self.inner.captures.lock().await;
        let original = manifest.clone();
        if let Some(existing) = manifest
            .captures
            .iter_mut()
            .find(|entry| entry.id == capture.id || entry.filename == capture.filename)
        {
            *existing = capture;
        } else {
            manifest.captures.push(capture);
        }
        if let Err(error) = write_json_atomic(
            &self.inner.options.state_dir.join(CAPTURES_FILE),
            &*manifest,
        ) {
            *manifest = original;
            return Err(error);
        }
        Ok(())
    }

    async fn apply_status(&self, status: RecordingStatus) {
        apply_status_inner(&self.inner, status).await;
    }

    async fn refresh_status_settings(&self, settings: &RecordingSettings) {
        let mut status = self.inner.status.write().await;
        status.capture_mode = settings.capture_mode.clone();
        status.replay_buffer_seconds = settings.replay_buffer_seconds;
        status.available_audio_applications = settings.audio_applications.clone();
    }

    async fn stop_current_session(&self) -> bool {
        let session = self.inner.session.lock().await.take();
        match session {
            Some(session) => session.stop(&self.inner.options).await,
            None => true,
        }
    }
}

async fn ensure_session(inner: &Arc<Inner>) -> Result<Arc<Session>, RecorderHostError> {
    if inner.shutdown.load(Ordering::Acquire) {
        return Err(RecorderHostError::Shutdown);
    }
    if let Some(session) = inner.session.lock().await.clone()
        && session.is_alive()
    {
        return Ok(session);
    }

    let _start = inner.start_lock.lock().await;
    if inner.shutdown.load(Ordering::Acquire) {
        return Err(RecorderHostError::Shutdown);
    }
    if let Some(session) = inner.session.lock().await.clone()
        && session.is_alive()
    {
        return Ok(session);
    }

    start_discord_detection_refresh(inner);
    let session = Session::spawn(inner)?;
    {
        let mut respawn = inner.respawn.lock().await;
        respawn.last_started = Some(Instant::now());
    }
    *inner.session.lock().await = Some(Arc::clone(&session));

    let startup = async {
        let version_value = session
            .request("version", Value::Null, inner.options.request_timeout)
            .await
            .map_err(|error| error.to_string())?;
        let version: SidecarVersion =
            decode_response(version_value, "version").map_err(|error| error.to_string())?;
        if version.name != AGENT_NAME || version.protocol_version != AGENT_PROTOCOL_VERSION {
            return Err(format!(
                "Incompatible Alloy agent {} protocol {}; expected {} protocol {}.",
                version.name, version.protocol_version, AGENT_NAME, AGENT_PROTOCOL_VERSION
            ));
        }
        *inner.capabilities.write().await = version.capabilities;
        let settings = inner.settings.read().await.clone();
        let output_folder = effective_output_folder(&inner.options, &settings);
        fs::create_dir_all(&output_folder)
            .map_err(|error| format!("Failed to create capture folder: {error}"))?;
        fs::create_dir_all(&inner.options.agent_state_folder)
            .map_err(|error| format!("Failed to create recorder state folder: {error}"))?;
        fs::create_dir_all(&inner.options.replay_scratch_folder)
            .map_err(|error| format!("Failed to create replay scratch folder: {error}"))?;
        let config = json!({
            "settings": settings,
            "agentStateFolder": inner.options.agent_state_folder,
            "outputFolder": output_folder,
            "replayScratchFolder": inner.options.replay_scratch_folder,
            "obsRuntimeDir": inner.options.obs_runtime_dir,
            "discordDetectionCachePath": inner.discord_cache_path,
        });
        let configure_value = session
            .request("configure", config, inner.options.configure_timeout)
            .await
            .map_err(|error| error.to_string())?;
        let status: RecordingStatus =
            decode_response(configure_value, "configure").map_err(|error| error.to_string())?;
        apply_status_inner(inner, status).await;
        *inner.applied_settings.lock().await = Some(settings);
        Ok::<(), String>(())
    }
    .await;

    if let Err(message) = startup {
        if inner
            .session
            .lock()
            .await
            .as_ref()
            .is_some_and(|current| current.id == session.id)
        {
            inner.session.lock().await.take();
        }
        session.stop(&inner.options).await;
        inner.capabilities.write().await.clear();
        set_error_status(inner, message.clone()).await;
        schedule_respawn(inner);
        return Err(RecorderHostError::Protocol(message));
    }
    Ok(session)
}

async fn wait_for_exit(mut child: Child, session: Arc<Session>, inner: Weak<Inner>) {
    let result = tokio::select! {
        result = child.wait() => result,
        _ = session.kill_notify.notified() => {
            let _ = child.kill().await;
            child.wait().await
        }
    };
    session.exited.store(true, Ordering::Release);
    session.alive.store(false, Ordering::Release);
    let message = match result {
        Ok(status) if status.success() => "Alloy agent exited.".to_string(),
        Ok(status) => format!("Alloy agent exited with {status}."),
        Err(error) => format!("Alloy agent process wait failed: {error}"),
    };
    session.fail_pending(&message).await;
    if let Some(inner) = inner.upgrade() {
        process_exited(&inner, session.id, message).await;
    }
}

async fn read_stdout<R>(stdout: R, session: Arc<Session>, inner: Weak<Inner>, max_line_bytes: usize)
where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stdout);
    loop {
        let mut line = String::new();
        let count = match reader.read_line(&mut line).await {
            Ok(count) => count,
            Err(error) => {
                session
                    .fail_pending(&format!("Alloy agent stdout failed: {error}"))
                    .await;
                break;
            }
        };
        if count == 0 {
            break;
        }
        if count > max_line_bytes {
            session
                .fail_pending("Alloy agent sent an oversized protocol line.")
                .await;
            if let Some(inner) = inner.upgrade() {
                let _ = session.stop(&inner.options).await;
            }
            break;
        }
        let Some(inner) = inner.upgrade() else {
            break;
        };
        handle_line(&inner, &session, line.trim_end_matches(['\r', '\n'])).await;
    }
}

async fn read_stderr<R>(stderr: R, _inner: Weak<Inner>, max_line_bytes: usize)
where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stderr);
    loop {
        let mut line = String::new();
        let count = match reader.read_line(&mut line).await {
            Ok(count) => count,
            Err(error) => {
                eprintln!("[alloy-agent] stderr read failed: {error}");
                break;
            }
        };
        if count == 0 {
            break;
        }
        if count > max_line_bytes {
            eprintln!("[alloy-agent] discarded oversized stderr line");
            continue;
        }
        let message = line.trim();
        if !message.is_empty() {
            eprintln!("[alloy-agent] {message}");
        }
    }
}

async fn handle_line(inner: &Arc<Inner>, session: &Arc<Session>, line: &str) {
    if line.trim().is_empty() {
        return;
    }
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[alloy-agent] invalid protocol JSON: {error}");
            return;
        }
    };

    if value.get("event").is_some() {
        match serde_json::from_value::<EventEnvelope>(value) {
            Ok(envelope) => handle_event(inner, envelope.event).await,
            Err(error) => eprintln!("[alloy-agent] invalid event: {error}"),
        }
        return;
    }

    if value.get("id").is_some() {
        let response = match serde_json::from_value::<WireResponse>(value) {
            Ok(response) => response,
            Err(error) => {
                eprintln!("[alloy-agent] invalid response: {error}");
                return;
            }
        };
        if response.id == 0 {
            eprintln!("[alloy-agent] ignored response with id 0");
            return;
        }
        let pending = session.pending.lock().await.remove(&response.id);
        if let Some(pending) = pending {
            let _ = pending.sender.send(Ok(response));
        }
        return;
    }

    eprintln!("[alloy-agent] ignored unknown protocol message");
}

async fn handle_event(inner: &Arc<Inner>, event: RecordingEvent) {
    if let Some(capture) = event_capture(&event) {
        if !begin_capture_event(inner, capture).await {
            return;
        }
        if let Err(error) = remember_capture_inner(inner, capture.clone()).await {
            eprintln!("[alloy-recording-host] failed to persist capture: {error}");
            forget_capture_event(inner, capture).await;
            return;
        }
    }
    if let Some(status) = event_status(&event) {
        apply_status_inner(inner, status.clone()).await;
    }
    let _ = inner.events.send(event);
}

async fn begin_capture_event(inner: &Arc<Inner>, capture: &RecordingCapture) -> bool {
    let keys = capture_identity_keys(capture);
    let completed = inner.completed_captures.lock().await;
    if keys.iter().any(|key| completed.contains_key(key)) {
        return false;
    }
    drop(completed);

    let mut emitted = inner.emitted_captures.lock().await;
    if keys.iter().any(|key| emitted.contains(key)) {
        return false;
    }
    emitted.extend(keys);
    true
}

async fn forget_capture_event(inner: &Arc<Inner>, capture: &RecordingCapture) {
    let mut emitted = inner.emitted_captures.lock().await;
    for key in capture_identity_keys(capture) {
        emitted.remove(&key);
    }
}

fn capture_identity_keys(capture: &RecordingCapture) -> Vec<String> {
    let mut keys = Vec::with_capacity(2);
    if !capture.id.is_empty() {
        keys.push(format!("id:{}", capture.id));
    }
    if !capture.filename.is_empty() {
        keys.push(format!("filename:{}", capture.filename));
    }
    keys
}

fn captures_match(left: &RecordingCapture, right: &RecordingCapture) -> bool {
    (!left.id.is_empty() && left.id == right.id)
        || (!left.filename.is_empty() && left.filename == right.filename)
}

async fn apply_status_inner(inner: &Arc<Inner>, mut status: RecordingStatus) {
    if let Some(capture) = status.current_capture.as_ref() {
        let completed = inner.completed_captures.lock().await;
        if let Some(finalized) = capture_identity_keys(capture)
            .iter()
            .find_map(|key| completed.get(key))
        {
            status.current_capture = Some(finalized.clone());
        }
    }
    *inner.status.write().await = status;
}

async fn heartbeat(
    session: Arc<Session>,
    inner: Weak<Inner>,
    interval: Duration,
    request_timeout: Duration,
) {
    loop {
        sleep(interval).await;
        if !session.is_alive() {
            return;
        }
        let result = session
            .request("status", Value::Null, request_timeout)
            .await;
        let Ok(response) = result else {
            if let Some(inner) = inner.upgrade() {
                let _ = session.stop(&inner.options).await;
            }
            return;
        };
        if !response.ok {
            if let Some(inner) = inner.upgrade() {
                let _ = session.stop(&inner.options).await;
            }
            return;
        }
        if response.result.is_none() && response.status.is_none() {
            if let Some(inner) = inner.upgrade() {
                let _ = session.stop(&inner.options).await;
            }
            return;
        }
        if let Some(inner) = inner.upgrade() {
            if let Some(status) = response.status {
                apply_status_inner(&inner, status).await;
            } else if let Some(result) = response.result
                && let Ok(status) = serde_json::from_value::<RecordingStatus>(result)
            {
                apply_status_inner(&inner, status).await;
            }
        }
    }
}

async fn process_exited(inner: &Arc<Inner>, session_id: u64, message: String) {
    let removed = {
        let mut current = inner.session.lock().await;
        if current
            .as_ref()
            .is_some_and(|session| session.id == session_id)
        {
            current.take();
            true
        } else {
            false
        }
    };
    if !removed {
        return;
    }
    *inner.applied_settings.lock().await = None;
    inner.capabilities.write().await.clear();
    set_error_status(inner, message.clone()).await;
    let status = inner.status.read().await.clone();
    let _ = inner.events.send(RecordingEvent::Error {
        error: message,
        status,
    });
    schedule_respawn(inner);
}

fn schedule_respawn(inner: &Arc<Inner>) {
    let weak = Arc::downgrade(inner);
    let delay = inner.options.respawn_delay;
    tokio::spawn(async move {
        let Some(inner) = weak.upgrade() else {
            return;
        };
        if inner.shutdown.load(Ordering::Acquire) || !inner.options.executable.is_file() {
            return;
        }
        let should_spawn = {
            let mut state = inner.respawn.lock().await;
            if state
                .last_started
                .is_some_and(|started| started.elapsed() >= inner.options.respawn_streak_reset)
            {
                state.consecutive = 0;
            }
            if state.consecutive >= inner.options.max_consecutive_respawns || state.scheduled {
                false
            } else {
                state.consecutive += 1;
                state.scheduled = true;
                true
            }
        };
        if !should_spawn {
            return;
        }
        sleep(delay).await;
        inner.respawn.lock().await.scheduled = false;
        if inner.shutdown.load(Ordering::Acquire) {
            return;
        }
        if let Err(error) = ensure_session(&inner).await {
            eprintln!("[alloy-recording-host] recorder respawn failed: {error}");
        }
    });
}

async fn set_error_status(inner: &Arc<Inner>, message: String) {
    let mut status = inner.status.read().await.clone();
    status.backend = RecordingBackendState::Error;
    status.mode = RecordingMode::Idle;
    status.run_state = RecordingRunState::Error;
    status.replay_active = false;
    status.active_game = None;
    status.active_game_detail = None;
    status.active_display = None;
    status.focused = false;
    status.current_source = None;
    status.current_capture = None;
    status.telemetry = None;
    status.message = Some(message);
    *inner.status.write().await = status;
}

async fn remember_capture_inner(
    inner: &Arc<Inner>,
    capture: RecordingCapture,
) -> Result<(), RecorderHostError> {
    let mut manifest = inner.captures.lock().await;
    let original = manifest.clone();
    if let Some(existing) = manifest
        .captures
        .iter_mut()
        .find(|entry| entry.id == capture.id || entry.filename == capture.filename)
    {
        *existing = capture;
    } else {
        manifest.captures.push(capture);
    }
    if let Err(error) = write_json_atomic(&inner.options.state_dir.join(CAPTURES_FILE), &*manifest)
    {
        *manifest = original;
        return Err(error);
    }
    Ok(())
}

fn decode_response<T: DeserializeOwned>(
    response: WireResponse,
    method: &str,
) -> Result<T, RecorderHostError> {
    if !response.ok {
        return Err(RecorderHostError::Process(
            response
                .error
                .unwrap_or_else(|| format!("Alloy agent {method} failed.")),
        ));
    }
    let value = response.result.ok_or_else(|| {
        RecorderHostError::Protocol(format!("Alloy agent {method} response omitted result."))
    })?;
    serde_json::from_value(value)
        .map_err(|source| json_error(format!("Invalid {method} response"), source))
}

fn decode_value<T: DeserializeOwned>(value: Value, method: &str) -> Result<T, RecorderHostError> {
    serde_json::from_value(value)
        .map_err(|source| json_error(format!("Invalid {method} response"), source))
}

fn ensure_null_result(value: Value, method: &str) -> Result<(), RecorderHostError> {
    if value.is_null() {
        Ok(())
    } else {
        Err(RecorderHostError::Protocol(format!(
            "Alloy agent {method} response was not null."
        )))
    }
}

fn validate_settings(settings: &RecordingSettings) -> Result<(), RecorderHostError> {
    if !(15..=600).contains(&settings.replay_buffer_seconds)
        || !settings.replay_buffer_seconds.is_multiple_of(15)
    {
        return Err(RecorderHostError::InvalidSettings(
            "replayBufferSeconds must be 15..600 in 15 second steps.".into(),
        ));
    }
    for (name, fps) in [
        ("fps", settings.fps),
        ("customQuality.fps", settings.custom_quality.fps),
    ] {
        if !matches!(fps, 30 | 60 | 120) {
            return Err(RecorderHostError::InvalidSettings(format!(
                "{name} must be 30, 60, or 120."
            )));
        }
    }
    for (name, bitrate) in [
        ("bitrate", settings.bitrate.0.as_str()),
        (
            "customQuality.bitrate",
            settings.custom_quality.bitrate.0.as_str(),
        ),
    ] {
        if bitrate != "auto"
            && (bitrate.parse::<u32>().is_err()
                || !matches!(bitrate.parse::<u32>(), Ok(value) if (5..=50).contains(&value) && value % 5 == 0))
        {
            return Err(RecorderHostError::InvalidSettings(format!(
                "{name} must be auto or a 5..50 Mbps step."
            )));
        }
    }
    if settings.gpu.trim().is_empty() || settings.gpu.contains('\0') {
        return Err(RecorderHostError::InvalidSettings(
            "gpu must be a non-empty identifier.".into(),
        ));
    }
    for device in &settings.audio_devices {
        validate_audio_volume(device.volume, "audioDevices")?;
        validate_non_empty(&device.id, "audioDevices.id")?;
        validate_non_empty(&device.label, "audioDevices.label")?;
    }
    for application in &settings.audio_applications {
        validate_audio_volume(application.volume, "audioApplications")?;
        validate_non_empty(&application.id, "audioApplications.id")?;
        validate_non_empty(&application.name, "audioApplications.name")?;
    }
    for game in settings.allowed_games.iter().chain(&settings.denied_games) {
        validate_non_empty(&game.id, "allowedGames.id")?;
        validate_non_empty(&game.name, "allowedGames.name")?;
        if game.executable.is_none() && game.path.is_none() && game.window_class.is_none() {
            return Err(RecorderHostError::InvalidSettings(
                "Each allowed game needs executable, path, or windowClass.".into(),
            ));
        }
    }
    validate_sound(&settings.notification_sounds.replay_buffer_started)?;
    validate_sound(&settings.notification_sounds.clip_saved)?;
    if !settings.output_folder.is_empty() && !settings.output_folder.contains('\0') {
        let path = Path::new(&settings.output_folder);
        if !path.is_absolute() {
            return Err(RecorderHostError::InvalidSettings(
                "outputFolder must be an absolute path.".into(),
            ));
        }
    } else if settings.output_folder.contains('\0') {
        return Err(RecorderHostError::InvalidSettings(
            "outputFolder contains a NUL byte.".into(),
        ));
    }
    Ok(())
}

fn validate_audio_volume(volume: u32, field: &str) -> Result<(), RecorderHostError> {
    if volume > 100 {
        Err(RecorderHostError::InvalidSettings(format!(
            "{field}.volume must be between 0 and 100."
        )))
    } else {
        Ok(())
    }
}

fn validate_sound(sound: &RecordingNotificationSoundSettings) -> Result<(), RecorderHostError> {
    validate_audio_volume(sound.volume, "notificationSounds")?;
    if sound.path.contains('\0') {
        return Err(RecorderHostError::InvalidSettings(
            "notification sound path contains a NUL byte.".into(),
        ));
    }
    Ok(())
}

fn validate_non_empty(value: &str, field: &str) -> Result<(), RecorderHostError> {
    if value.trim().is_empty() || value.contains('\0') {
        Err(RecorderHostError::InvalidSettings(format!(
            "{field} must be non-empty."
        )))
    } else {
        Ok(())
    }
}

fn effective_output_folder(options: &RecorderHostOptions, settings: &RecordingSettings) -> PathBuf {
    if settings.output_folder.trim().is_empty() {
        options.output_folder.clone()
    } else {
        PathBuf::from(&settings.output_folder)
    }
}

fn load_json_or_default<T>(path: &Path) -> Result<T, RecorderHostError>
where
    T: DeserializeOwned + Default,
{
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|source| json_error(format!("Failed to read {}", path.display()), source)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(source) => Err(io_error(
            format!("Failed to read {}", path.display()),
            source,
        )),
    }
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), RecorderHostError> {
    let parent = path.parent().ok_or_else(|| {
        RecorderHostError::Process(format!("No parent folder for {}", path.display()))
    })?;
    fs::create_dir_all(parent)
        .map_err(|source| io_error(format!("Failed to create {}", parent.display()), source))?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|source| json_error(format!("Failed to encode {}", path.display()), source))?;
    {
        let mut file = File::create(&temp)
            .map_err(|source| io_error(format!("Failed to create {}", temp.display()), source))?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|source| io_error(format!("Failed to write {}", temp.display()), source))?;
    }
    if let Err(source) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(io_error(
            format!("Failed to replace {}", path.display()),
            source,
        ));
    }
    Ok(())
}

fn sum_capture_bytes(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                return 0;
            };
            if metadata.is_dir() {
                return sum_capture_bytes(&path);
            }
            if !metadata.is_file() {
                return 0;
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if CAPTURE_EXTENSIONS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(extension))
            {
                metadata.len()
            } else {
                0
            }
        })
        .sum()
}

fn prepare_discord_detection_cache(path: &Path) -> Result<(), RecorderHostError> {
    let parent = path.parent().ok_or_else(|| {
        RecorderHostError::Process(format!(
            "No parent folder for Discord detection cache {}",
            path.display()
        ))
    })?;
    fs::create_dir_all(parent)
        .map_err(|source| io_error(format!("Failed to create {}", parent.display()), source))?;
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(RecorderHostError::Process(format!(
            "Discord detection cache path is not a file: {}",
            path.display()
        ))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            write_json_atomic(path, &empty_discord_detection_cache())
        }
        Err(source) => Err(io_error(
            format!("Failed to inspect {}", path.display()),
            source,
        )),
    }
}

fn start_discord_detection_refresh(inner: &Arc<Inner>) {
    if !cfg!(windows)
        || inner.options.discord_detection_cache_path.is_some()
        || inner.discord_cache_path.is_none()
        || inner.discord_refresh_started.swap(true, Ordering::AcqRel)
    {
        return;
    }

    let weak = Arc::downgrade(inner);
    let path = inner.discord_cache_path.clone().expect("checked above");
    tokio::spawn(async move {
        loop {
            let Some(inner) = weak.upgrade() else {
                return;
            };
            if !inner.shutdown.load(Ordering::Acquire)
                && let Err(error) = refresh_discord_detection_cache(&path).await
            {
                eprintln!("[alloy-recording-host] failed to refresh Discord detections: {error}");
            }
            sleep(DISCORD_REFRESH_INTERVAL).await;
        }
    });
}

async fn refresh_discord_detection_cache(path: &Path) -> Result<(), String> {
    if discord_cache_is_fresh(path) {
        return Ok(());
    }

    // reqwest 0.13 builds rustls without a crypto provider; select ring once
    // per process. A second install returns an error, which is fine to ignore.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(DISCORD_FETCH_TIMEOUT)
        .connect_timeout(DISCORD_CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("failed to create Discord HTTP client: {error}"))?;
    let response = client
        .get(DISCORD_DETECTABLE_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Discord detectable games request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Discord detectable games request failed with HTTP {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > DISCORD_MAX_BODY_BYTES as u64)
    {
        return Err("Discord detectable games response was too large.".into());
    }

    let mut body = Vec::new();
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("failed to read Discord detectable games response: {error}"))?
    {
        if body.len().saturating_add(chunk.len()) > DISCORD_MAX_BODY_BYTES {
            return Err("Discord detectable games response was too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("invalid Discord detectable games JSON: {error}"))?;
    let cache = trim_discord_detections(payload)?;
    write_json_atomic(path, &cache).map_err(|error| error.to_string())
}

fn trim_discord_detections(payload: Value) -> Result<DiscordDetectionCache, String> {
    let rows = payload
        .as_array()
        .ok_or_else(|| "Discord detectable games response was not an array.".to_string())?;
    let mut games = Vec::new();
    let mut executables: BTreeMap<String, Vec<DiscordExecutableRule>> = BTreeMap::new();

    for row in rows.iter().take(DISCORD_MAX_ROWS) {
        let Some(row) = row.as_object() else {
            continue;
        };
        let id = discord_string(row.get("id"));
        let name = discord_string(row.get("name"));
        if id.is_empty() || name.is_empty() {
            continue;
        }

        let mut matched_executable = false;
        if let Some(raw_executables) = row.get("executables").and_then(Value::as_array) {
            for raw_executable in raw_executables {
                let Some(executable) = raw_executable.as_object() else {
                    continue;
                };
                if discord_string(executable.get("os")) != "win32" {
                    continue;
                }
                let key = discord_executable_key(&discord_string(executable.get("name")));
                if key.is_empty() {
                    continue;
                }
                matched_executable = true;
                let is_launcher = executable
                    .get("is_launcher")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                executables
                    .entry(key)
                    .or_default()
                    .push(DiscordExecutableRule {
                        game_id: id.clone(),
                        is_launcher,
                        score: if is_launcher { 82 } else { 112 },
                    });
            }
        }
        if !matched_executable {
            continue;
        }

        let mut aliases = row
            .get("aliases")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .map(|value| discord_string(Some(value)))
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        aliases.sort();
        aliases.dedup();
        let icon_hash = discord_string(row.get("icon_hash"));
        games.push(DiscordDetectionGame {
            id,
            name,
            aliases,
            icon_hash: (!icon_hash.is_empty()).then_some(icon_hash),
        });
    }

    games.sort_by(|left, right| left.name.cmp(&right.name));
    for rules in executables.values_mut() {
        rules.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.game_id.cmp(&right.game_id))
        });
        let mut seen = HashSet::new();
        rules.retain(|rule| seen.insert(rule.game_id.clone()));
    }

    Ok(DiscordDetectionCache {
        schema_version: DISCORD_CACHE_SCHEMA_VERSION,
        source: "discord-detectable".into(),
        source_url: DISCORD_DETECTABLE_URL.into(),
        fetched_at: Some(
            OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .map_err(|error| format!("failed to format cache timestamp: {error}"))?,
        ),
        games,
        executables: executables.into_iter().collect(),
    })
}

fn empty_discord_detection_cache() -> DiscordDetectionCache {
    DiscordDetectionCache {
        schema_version: DISCORD_CACHE_SCHEMA_VERSION,
        source: "discord-detectable".into(),
        source_url: DISCORD_DETECTABLE_URL.into(),
        fetched_at: None,
        games: Vec::new(),
        executables: BTreeMap::new(),
    }
}

fn discord_cache_is_fresh(path: &Path) -> bool {
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(cache) = serde_json::from_str::<DiscordDetectionCache>(&contents) else {
        return false;
    };
    let Some(fetched_at) = cache.fetched_at else {
        return false;
    };
    let Ok(fetched_at) = OffsetDateTime::parse(&fetched_at, &Rfc3339) else {
        return false;
    };
    OffsetDateTime::now_utc()
        .unix_timestamp()
        .saturating_sub(fetched_at.unix_timestamp())
        < DISCORD_CACHE_TTL_SECONDS
}

fn discord_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn discord_executable_key(value: &str) -> String {
    value
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn configure_runtime_environment(
    command: &mut Command,
    options: &RecorderHostOptions,
    discord_cache_path: Option<&Path>,
) {
    if let Some(path) = discord_cache_path {
        command.env("ALLOY_DISCORD_DETECTIONS_PATH", path);
    }
    let Some(runtime) = options.obs_runtime_dir.as_ref() else {
        return;
    };
    command.env("ALLOY_OBS_RUNTIME_DIR", runtime);
    let candidates = [
        runtime.clone(),
        runtime.join("bin"),
        runtime.join("bin").join("64bit"),
    ];
    prepend_command_path(command, "PATH", &candidates);
    let library_candidates = [
        runtime.join("lib"),
        runtime.join("lib64"),
        runtime.join("bin"),
        runtime.join("bin").join("64bit"),
    ];
    prepend_command_path(command, "LD_LIBRARY_PATH", &library_candidates);
    prepend_command_path(command, "DYLD_LIBRARY_PATH", &library_candidates);
    for candidate in [
        runtime.join("bin").join("64bit"),
        runtime.join("bin"),
        runtime.clone(),
    ] {
        if candidate.is_dir() {
            command.current_dir(candidate);
            break;
        }
    }
}

fn prepend_command_path(command: &mut Command, key: &str, paths: &[PathBuf]) {
    let present: Vec<PathBuf> = paths.iter().filter(|path| path.is_dir()).cloned().collect();
    if present.is_empty() {
        return;
    }
    let existing = env::var_os(key);
    let mut values = present;
    if let Some(existing) = existing {
        values.extend(env::split_paths(&existing));
    }
    if let Ok(joined) = env::join_paths(values) {
        command.env(key, joined);
    }
}

fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use alloy_recorder::protocol::CONTENT_TYPE_MP4;
    use std::{fs, os::unix::fs::PermissionsExt};

    fn temporary_folder(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let folder = env::temp_dir().join(format!("alloy-recording-host-{name}-{suffix}"));
        fs::create_dir_all(&folder).expect("temporary folder");
        folder
    }

    fn fake_agent(path: &Path, status: &RecordingStatus) {
        let status = serde_json::to_string(status).expect("status JSON");
        let script = format!(
            "#!/bin/sh\nwhile IFS= read -r line; do\n  id=$(printf '%s' \"$line\" | sed -En 's/.*\"id\":([0-9]+).*/\\1/p')\n  method=$(printf '%s' \"$line\" | sed -En 's/.*\"method\":\"([^\"]*)\".*/\\1/p')\n  case \"$method\" in\n    version) printf '{{\"id\":%s,\"ok\":true,\"result\":{{\"name\":\"alloy-agent\",\"version\":\"test\",\"protocolVersion\":1,\"capabilities\":[]}}}}\\n' \"$id\" ;;\n    configure) printf '{{\"event\":{{\"type\":\"status\",\"status\":{status}}}}}\\n'; printf '{{\"id\":%s,\"ok\":true,\"result\":{status}}}\\n' \"$id\" ;;\n    status) printf '{{\"id\":%s,\"ok\":true,\"result\":{status}}}\\n' \"$id\" ;;\n    listGameProcesses|listDisplays) printf '{{\"id\":%s,\"ok\":true,\"result\":[]}}\\n' \"$id\" ;;\n    subscribeAudioLevels|stopAudioLevels|playNotificationSound) printf '{{\"id\":%s,\"ok\":true,\"result\":null}}\\n' \"$id\" ;;\n    shutdown) printf '{{\"id\":%s,\"ok\":true,\"result\":{status}}}\\n' \"$id\"; exit 0 ;;\n  esac\ndone\n"
        );
        fs::write(path, script).expect("fake agent");
        let mut permissions = fs::metadata(path)
            .expect("fake agent metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("fake agent permissions");
    }

    fn fake_hanging_agent(path: &Path, status: &RecordingStatus) {
        let status = serde_json::to_string(status).expect("status JSON");
        let script = format!(
            "#!/bin/sh\nstatus_count=0\nwhile IFS= read -r line; do\n  id=$(printf '%s' \"$line\" | sed -En 's/.*\"id\":([0-9]+).*/\\1/p')\n  method=$(printf '%s' \"$line\" | sed -En 's/.*\"method\":\"([^\"]*)\".*/\\1/p')\n  case \"$method\" in\n    version) printf '{{\"id\":%s,\"ok\":true,\"result\":{{\"name\":\"alloy-agent\",\"version\":\"test\",\"protocolVersion\":1,\"capabilities\":[]}}}}\\n' \"$id\" ;;\n    configure) printf '{{\"id\":%s,\"ok\":true,\"result\":{status}}}\\n' \"$id\" ;;\n    status) if [ \"$status_count\" -eq 0 ]; then printf '{{\"id\":%s,\"ok\":true,\"result\":{status}}}\\n' \"$id\"; status_count=1; fi ;;\n    shutdown) printf '{{\"id\":%s,\"ok\":true,\"result\":null}}\\n' \"$id\"; exit 0 ;;\n  esac\ndone\n"
        );
        fs::write(path, script).expect("fake hanging agent");
        let mut permissions = fs::metadata(path)
            .expect("fake hanging agent metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("fake hanging agent permissions");
    }

    fn test_capture(id: &str, filename: &str) -> RecordingCapture {
        RecordingCapture {
            id: id.into(),
            filename: filename.into(),
            content_type: CONTENT_TYPE_MP4.into(),
            size_bytes: Some(100),
            duration_ms: Some(2_000),
            width: Some(1920),
            height: Some(1080),
            game: None,
            source: RecordingCaptureSource::Game,
            kind: RecordingCaptureKind::Replay,
            post_process: Some(RecordingCapturePostProcess::TrimTail { keep_ms: 1_000 }),
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[tokio::test]
    async fn handshake_settings_events_restart_and_shutdown_work() {
        let folder = temporary_folder("lifecycle");
        let state_dir = folder.join("state");
        let output_dir = folder.join("captures");
        let agent = folder.join("fake-agent.sh");
        let mut status = unavailable_status(&RecordingSettings::default(), None);
        status.backend = RecordingBackendState::Ready;
        status.message = None;
        fake_agent(&agent, &status);

        let host = RecorderHost::new(
            RecorderHostOptions::new(&agent, &state_dir)
                .output_folder(&output_dir)
                .heartbeat_interval(Duration::ZERO),
        )
        .expect("host");
        let mut events = host.subscribe_events();

        let configured = host.configure().await.expect("configure");
        assert_eq!(configured.backend, RecordingBackendState::Ready);
        let event = timeout(Duration::from_secs(1), events.recv())
            .await
            .expect("event timeout")
            .expect("event");
        assert!(matches!(event, RecordingEvent::Status { .. }));
        assert!(host.list_displays().await.expect("displays").is_empty());

        let mut settings = host.get_settings().await;
        settings.enabled = true;
        host.set_settings(settings.clone())
            .await
            .expect("set settings");
        assert_eq!(host.get_settings().await, settings);
        let restarted = host.restart().await.expect("restart");
        assert_eq!(restarted.backend, RecordingBackendState::Ready);
        assert!(host.shutdown().await);

        let persisted = RecorderHost::new(
            RecorderHostOptions::new(&agent, &state_dir)
                .output_folder(&output_dir)
                .heartbeat_interval(Duration::ZERO),
        )
        .expect("reopen host");
        assert!(persisted.get_settings().await.enabled);
        persisted.shutdown().await;
        fs::remove_dir_all(folder).expect("cleanup");
    }

    #[tokio::test]
    async fn hanging_fake_agent_request_times_out_and_can_shutdown() {
        let folder = temporary_folder("timeout");
        let state_dir = folder.join("state");
        let agent = folder.join("fake-hanging-agent.sh");
        let mut status = unavailable_status(&RecordingSettings::default(), None);
        status.backend = RecordingBackendState::Ready;
        status.message = None;
        fake_hanging_agent(&agent, &status);

        let mut options =
            RecorderHostOptions::new(&agent, &state_dir).heartbeat_interval(Duration::ZERO);
        options.request_timeout = Duration::from_millis(500);
        options.configure_timeout = Duration::from_secs(1);
        options.shutdown_request_timeout = Duration::from_millis(100);
        options.graceful_exit_timeout = Duration::from_millis(100);
        options.forced_exit_timeout = Duration::from_millis(100);
        let host = RecorderHost::new(options).expect("host");
        host.configure().await.expect("configure");

        let result = host.list_displays().await;
        assert!(
            matches!(result, Err(RecorderHostError::Timeout { method }) if method == "listDisplays")
        );
        assert!(host.shutdown().await);
        fs::remove_dir_all(folder).expect("cleanup");
    }

    #[tokio::test]
    async fn duplicate_capture_events_are_emitted_once_and_completion_clears_pending() {
        let folder = temporary_folder("capture-completion");
        let state_dir = folder.join("state");
        let host = RecorderHost::new(RecorderHostOptions::new(
            folder.join("missing-agent"),
            &state_dir,
        ))
        .expect("host");
        let raw = test_capture("capture-1", "/captures/raw.mp4");
        let mut status = host.get_status().await;
        status.current_capture = Some(raw.clone());
        host.apply_status(status.clone()).await;
        let event = RecordingEvent::CaptureReady {
            capture: raw.clone(),
            status,
        };
        let mut events = host.subscribe_events();
        handle_event(&host.inner, event.clone()).await;
        handle_event(&host.inner, event).await;
        assert!(events.try_recv().is_ok());
        assert!(events.try_recv().is_err());
        assert_eq!(host.captures().await, vec![raw.clone()]);

        let finalized = RecordingCapture {
            post_process: None,
            duration_ms: Some(1_000),
            size_bytes: Some(80),
            ..raw.clone()
        };
        let manifest_path = state_dir.join(CAPTURES_FILE);
        fs::remove_file(&manifest_path).expect("capture manifest");
        fs::create_dir(&manifest_path).expect("manifest failure marker");
        assert!(host.complete_capture(finalized.clone()).await.is_err());
        assert_eq!(host.captures().await, vec![raw.clone()]);
        fs::remove_dir(&manifest_path).expect("manifest failure marker cleanup");
        host.complete_capture(finalized.clone())
            .await
            .expect("complete capture");
        assert!(host.captures().await.is_empty());
        assert_eq!(
            host.get_status().await.current_capture,
            Some(finalized.clone())
        );

        let stale = RecordingStatus {
            current_capture: Some(raw),
            ..host.get_status().await
        };
        host.apply_status(stale).await;
        assert_eq!(host.get_status().await.current_capture, Some(finalized));
        fs::remove_dir_all(folder).expect("cleanup");
    }

    #[test]
    fn discord_detection_payload_is_trimmed_for_windows() {
        let payload = json!([
            {
                "id": "game-2",
                "name": "Zulu",
                "aliases": [" zulu ", "Zulu", 4],
                "icon_hash": "hash-2",
                "executables": [
                    { "os": "win32", "name": "C:\\\\Games\\\\zulu.exe", "is_launcher": true },
                    { "os": "linux", "name": "zulu" }
                ]
            },
            {
                "id": "game-1",
                "name": "Alpha",
                "aliases": ["alpha"],
                "executables": [
                    { "os": "win32", "name": "alpha.exe", "is_launcher": false }
                ]
            },
            {
                "id": "ignored",
                "name": "No Windows executable",
                "executables": [{ "os": "linux", "name": "ignored" }]
            }
        ]);
        let cache = trim_discord_detections(payload).expect("trim cache");
        assert_eq!(
            cache
                .games
                .iter()
                .map(|game| game.name.as_str())
                .collect::<Vec<_>>(),
            ["Alpha", "Zulu"]
        );
        assert_eq!(cache.games[1].aliases, ["Zulu", "zulu"]);
        assert_eq!(cache.executables["zulu.exe"][0].score, 82);
        assert_eq!(cache.executables["alpha.exe"][0].game_id, "game-1");
        assert!(!cache.executables.contains_key("ignored"));
    }

    #[test]
    fn invalid_settings_are_rejected_before_persistence() {
        let folder = temporary_folder("validation");
        let host = RecorderHost::new(RecorderHostOptions::new(
            folder.join("missing-agent"),
            &folder,
        ))
        .expect("host");
        let settings = RecordingSettings {
            recorder: RecorderSettings {
                replay_buffer_seconds: 14,
                ..RecorderSettings::default()
            },
            ..RecordingSettings::default()
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let result = runtime.block_on(host.set_settings(settings));
        assert!(matches!(result, Err(RecorderHostError::InvalidSettings(_))));
        assert!(!folder.join(SETTINGS_FILE).exists());
        fs::remove_dir_all(folder).expect("cleanup");
    }
}
