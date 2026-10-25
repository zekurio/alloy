//! Capture state and lifecycle on Linux.
//!
//! One gpu-screen-recorder process keeps the replay buffer of the selected
//! monitor. Display mode keeps it running. Game mode runs it while an allowed
//! game is detected and for one buffer length after the game closes, so the
//! game's last moments can still be saved. A saved replay is moved from the
//! session's scratch folder into the capture folder.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use super::{
    games::{self, DetectedGame},
    gsr::{self, GsrInfo, Monitor, ReplayConfig, ReplayProcess},
};
use crate::agent::{
    events::emit_event,
    quality::{effective_quality_for_base, target_bitrate_kbps},
    time::{
        now_iso, system_time_iso, timestamp_file_slug, timestamp_millis, unix_millis_to_system_time,
    },
};
use crate::names::file_component;
use crate::protocol::{CONTENT_TYPE_MP4, SIDE_CAR_NAME};
use crate::settings::{default_audio_device_selections, resolve_audio_device_selection};
use crate::types::{
    ConfigureParams, RecordingActionResult, RecordingAudioApplicationSelection,
    RecordingAudioDevice, RecordingAudioDeviceKind, RecordingAudioDeviceSelection,
    RecordingAudioMode, RecordingBackendState, RecordingCapture, RecordingCaptureKind,
    RecordingCaptureMode, RecordingCaptureSource, RecordingCodec, RecordingEncoder, RecordingEvent,
    RecordingGame, RecordingMode, RecordingRunState, RecordingSettings, RecordingStatus,
    SaveReplayClipParams, VideoDimensions,
};

const HARDWARE_DISCOVERY_TTL: Duration = Duration::from_secs(60);
const MONITOR_DISCOVERY_TTL: Duration = Duration::from_secs(10);
const AUDIO_APPLICATION_DISCOVERY_TTL: Duration = Duration::from_secs(10);
/// Each scan reads every process's command line.
const GAME_DETECTION_INTERVAL: Duration = Duration::from_secs(2);
/// Retry window for a replay start that failed for the same target, doubling
/// up to the cap.
const REPLAY_START_RETRY_MIN: Duration = Duration::from_secs(2);
const REPLAY_START_RETRY_MAX: Duration = Duration::from_secs(60);
/// Names a session's folder under the replay scratch root.
const SESSION_FOLDER_PREFIX: &str = "session-";

struct Discovered<T> {
    value: T,
    at: Instant,
}

impl<T> Discovered<T> {
    fn stale(cached: &Option<Self>, ttl: Duration) -> bool {
        cached
            .as_ref()
            .is_none_or(|cached| cached.at.elapsed() >= ttl)
    }
}

#[derive(Default)]
pub(in crate::agent) struct Recorder {
    settings: Option<RecordingSettings>,
    output_folder: Option<PathBuf>,
    replay_scratch_folder: Option<PathBuf>,
    info: Option<Discovered<Result<GsrInfo, String>>>,
    monitors: Option<Discovered<Vec<Monitor>>>,
    audio_devices: Option<Discovered<Vec<RecordingAudioDevice>>>,
    audio_applications: Option<Discovered<Vec<RecordingAudioApplicationSelection>>>,
    session: Option<Session>,
    active_game: Option<DetectedGame>,
    game_detected_at: Option<Instant>,
    last_capture: Option<RecordingCapture>,
    last_error: Option<String>,
    replay_start_failure: Option<ReplayStartFailure>,
}

struct Session {
    process: ReplayProcess,
    config: ReplayConfig,
    scratch: PathBuf,
    monitor: Monitor,
    capture: RecordingCapture,
    /// The game a game-mode buffer records.
    game_key: Option<String>,
    /// Set once the recorded game closed: the buffer holds it until then.
    game_content_expires_at: Option<Instant>,
}

struct ReplayStartFailure {
    target: Option<String>,
    error: String,
    attempts: u32,
    retry_at: Instant,
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl Recorder {
    pub(in crate::agent) fn configure(
        &mut self,
        params: ConfigureParams,
    ) -> Result<RecordingStatus, String> {
        let output_folder = if params.output_folder.is_empty() {
            env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        } else {
            PathBuf::from(params.output_folder)
        };
        let replay_scratch_folder = if params.replay_scratch_folder.is_empty() {
            output_folder.join(".alloy-replay-buffer")
        } else {
            PathBuf::from(params.replay_scratch_folder)
        };
        let paths_changed = self.output_folder.as_ref() != Some(&output_folder)
            || self.replay_scratch_folder.as_ref() != Some(&replay_scratch_folder);
        self.settings = Some(params.settings.clone());
        self.output_folder = Some(output_folder);
        self.replay_scratch_folder = Some(replay_scratch_folder);
        self.last_error = None;
        self.replay_start_failure = None;
        // A failed probe (gpu-screen-recorder missing) is retried right away.
        if self.info.as_ref().is_some_and(|info| info.value.is_err()) {
            self.info = None;
        }
        self.refresh_discovery();

        let settings = params.settings;
        let restart = paths_changed
            || self.session.as_ref().is_some_and(|session| {
                session.capture.source != capture_source(&settings)
                    || self.selected_monitor(&settings).is_none_or(|monitor| {
                        self.replay_config(&settings, &monitor) != session.config
                    })
            });
        if restart || !settings.enabled {
            // The tick starts the next buffer.
            self.stop_session();
        }
        if !settings.enabled {
            self.clear_active_game("detection stopped");
        }
        if let Some(root) = self.replay_scratch_folder.as_deref() {
            remove_stale_scratch_folders(
                root,
                self.session
                    .as_ref()
                    .map(|session| session.scratch.as_path()),
            );
        }

        if let Some(Err(error)) = self.info.as_ref().map(|info| &info.value) {
            let error = error.clone();
            self.last_error = Some(error.clone());
            emit_event(RecordingEvent::Error {
                error: error.clone(),
                status: self.status(),
            });
            return Err(error);
        }
        let status = self.status();
        emit_event(RecordingEvent::Status {
            status: status.clone(),
        });
        Ok(status)
    }

    pub(in crate::agent) fn status(&self) -> RecordingStatus {
        let settings = self.settings.clone().unwrap_or_default();
        let info = self.info.as_ref().map(|info| &info.value);
        let backend = match info {
            Some(Ok(_)) => RecordingBackendState::Ready,
            Some(Err(_)) => RecordingBackendState::Error,
            None if self.last_error.is_some() => RecordingBackendState::Error,
            None => RecordingBackendState::Missing,
        };
        let mode = if self.session.is_some() {
            RecordingMode::ReplayBuffer
        } else {
            RecordingMode::Idle
        };
        let run_state = match (&backend, &mode) {
            (RecordingBackendState::Error, _) => RecordingRunState::Error,
            (_, RecordingMode::ReplayBuffer) => RecordingRunState::ReplayBuffer,
            _ => RecordingRunState::Idle,
        };
        let available_codecs = match (info, &settings.encoder) {
            (Some(Ok(info)), RecordingEncoder::Hardware) => info.hardware_codecs(),
            (Some(Ok(info)), RecordingEncoder::Software) if info.software_h264() => {
                vec![RecordingCodec::H264]
            }
            _ => Vec::new(),
        };
        let available_gpus = match info {
            Some(Ok(info)) if !info.vendor.is_empty() => {
                vec![format!("adapter:0:{}", info.vendor.to_uppercase())]
            }
            _ => Vec::new(),
        };

        RecordingStatus {
            backend,
            mode,
            capture_mode: settings.capture_mode.clone(),
            run_state,
            replay_active: self
                .session
                .as_ref()
                .is_some_and(|session| !session.game_content_expired()),
            active_game: self.active_game.as_ref().map(|game| game.game.name.clone()),
            active_game_detail: self.active_game.as_ref().map(|game| game.game.clone()),
            active_display: self
                .session
                .as_ref()
                .map(|session| session.monitor.clone())
                .or_else(|| self.selected_monitor(&settings))
                .map(|monitor| self.monitor_display(&monitor)),
            // Wayland does not say which window has focus. A detected game is
            // treated as the one being played.
            focused: self.active_game.is_some(),
            current_source: self
                .session
                .as_ref()
                .map(|session| session.capture.source)
                .or_else(|| self.last_capture.as_ref().map(|capture| capture.source)),
            current_capture: self
                .session
                .as_ref()
                .map(|session| {
                    let mut capture = session.capture.clone();
                    capture.game = self.capture_context_game(session).cloned();
                    capture
                })
                .or_else(|| self.last_capture.clone()),
            replay_buffer_seconds: settings.replay_buffer_seconds,
            available_gpus,
            available_codecs,
            available_audio_devices: self
                .audio_devices
                .as_ref()
                .map(|devices| devices.value.clone())
                .unwrap_or_default(),
            available_audio_applications: self
                .audio_applications
                .as_ref()
                .map(|applications| applications.value.clone())
                .unwrap_or_default(),
            telemetry: None,
            message: self.last_error.clone(),
        }
    }

    pub(in crate::agent) fn tick(&mut self) {
        self.refresh_discovery();
        let Some(settings) = self.settings.clone() else {
            return;
        };
        if !settings.enabled || self.info.as_ref().is_none_or(|info| info.value.is_err()) {
            return;
        }

        if self
            .game_detected_at
            .is_none_or(|at| at.elapsed() >= GAME_DETECTION_INTERVAL)
        {
            self.game_detected_at = Some(Instant::now());
            self.refresh_active_game(&settings);
        }

        // A game buffer outlives its game by one buffer length; game mode
        // follows a different game with a fresh buffer.
        let game_switched = settings.capture_mode == RecordingCaptureMode::Game
            && self.active_game.is_some()
            && self.session.as_ref().is_some_and(|session| {
                session.game_key.as_deref() != self.active_game.as_ref().map(|game| &*game.key)
            });
        if game_switched
            || self
                .session
                .as_ref()
                .is_some_and(Session::game_content_expired)
        {
            self.stop_session();
        }

        if let Some(error) = self
            .session
            .as_mut()
            .and_then(|session| session.process.exited())
        {
            let target = self.replay_target(&settings);
            self.stop_session();
            self.remember_replay_start_failure(target, error);
            return;
        }

        if self.session.is_none() && self.capture_target_available(&settings) {
            let target = self.replay_target(&settings);
            if self.replay_start_waiting(target.as_deref()) {
                return;
            }
            match self.start_session(&settings) {
                Ok(()) => self.replay_start_failure = None,
                Err(error) => self.remember_replay_start_failure(target, error),
            }
        }
    }

    pub(in crate::agent) fn save_replay_clip(
        &mut self,
        params: SaveReplayClipParams,
    ) -> RecordingActionResult {
        if self
            .session
            .as_ref()
            .is_some_and(Session::game_content_expired)
        {
            self.stop_session();
        }
        let settings = self.settings.clone().unwrap_or_default();
        let output_folder = self.current_output_folder();
        let Some(session) = self.session.as_mut() else {
            return RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            };
        };
        let duration_seconds = params
            .duration_seconds
            .clamp(15, settings.replay_buffer_seconds.max(15));
        let saved = output_folder.and_then(|output_folder| {
            let saved = session.process.save(duration_seconds)?;
            Ok((saved, output_folder))
        });
        let (saved, output_folder) = match saved {
            Ok(saved) => saved,
            Err(error) => return self.report_action_error(error),
        };
        let Some(session) = self.session.as_ref() else {
            return self.report_action_error("The replay buffer stopped while saving.".into());
        };
        let game = self.capture_context_game(session).cloned();
        let destination = saved_recording_path(&output_folder, game.as_ref());
        if let Err(error) = move_file(&saved, &destination) {
            return self.report_action_error(format!(
                "Could not move the saved replay to {}: {error}",
                destination.display()
            ));
        }

        let capture = RecordingCapture {
            id: format!("capture-{}", timestamp_millis()),
            filename: destination.to_string_lossy().into_owned(),
            content_type: CONTENT_TYPE_MP4.to_string(),
            size_bytes: fs::metadata(&destination)
                .ok()
                .map(|metadata| metadata.len()),
            duration_ms: Some(u64::from(duration_seconds) * 1000),
            width: session.capture.width,
            height: session.capture.height,
            game,
            source: session.capture.source,
            kind: RecordingCaptureKind::Replay,
            post_process: None,
            created_at: system_time_iso(unix_millis_to_system_time(params.requested_at_unix_ms)),
        };
        self.last_capture = Some(capture.clone());
        self.last_error = None;
        let status = self.status();
        emit_event(RecordingEvent::CaptureReady {
            capture: capture.clone(),
            status: status.clone(),
        });
        RecordingActionResult {
            ok: true,
            status,
            capture: Some(capture),
            error: None,
        }
    }

    pub(in crate::agent) fn save_screenshot(&mut self) -> RecordingActionResult {
        match self.capture_screenshot() {
            Ok(capture) => {
                self.last_capture = Some(capture.clone());
                let status = self.status();
                emit_event(RecordingEvent::CaptureReady {
                    capture: capture.clone(),
                    status: status.clone(),
                });
                RecordingActionResult {
                    ok: true,
                    status,
                    capture: Some(capture),
                    error: None,
                }
            }
            Err(error) => self.action_error(&error),
        }
    }

    pub(in crate::agent) fn shutdown(&mut self) {
        if let Some(mut session) = self.session.take() {
            session.process.stop();
            remove_scratch_folder(&session.scratch);
        }
    }

    fn capture_screenshot(&self) -> Result<RecordingCapture, String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Start capture before taking a screenshot.")?;
        let game = self.capture_context_game(session);
        let directory = self
            .current_output_folder()?
            .join("Screenshots")
            .join(recording_context_folder(game));
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let slug = timestamp_file_slug();
        let path = directory.join(format!("screenshot-{slug}.png"));
        // gpu-screen-recorder picks the image format from the extension.
        let temporary = directory.join(format!(".screenshot-{slug}.tmp.png"));
        let result = gsr::screenshot(&session.monitor.name, &temporary)
            .and_then(|()| fs::rename(&temporary, &path).map_err(|error| error.to_string()));
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        Ok(RecordingCapture {
            id: format!("screenshot-{}", timestamp_millis()),
            filename: path.to_string_lossy().into_owned(),
            content_type: "image/png".into(),
            size_bytes: fs::metadata(&path).ok().map(|metadata| metadata.len()),
            duration_ms: None,
            width: Some(session.monitor.width),
            height: Some(session.monitor.height),
            game: game.cloned(),
            source: session.capture.source,
            kind: RecordingCaptureKind::Screenshot,
            post_process: None,
            created_at: now_iso(),
        })
    }

    fn start_session(&mut self, settings: &RecordingSettings) -> Result<(), String> {
        let monitor = self
            .selected_monitor(settings)
            .ok_or("No monitor is available to record.")?;
        let config = self.replay_config(settings, &monitor);
        let scratch = create_session_scratch_folder(&self.current_replay_scratch_folder()?)?;
        let socket = socket_path(&scratch);
        let process = match ReplayProcess::start(&config, &scratch, &socket) {
            Ok(process) => process,
            Err(error) => {
                remove_scratch_folder(&scratch);
                return Err(error);
            }
        };

        let game_mode = settings.capture_mode == RecordingCaptureMode::Game;
        let game = self.active_game.as_ref().filter(|_| game_mode);
        let output = config.output.unwrap_or(monitor.dimensions());
        let output_folder = self.current_output_folder()?;
        let capture = RecordingCapture {
            id: format!("capture-{}", timestamp_millis()),
            filename: saved_recording_path(
                &output_folder,
                self.active_game.as_ref().map(|game| &game.game),
            )
            .to_string_lossy()
            .into_owned(),
            content_type: CONTENT_TYPE_MP4.to_string(),
            size_bytes: None,
            duration_ms: None,
            width: Some(output.width),
            height: Some(output.height),
            game: game.map(|game| game.game.clone()),
            source: capture_source(settings),
            kind: RecordingCaptureKind::Replay,
            post_process: None,
            created_at: now_iso(),
        };
        self.session = Some(Session {
            process,
            config,
            scratch,
            monitor,
            capture,
            game_key: game.map(|game| game.key.clone()),
            game_content_expires_at: None,
        });
        self.last_capture = None;
        self.last_error = None;
        emit_event(RecordingEvent::ReplayBufferStarted {
            status: self.status(),
        });
        Ok(())
    }

    fn stop_session(&mut self) {
        let Some(mut session) = self.session.take() else {
            return;
        };
        session.process.stop();
        remove_scratch_folder(&session.scratch);
        emit_event(RecordingEvent::Status {
            status: self.status(),
        });
    }

    fn replay_config(&self, settings: &RecordingSettings, monitor: &Monitor) -> ReplayConfig {
        let source = monitor.dimensions();
        let quality = effective_quality_for_base(settings, source);
        let cpu = settings.encoder == RecordingEncoder::Software;
        let available = self
            .info
            .as_ref()
            .and_then(|info| info.value.as_ref().ok())
            .map(GsrInfo::hardware_codecs)
            .unwrap_or_default();
        // The CPU encoder only does H.264, and a codec the GPU cannot encode
        // would keep the recorder from starting.
        let codec = if cpu || !available.contains(&settings.codec) {
            RecordingCodec::H264
        } else {
            settings.codec.clone()
        };
        // gpu-screen-recorder scales down, never up.
        let output = (quality.height < source.height).then_some(VideoDimensions {
            width: quality.width,
            height: quality.height,
        });
        ReplayConfig {
            monitor: monitor.name.clone(),
            fps: quality.fps,
            replay_seconds: settings.replay_buffer_seconds.max(5),
            storage: settings.buffer_storage.clone(),
            codec,
            cpu,
            bitrate_kbps: target_bitrate_kbps(&quality),
            output,
            audio: self.audio_sources(settings),
        }
    }

    /// gpu-screen-recorder mixes `|`-joined sources into one track. It has no
    /// per-source volume, so the volume sliders do not apply here. The
    /// selection follows the Windows recorder: no configured devices means
    /// the default output, and applications mode keeps the enabled
    /// microphones for voice-over.
    fn audio_sources(&self, settings: &RecordingSettings) -> Option<String> {
        let mut sources = Vec::new();
        match settings.audio_mode {
            RecordingAudioMode::Devices => {
                sources.extend(self.audio_device_sources(settings, None));
            }
            RecordingAudioMode::Applications => {
                for application in settings
                    .audio_applications
                    .iter()
                    .filter(|application| application.enabled)
                {
                    // `|` separates sources, so a name holding one would
                    // turn into a second, unintended source.
                    if application.name.is_empty() || application.name.contains('|') {
                        eprintln!(
                            "[{SIDE_CAR_NAME}] skipping audio application with an unusable name {:?}",
                            application.name
                        );
                        continue;
                    }
                    sources.push(format!("app:{}", application.name));
                }
                sources.extend(
                    self.audio_device_sources(settings, Some(&RecordingAudioDeviceKind::Input)),
                );
            }
        }
        sources.sort_unstable();
        sources.dedup();
        (!sources.is_empty()).then(|| sources.join("|"))
    }

    /// The enabled devices of `kind` (or all kinds) as gpu-screen-recorder
    /// sources, resolved against the current PipeWire devices. Unavailable
    /// devices are left out rather than failing the start.
    fn audio_device_sources(
        &self,
        settings: &RecordingSettings,
        kind: Option<&RecordingAudioDeviceKind>,
    ) -> Vec<String> {
        let available = self
            .audio_devices
            .as_ref()
            .map(|devices| devices.value.as_slice())
            .unwrap_or_default();
        selected_audio_devices(settings, kind)
            .into_iter()
            .map(|device| resolve_audio_device_selection(device, available))
            .filter(|device| {
                let known = device.id == "default"
                    || available.iter().any(|available| {
                        available.kind == device.kind && available.id == device.id
                    });
                if !known {
                    eprintln!(
                        "[{SIDE_CAR_NAME}] skipping unavailable audio device {}",
                        device.label
                    );
                }
                known
            })
            .map(|device| gsr::audio_device_source(&device))
            .collect()
    }

    fn refresh_discovery(&mut self) {
        let mut recovered = false;
        if Discovered::stale(&self.info, HARDWARE_DISCOVERY_TTL) {
            let info = gsr::info();
            if let Err(error) = &info {
                eprintln!("[{SIDE_CAR_NAME}] gpu-screen-recorder is unavailable: {error}");
            }
            // gpu-screen-recorder was installed while the agent ran.
            recovered = info.is_ok()
                && self
                    .info
                    .as_ref()
                    .is_some_and(|previous| previous.value.is_err());
            self.info = Some(Discovered {
                value: info,
                at: Instant::now(),
            });
        }
        if self.info.as_ref().is_some_and(|info| info.value.is_err()) {
            return;
        }
        if Discovered::stale(&self.monitors, MONITOR_DISCOVERY_TTL) {
            self.monitors = Some(Discovered {
                value: gsr::monitors(),
                at: Instant::now(),
            });
        }
        if Discovered::stale(&self.audio_devices, HARDWARE_DISCOVERY_TTL) {
            self.audio_devices = Some(Discovered {
                value: gsr::audio_devices(),
                at: Instant::now(),
            });
        }
        if Discovered::stale(&self.audio_applications, AUDIO_APPLICATION_DISCOVERY_TTL) {
            let applications = gsr::audio_applications()
                .into_iter()
                .map(|name| RecordingAudioApplicationSelection {
                    id: format!("app:{}", name.to_lowercase()),
                    window: name.clone(),
                    name,
                    executable: None,
                    icon_url: None,
                    process_id: None,
                    enabled: false,
                    volume: 100,
                })
                .collect();
            self.audio_applications = Some(Discovered {
                value: applications,
                at: Instant::now(),
            });
        }
        if recovered {
            self.last_error = None;
            emit_event(RecordingEvent::Status {
                status: self.status(),
            });
        }
    }

    fn refresh_active_game(&mut self, settings: &RecordingSettings) {
        if let Some(active) = &self.active_game {
            if !games::game_alive(active) {
                self.end_active_game(settings, "process exited", true);
            } else if !games::game_allowed(active, settings) {
                self.end_active_game(settings, "no longer passes detection rules", false);
            } else {
                return;
            }
        }
        let Some(game) = games::detect_game(settings) else {
            return;
        };
        eprintln!("[{SIDE_CAR_NAME}] game '{}' started", game.game.name);
        self.active_game = Some(game.clone());
        emit_event(RecordingEvent::GameStarted {
            game: game.game,
            status: self.status(),
        });
    }

    /// A game buffer keeps the closed game until its content ages out of the
    /// buffer; a game that is no longer allowed stops it at once.
    fn end_active_game(&mut self, settings: &RecordingSettings, reason: &str, closed: bool) {
        let Some(game) = self.active_game.as_ref().map(|game| game.key.clone()) else {
            return;
        };
        self.clear_active_game(reason);
        if settings.capture_mode != RecordingCaptureMode::Game {
            return;
        }
        let records_game = self
            .session
            .as_ref()
            .is_some_and(|session| session.game_key.as_deref() == Some(game.as_str()));
        if !records_game {
            return;
        }
        if closed {
            if let Some(session) = self.session.as_mut() {
                let seconds = u64::from(session.config.replay_seconds);
                session.game_content_expires_at =
                    Some(Instant::now() + Duration::from_secs(seconds));
            }
        } else {
            self.stop_session();
        }
    }

    fn clear_active_game(&mut self, reason: &str) {
        let Some(game) = self.active_game.take() else {
            return;
        };
        eprintln!(
            "[{SIDE_CAR_NAME}] game '{}' ended: {reason}",
            game.game.name
        );
        emit_event(RecordingEvent::GameEnded {
            game: game.game,
            status: self.status(),
        });
    }

    fn capture_target_available(&self, settings: &RecordingSettings) -> bool {
        match settings.capture_mode {
            RecordingCaptureMode::Display => self.selected_monitor(settings).is_some(),
            RecordingCaptureMode::Game => self.active_game.is_some(),
        }
    }

    fn replay_target(&self, settings: &RecordingSettings) -> Option<String> {
        match settings.capture_mode {
            RecordingCaptureMode::Display => self
                .selected_monitor(settings)
                .map(|monitor| format!("display:{}", monitor.name)),
            RecordingCaptureMode::Game => self
                .active_game
                .as_ref()
                .map(|game| format!("game:{}", game.key)),
        }
    }

    fn replay_start_waiting(&self, target: Option<&str>) -> bool {
        self.replay_start_failure.as_ref().is_some_and(|failure| {
            failure.target.as_deref() == target && Instant::now() < failure.retry_at
        })
    }

    /// Records a failed start. The first failure for a target and any change
    /// of error are reported; repeats only update the status message.
    fn remember_replay_start_failure(&mut self, target: Option<String>, error: String) {
        let previous = self
            .replay_start_failure
            .take()
            .filter(|failure| failure.target == target);
        let report = previous
            .as_ref()
            .is_none_or(|failure| failure.error != error);
        let attempts = previous
            .as_ref()
            .map_or(0, |failure| failure.attempts)
            .saturating_add(1);
        let wait = REPLAY_START_RETRY_MIN
            .saturating_mul(1 << (attempts - 1).min(5))
            .min(REPLAY_START_RETRY_MAX);
        eprintln!(
            "[{SIDE_CAR_NAME}] replay buffer start failed (attempt {attempts}); retrying in {}s: {error}",
            wait.as_secs()
        );
        self.last_error = Some(error.clone());
        self.replay_start_failure = Some(ReplayStartFailure {
            target,
            error: error.clone(),
            attempts,
            retry_at: Instant::now() + wait,
        });
        if report {
            emit_event(RecordingEvent::Error {
                error,
                status: self.status(),
            });
        }
    }

    fn selected_monitor(&self, settings: &RecordingSettings) -> Option<Monitor> {
        let monitors = self.monitors.as_ref()?;
        let selected = settings.selected_display_id.trim();
        monitors
            .value
            .iter()
            .find(|monitor| !selected.is_empty() && monitor.name == selected)
            .or_else(|| monitors.value.first())
            .cloned()
    }

    fn monitor_display(&self, monitor: &Monitor) -> crate::types::RecordingDisplay {
        let primary = self
            .monitors
            .as_ref()
            .and_then(|monitors| monitors.value.first())
            .is_some_and(|first| first.name == monitor.name);
        monitor.display(primary)
    }

    /// A display buffer can outlive several games, so it uses the current
    /// game. A game buffer keeps its game through the grace period.
    fn capture_context_game<'a>(&'a self, session: &'a Session) -> Option<&'a RecordingGame> {
        match session.capture.source {
            RecordingCaptureSource::Display => self.active_game.as_ref().map(|game| &game.game),
            RecordingCaptureSource::Game => session.capture.game.as_ref(),
        }
    }

    fn current_output_folder(&self) -> Result<PathBuf, String> {
        let folder = self
            .output_folder
            .clone()
            .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        fs::create_dir_all(&folder).map_err(|error| {
            format!(
                "Could not create output folder {}: {error}",
                folder.display()
            )
        })?;
        Ok(folder)
    }

    fn current_replay_scratch_folder(&self) -> Result<PathBuf, String> {
        let folder = match self.replay_scratch_folder.clone() {
            Some(folder) => folder,
            None => self.current_output_folder()?.join(".alloy-replay-buffer"),
        };
        fs::create_dir_all(&folder).map_err(|error| {
            format!(
                "Could not create replay scratch folder {}: {error}",
                folder.display()
            )
        })?;
        Ok(folder)
    }

    fn report_action_error(&mut self, error: String) -> RecordingActionResult {
        self.last_error = Some(error.clone());
        let result = self.action_error(&error);
        emit_event(RecordingEvent::Error {
            error,
            status: result.status.clone(),
        });
        result
    }

    fn action_error(&self, error: &str) -> RecordingActionResult {
        RecordingActionResult {
            ok: false,
            status: self.status(),
            capture: None,
            error: Some(error.to_string()),
        }
    }
}

impl Session {
    fn game_content_expired(&self) -> bool {
        self.game_content_expires_at
            .is_some_and(|expires_at| Instant::now() >= expires_at)
    }
}

fn capture_source(settings: &RecordingSettings) -> RecordingCaptureSource {
    match settings.capture_mode {
        RecordingCaptureMode::Display => RecordingCaptureSource::Display,
        RecordingCaptureMode::Game => RecordingCaptureSource::Game,
    }
}

/// The enabled device selections of `kind`, or of every kind. Settings that
/// never chose devices fall back to the defaults, like the Windows recorder,
/// so a fresh install records the default output instead of silence.
fn selected_audio_devices(
    settings: &RecordingSettings,
    kind: Option<&RecordingAudioDeviceKind>,
) -> Vec<RecordingAudioDeviceSelection> {
    let devices = if settings.audio_devices.is_empty() {
        default_audio_device_selections()
    } else {
        settings.audio_devices.clone()
    };
    devices
        .into_iter()
        .filter(|device| device.enabled && kind.is_none_or(|kind| device.kind == *kind))
        .collect()
}

/// Unix socket paths are limited to about 100 bytes, so the socket lives in
/// the runtime directory when there is one.
fn socket_path(scratch: &Path) -> PathBuf {
    let name = format!("alloy-replay-{}.sock", std::process::id());
    env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|directory| directory.is_dir())
        .unwrap_or_else(|| scratch.to_path_buf())
        .join(name)
}

/// A folder per session, so a save never picks up an earlier session's files
/// and stopping deletes the folder whole.
fn create_session_scratch_folder(root: &Path) -> Result<PathBuf, String> {
    let folder = root.join(format!("{SESSION_FOLDER_PREFIX}{}", timestamp_file_slug()));
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "Could not create replay scratch folder {}: {error}",
            folder.display()
        )
    })?;
    Ok(folder)
}

fn remove_scratch_folder(folder: &Path) {
    match fs::remove_dir_all(folder) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => eprintln!(
            "[{SIDE_CAR_NAME}] could not remove replay scratch folder {}: {error}",
            folder.display()
        ),
    }
}

/// Removes the session folders an earlier agent left behind. The watchdog
/// exit, a host kill and a crash all skip `Drop`, and a disk-storage session
/// can hold gigabytes of segments. `keep` is the running session's folder.
fn remove_stale_scratch_folders(root: &Path, keep: Option<&Path>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let session = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(SESSION_FOLDER_PREFIX));
        if !session || keep == Some(path.as_path()) || !path.is_dir() {
            continue;
        }
        eprintln!(
            "[{SIDE_CAR_NAME}] removing leftover replay scratch folder {}",
            path.display()
        );
        remove_scratch_folder(&path);
    }
}

fn recording_context_folder(game: Option<&RecordingGame>) -> String {
    game.map(|game| file_component(&game.name, "Desktop"))
        .unwrap_or_else(|| "Desktop".to_string())
}

fn saved_recording_path(output_folder: &Path, game: Option<&RecordingGame>) -> PathBuf {
    let directory = output_folder
        .join("Clips")
        .join(recording_context_folder(game));
    let slug = timestamp_file_slug();
    let mut path = directory.join(format!("clip-{slug}.mp4"));
    let mut counter = 2;
    while path.exists() {
        path = directory.join(format!("clip-{slug}-{counter}.mp4"));
        counter += 1;
    }
    path
}

/// The scratch folder (cache) and the capture folder can be on different
/// file systems.
fn move_file(source: &Path, destination: &Path) -> io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::rename(source, destination).is_ok() {
        return Ok(());
    }
    fs::copy(source, destination)?;
    fs::remove_file(source)
}
