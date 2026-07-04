impl Drop for Recorder {
    fn drop(&mut self) {
        self.shutdown();
    }
}

const HARDWARE_DISCOVERY_CACHE_TTL: Duration = Duration::from_secs(60);
const AUDIO_APPLICATION_DISCOVERY_CACHE_TTL: Duration = Duration::from_secs(10);
/// How long to wait before retrying a failed codec capability probe; each
/// attempt spins a full OBS instance up and back down.
const CODEC_PROBE_RETRY_COOLDOWN: Duration = Duration::from_secs(30);
const TELEMETRY_EVENT_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GameBoundaryReason {
    Closed,
    Changed,
    Disallowed,
}

impl Recorder {
    fn configure(&mut self, params: ConfigureParams) -> Result<RecordingStatus, String> {
        let settings = params.settings;
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

        let active_paths_changed = self.has_active_outputs()
            && !self.can_reconfigure_active_output_paths(
                &output_folder,
                &replay_scratch_folder,
                params.obs_runtime_dir.as_ref(),
            );

        self.refresh_active_capture_metadata(&settings);
        self.refresh_gpu_cache();
        let active_video_config_changed = self.active_video_config_changed(&settings);
        let next_quality = effective_quality(&settings);
        let next_adapter = selected_gpu_adapter(&settings, &self.cached_gpus);
        let needs_reinit = self
            .settings
            .as_ref()
            .map(|settings| {
                (
                    effective_quality(settings),
                    selected_gpu_adapter(settings, &self.cached_gpus),
                )
            })
            != Some((next_quality, next_adapter))
            || self.obs_runtime_dir != params.obs_runtime_dir;
        let active_output_should_stop = self
            .settings
            .as_ref()
            .is_some_and(|current| active_settings_require_restart(current, &settings))
            || active_paths_changed
            || needs_reinit
            || active_video_config_changed;
        self.settings = Some(settings);
        self.output_folder = Some(output_folder);
        self.replay_scratch_folder = Some(replay_scratch_folder);
        self.obs_runtime_dir = params.obs_runtime_dir;
        self.last_error = None;

        if active_output_should_stop {
            if let Err(error) = self.stop_all_outputs() {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error {
                    error: error.clone(),
                    status,
                });
                return Err(error);
            }
        }

        if needs_reinit || active_video_config_changed {
            self.shutdown_obs();
        }

        self.refresh_discovery_caches();

        if !self.settings.as_ref().is_some_and(|settings| settings.enabled) {
            if let Err(error) = self.stop_all_outputs() {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error {
                    error: error.clone(),
                    status,
                });
                return Err(error);
            }
            self.shutdown_obs();
            self.refresh_codec_capabilities();
            let status = self.status();
            emit_event(RecordingEvent::Status {
                status: status.clone(),
            });
            return Ok(status);
        }

        if let Err(error) = self.ensure_obs() {
            self.last_error = Some(error.clone());
            let status = self.status();
            emit_event(RecordingEvent::Error {
                error: error.clone(),
                status: status.clone(),
            });
            return Err(error);
        }

        // Re-evaluate capture targets right away so outputs stopped by this
        // reconfigure (or enabled by it) resume without waiting for the next
        // detection tick.
        self.tick();

        self.refresh_codec_capabilities();
        let status = self.status();
        emit_event(RecordingEvent::Status {
            status: status.clone(),
        });
        Ok(status)
    }

    fn status(&self) -> RecordingStatus {
        self.status_with_telemetry(self.current_telemetry())
    }

    fn status_with_telemetry(&self, telemetry: Option<RecordingTelemetry>) -> RecordingStatus {
        let settings = self.settings.clone().unwrap_or_default();
        let backend = if self.obs.is_some() {
            RecordingBackendState::Ready
        } else if self.last_error.is_some() {
            RecordingBackendState::Error
        } else {
            RecordingBackendState::Missing
        };

        let mode = self.current_mode();
        let paused = self
            .replay_session
            .as_ref()
            .is_some_and(|session| session.paused);
        let run_state = match (&backend, &mode, paused) {
            (RecordingBackendState::Error, _, _) => RecordingRunState::Error,
            (_, _, true) => RecordingRunState::Paused,
            (_, RecordingMode::ReplayBuffer, _) => RecordingRunState::ReplayBuffer,
            _ => RecordingRunState::Idle,
        };

        RecordingStatus {
            backend,
            mode,
            capture_mode: settings.capture_mode.clone(),
            run_state,
            replay_active: self.replay_session.is_some(),
            active_game: self.active_game.as_ref().map(|game| game.game.name.clone()),
            active_game_detail: self.active_game.as_ref().map(|game| game.game.clone()),
            active_display: self.active_display.clone(),
            focused: self.focused,
            current_source: self
                .replay_session
                .as_ref()
                .map(|session| session.capture.source.clone())
                .or_else(|| {
                    self.last_capture
                        .as_ref()
                        .map(|capture| capture.source.clone())
                }),
            current_capture: self
                .replay_session
                .as_ref()
                .map(|session| session.capture.clone())
                .or_else(|| self.last_capture.clone()),
            replay_buffer_seconds: settings.replay_buffer_seconds,
            available_gpus: self.cached_gpus.clone(),
            available_codecs: self.available_codecs(&settings),
            available_audio_devices: self.cached_audio_devices.clone(),
            available_audio_applications: self.cached_audio_applications.clone(),
            telemetry,
            message: self.last_error.clone(),
        }
    }

    fn current_telemetry(&self) -> Option<RecordingTelemetry> {
        let session = self.replay_session.as_ref()?;
        let obs = self.obs.as_ref()?;
        let settings = self.settings.clone().unwrap_or_default();
        let OutputConfig::ReplayBuffer {
            scratch_directory: _,
            output_directory: _,
            storage,
            replay_seconds: _,
        } = &session.output_config;
        let quality = effective_quality_for_base(&settings, session.video_config.base);
        let render_total_frames = unsafe { obs.obs_get_total_frames.map(|read| read()) };
        let render_lagged_frames = unsafe { obs.obs_get_lagged_frames.map(|read| read()) };
        let output_total_frames = unsafe {
            obs.obs_output_get_total_frames
                .and_then(|read| nonnegative_c_int(read(session.output)))
        };
        let output_dropped_frames = unsafe {
            obs.obs_output_get_frames_dropped
                .and_then(|read| nonnegative_c_int(read(session.output)))
        };

        Some(RecordingTelemetry {
            sampled_at: now_iso(),
            capture_mode: settings.capture_mode.clone(),
            capture_source: Some(recording_source_from_kind(session.source_kind)),
            buffer_storage: storage.clone(),
            encoder: settings.encoder.clone(),
            codec: session.video_codec.clone(),
            video_encoder: Some(session.video_encoder_id.clone()),
            audio_encoder: Some(session.audio_encoder_id.clone()),
            gpu: settings.gpu.clone(),
            gpu_adapter: selected_gpu_adapter(&settings, &self.cached_gpus),
            gpu_label: selected_gpu_label(&settings, &self.cached_gpus).map(str::to_string),
            base_width: session.video_config.base.width,
            base_height: session.video_config.base.height,
            output_width: session.video_config.output.width,
            output_height: session.video_config.output.height,
            fps: session.video_config.fps,
            bitrate_kbps: target_bitrate_kbps(&quality),
            output_active: unsafe { (obs.obs_output_active)(session.output) },
            paused: session.paused,
            active_fps: unsafe { obs.obs_get_active_fps.map(|read| read()) },
            average_frame_time_ms: unsafe {
                obs.obs_get_average_frame_time_ns.map(|read| ns_to_ms(read()))
            },
            frame_interval_ms: unsafe {
                obs.obs_get_frame_interval_ns.map(|read| ns_to_ms(read()))
            },
            render_total_frames,
            render_lagged_frames,
            render_lagged_percent: percent(render_lagged_frames, render_total_frames),
            output_total_frames,
            output_dropped_frames,
            output_dropped_percent: percent(output_dropped_frames, output_total_frames),
            output_total_bytes: unsafe {
                obs.obs_output_get_total_bytes
                    .map(|read| read(session.output))
            },
        })
    }

    fn emit_telemetry_if_due(&mut self) {
        let Some(telemetry) = self.current_telemetry() else {
            self.last_telemetry_event_at = None;
            return;
        };
        if self
            .last_telemetry_event_at
            .is_some_and(|last| last.elapsed() < TELEMETRY_EVENT_INTERVAL)
        {
            return;
        }

        self.last_telemetry_event_at = Some(Instant::now());
        let status = self.status_with_telemetry(Some(telemetry.clone()));
        emit_event(RecordingEvent::Telemetry { telemetry, status });
    }

    fn can_reconfigure_active_output_paths(
        &self,
        output_folder: &PathBuf,
        replay_scratch_folder: &PathBuf,
        obs_runtime_dir: Option<&PathBuf>,
    ) -> bool {
        if self.output_folder.as_ref() != Some(output_folder)
            || self.replay_scratch_folder.as_ref() != Some(replay_scratch_folder)
            || self.obs_runtime_dir.as_ref() != obs_runtime_dir
        {
            return false;
        }
        true
    }

    fn start_replay_buffer(&mut self) -> Result<(), String> {
        if self.replay_session.is_some() {
            return Ok(());
        }

        let settings = self.settings.clone().unwrap_or_default();
        let game = self.capture_game_for_mode("No detected game is available for replay buffer.")?;
        let output_folder = self.current_output_folder()?;
        let replay_scratch_folder = self.current_replay_scratch_folder()?;
        let path = saved_recording_path(&output_folder, self.capture_folder_game(game.as_ref()));
        let capture = self.new_capture(
            &settings,
            game.as_ref(),
            RecordingCaptureKind::Replay,
            path.to_string_lossy().into_owned(),
        );

        let session = self.start_output(
            &settings,
            game.as_ref(),
            ActiveOutputKind::ReplayBuffer,
            capture,
            OutputConfig::ReplayBuffer {
                scratch_directory: replay_scratch_folder,
                output_directory: output_folder,
                storage: settings.buffer_storage.clone(),
                replay_seconds: settings.replay_buffer_seconds,
            },
        )?;

        self.replay_session = Some(session);
        self.last_capture = None;
        self.last_error = None;
        let status = self.status();
        emit_event(RecordingEvent::Status {
            status: status.clone(),
        });
        emit_event(RecordingEvent::ReplayBufferStarted { status });
        Ok(())
    }

    fn stop_active_replay_buffer(&mut self) -> Result<(), String> {
        let Some(session) = self.replay_session.take() else {
            return Err("No replay buffer is active.".to_string());
        };

        let output_config = session.output_config.clone();
        // SAFETY: `session` was created by this recorder for the current OBS
        // instance and is consumed here exactly once.
        let stop_result = unsafe { self.stop_output(session) };
        cleanup_disk_replay_segments(&output_config, None);
        let status = self.status();
        emit_event(RecordingEvent::Status { status });
        stop_result?;
        self.last_error = None;
        Ok(())
    }

    fn save_replay_clip(&mut self, params: SaveReplayClipParams) -> RecordingActionResult {
        let Some(session) = self.replay_session.as_ref() else {
            return RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            };
        };

        let settings = self.settings.clone().unwrap_or_default();
        let requested_at = unix_millis_to_system_time(params.requested_at_unix_ms);
        let duration_seconds = params
            .duration_seconds
            .clamp(15, settings.replay_buffer_seconds.max(15));
        let save = unsafe { self.save_replay(session, duration_seconds) };
        let saved = match save {
            Ok(saved) => saved,
            Err(error) => {
                self.last_error = Some(error.clone());
                let result = self.action_error(&error);
                emit_event(RecordingEvent::Error {
                    error,
                    status: result.status.clone(),
                });
                return result;
            }
        };
        let path = saved.path;

        let output_dimensions = session.video_config.output;
        let capture = RecordingCapture {
            id: format!("capture-{}", timestamp_millis()),
            filename: path.clone(),
            content_type: CONTENT_TYPE_MP4.to_string(),
            size_bytes: fs::metadata(&path).ok().map(|metadata| metadata.len()),
            duration_ms: Some(u64::from(duration_seconds) * 1000),
            width: Some(output_dimensions.width),
            height: Some(output_dimensions.height),
            game: session.capture.game.clone(),
            source: session.capture.source.clone(),
            kind: RecordingCaptureKind::Replay,
            post_process: saved.post_process,
            created_at: system_time_iso(requested_at),
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

    fn shutdown(&mut self) {
        if let Some(session) = self.replay_session.take() {
            unsafe {
                let _ = self.stop_output(session);
            }
        }
        self.shutdown_obs();
    }

    fn shutdown_obs(&mut self) {
        if let Some(obs) = self.obs.take() {
            unsafe {
                obs.shutdown();
            }
        }
        self.obs_video_config = None;
        self.available_encoders.clear();
        self.available_codecs.clear();
    }

    fn ensure_obs(&mut self) -> Result<(), String> {
        let settings = self.settings.clone().unwrap_or_default();
        self.active_display = if settings.capture_mode == RecordingCaptureMode::Display {
            selected_display(&settings)
        } else {
            None
        };
        let game = if settings.capture_mode == RecordingCaptureMode::Display {
            None
        } else {
            self.active_game.clone()
        };
        let source_kind = source_kind(&settings, game.as_ref());
        self.ensure_obs_for_source(&settings, game.as_ref(), source_kind)
            .map(|_| ())
    }

    fn ensure_obs_for_source(
        &mut self,
        settings: &RecordingSettings,
        game: Option<&DetectedGame>,
        source_kind: OutputSourceKind,
    ) -> Result<ObsVideoConfig, String> {
        let video_config = obs_video_config(settings, game, source_kind);
        if self.obs.is_some() && self.obs_video_config == Some(video_config) {
            return Ok(video_config);
        }
        if self.obs.is_some() {
            if self.has_active_outputs() {
                return Err("Stop the current recording before changing the OBS video canvas."
                    .to_string());
            }
            self.shutdown_obs();
        }

        let obs = LibObs::load(self.obs_runtime_dir.as_deref())?;
        unsafe {
            obs.start(
                self.obs_runtime_dir.as_deref(),
                video_config,
                selected_gpu_adapter(settings, &self.cached_gpus),
            )?;
            self.available_encoders = obs.enumerate_encoders();
            let hardware_settings = RecordingSettings {
                encoder: RecordingEncoder::Hardware,
                ..settings.clone()
            };
            self.available_codecs = available_video_codecs(
                &obs,
                &hardware_settings,
                &self.available_encoders,
                selected_gpu_label(settings, &self.cached_gpus),
            );
        }
        self.obs = Some(obs);
        self.obs_video_config = Some(video_config);
        Ok(video_config)
    }

    fn refreshed_active_game(&mut self, missing_message: &str) -> Result<DetectedGame, String> {
        let mut game = self
            .active_game
            .clone()
            .ok_or_else(|| missing_message.to_string())?;
        refresh_capture_metadata(&mut game);
        self.active_game = Some(game.clone());
        Ok(game)
    }

    fn current_output_folder(&self) -> Result<PathBuf, String> {
        let output_folder = self
            .output_folder
            .clone()
            .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        fs::create_dir_all(&output_folder).map_err(|error| {
            format!(
                "Could not create output folder {}: {error}",
                output_folder.display()
            )
        })?;
        Ok(output_folder)
    }

    fn current_replay_scratch_folder(&self) -> Result<PathBuf, String> {
        let scratch_folder = match self.replay_scratch_folder.clone() {
            Some(scratch_folder) => scratch_folder,
            None => self.current_output_folder()?.join(".alloy-replay-buffer"),
        };
        fs::create_dir_all(&scratch_folder).map_err(|error| {
            format!(
                "Could not create replay scratch folder {}: {error}",
                scratch_folder.display()
            )
        })?;
        Ok(scratch_folder)
    }

    fn new_capture(
        &self,
        settings: &RecordingSettings,
        game: Option<&DetectedGame>,
        kind: RecordingCaptureKind,
        filename: String,
    ) -> RecordingCapture {
        let source_kind = source_kind(settings, game);
        let video_config = obs_video_config(settings, game, source_kind);
        RecordingCapture {
            id: format!("capture-{}", timestamp_millis()),
            filename,
            content_type: CONTENT_TYPE_MP4.to_string(),
            size_bytes: None,
            duration_ms: None,
            width: Some(video_config.output.width),
            height: Some(video_config.output.height),
            game: game.map(|game| game.game.clone()),
            source: recording_source_from_kind(source_kind),
            kind,
            post_process: None,
            created_at: now_iso(),
        }
    }

    fn observe_game(&mut self, detected: Option<GameDetection>) -> Option<RecordingGame> {
        let was_focused = self.focused;
        let previous_key = self
            .active_game
            .as_ref()
            .map(|game| game.window_key.clone());

        if let Some(detection) = detected {
            let detected = detection.game;
            let focused = detection.focused;
            let is_new = previous_key.as_deref() != Some(detected.window_key.as_str());
            self.missing_game_ticks = 0;
            self.focused = focused;
            self.active_game = Some(detected.clone());

            if is_new {
                let status = self.status();
                emit_event(RecordingEvent::GameStarted {
                    game: detected.game,
                    status,
                });
                if !focused {
                    let status = self.status();
                    emit_event(RecordingEvent::GameFocusChanged {
                        game: self.active_game.as_ref().map(|game| game.game.clone()),
                        focused: false,
                        status,
                    });
                }
            } else if was_focused != focused {
                let status = self.status();
                emit_event(RecordingEvent::GameFocusChanged {
                    game: self.active_game.as_ref().map(|game| game.game.clone()),
                    focused,
                    status,
                });
            }
            return None;
        }

        let Some(active_game) = self.active_game.clone() else {
            self.focused = false;
            return None;
        };

        self.focused = false;
        if was_focused {
            let status = self.status();
            emit_event(RecordingEvent::GameFocusChanged {
                game: Some(active_game.game.clone()),
                focused: false,
                status,
            });
        }

        if is_detected_game_alive(&active_game) {
            self.missing_game_ticks = 0;
            return None;
        }

        self.missing_game_ticks = self.missing_game_ticks.saturating_add(1);
        if self.missing_game_ticks < 8 {
            return None;
        }

        eprintln!(
            "[{SIDE_CAR_NAME}] game '{}' ended: window and process gone",
            active_game.game.name
        );
        self.active_game = None;
        self.focused = false;
        self.missing_game_ticks = 0;
        self.last_error = None;
        let status = self.status();
        emit_event(RecordingEvent::GameEnded {
            game: active_game.game.clone(),
            status,
        });
        Some(active_game.game)
    }

    fn tick(&mut self) {
        self.refresh_discovery_caches();
        if self.settings.is_none() {
            return;
        }
        // Codec caps can still be missing when the startup probe failed (OBS
        // was not ready to start yet); retry here so the settings UI fills in
        // without waiting for another configure call. No-op once cached.
        if !self.codec_caps_current() {
            self.refresh_codec_capabilities();
        }
        let settings = self.settings.clone().unwrap_or_default();
        let previous_game_key = self.active_game.as_ref().map(|game| game.window_key.clone());
        let game_boundary = if settings.capture_mode == RecordingCaptureMode::Game {
            if let Some(active_game) = self
                .active_game
                .clone()
                .filter(|game| !detected_game_allowed(game, &settings))
            {
                eprintln!(
                    "[{SIDE_CAR_NAME}] game '{}' ended: no longer passes detection rules",
                    active_game.game.name
                );
                self.active_game = None;
                self.focused = false;
                self.missing_game_ticks = 0;
                self.last_error = None;
                let status = self.status();
                emit_event(RecordingEvent::GameEnded {
                    game: active_game.game.clone(),
                    status,
                });
                Some(GameBoundaryReason::Disallowed)
            } else {
                let active_game = self.active_game.clone();
                self.observe_game(detect_game_activity(active_game.as_ref(), &settings))
                    .map(|_| GameBoundaryReason::Closed)
            }
        } else {
            self.active_game = None;
            self.focused = false;
            self.missing_game_ticks = 0;
            self.active_display = selected_display(&settings);
            None
        };
        let current_game_key = self.active_game.as_ref().map(|game| game.window_key.clone());
        let game_switched = previous_game_key.is_some()
            && current_game_key.is_some()
            && previous_game_key != current_game_key;
        let replay_target_changed = self.active_replay_target_changed(&settings);
        let game_boundary = if game_switched || replay_target_changed {
            Some(GameBoundaryReason::Changed)
        } else {
            game_boundary
        };

        if let Some(reason) = game_boundary {
            if let Err(error) = self.handle_game_boundary(&settings, reason) {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
                return;
            }
        }
        self.clear_replay_buffer_deadline_for_active_game(&settings);

        if self
            .replay_session
            .as_ref()
            .is_some_and(|session| active_session_should_stop(session, &settings))
        {
            if let Err(error) = self.stop_active_replay_buffer() {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
                return;
            }
        }

        if self.active_replay_buffer_game_content_expired() {
            if let Err(error) = self.stop_active_replay_buffer() {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
                return;
            }
        }

        if settings.enabled
            && self.replay_session.is_none()
            && self.capture_target_available(&settings)
        {
            if let Err(error) = self.start_replay_buffer() {
                if self.clear_closed_active_game().is_some() {
                    return;
                }
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
                return;
            }
        }

        if self.has_active_outputs() {
            if let Err(error) = self.refresh_active_output_for_focus() {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
                return;
            }
            self.emit_telemetry_if_due();
        } else {
            self.last_telemetry_event_at = None;
        }
    }

    fn clear_closed_active_game(&mut self) -> Option<RecordingGame> {
        let active_game = self
            .active_game
            .clone()
            .filter(|game| !is_detected_game_alive(game))?;

        eprintln!(
            "[{SIDE_CAR_NAME}] game '{}' cleared: window closed while starting capture",
            active_game.game.name
        );
        self.active_game = None;
        self.focused = false;
        self.missing_game_ticks = 0;
        self.last_error = None;
        let status = self.status();
        emit_event(RecordingEvent::GameEnded {
            game: active_game.game.clone(),
            status,
        });
        Some(active_game.game)
    }

    fn stop_all_outputs(&mut self) -> Result<(), String> {
        if self.replay_session.is_some() {
            self.stop_active_replay_buffer()?;
        }
        Ok(())
    }

    fn handle_game_boundary(
        &mut self,
        settings: &RecordingSettings,
        reason: GameBoundaryReason,
    ) -> Result<(), String> {
        if self.replay_session.is_some() {
            if reason == GameBoundaryReason::Closed {
                self.defer_active_replay_buffer_stop();
            } else {
                self.stop_active_replay_buffer()?;
            }
        }
        if settings.enabled && self.capture_target_available(settings) {
            self.start_replay_buffer()?;
        }
        Ok(())
    }

    fn defer_active_replay_buffer_stop(&mut self) {
        let Some(session) = self.replay_session.as_mut() else {
            return;
        };
        if session.capture.game.is_none() {
            return;
        }

        session.game_content_expires_at = Some(Instant::now() + replay_buffer_duration(session));
    }

    fn active_replay_buffer_game_content_expired(&self) -> bool {
        self.replay_session
            .as_ref()
            .and_then(|session| session.game_content_expires_at)
            .is_some_and(|expires_at| Instant::now() >= expires_at)
    }

    fn active_replay_target_changed(&self, settings: &RecordingSettings) -> bool {
        if settings.capture_mode != RecordingCaptureMode::Game {
            return false;
        }

        let Some(active_game) = self.active_game.as_ref() else {
            return false;
        };
        self.replay_session.as_ref().is_some_and(|session| {
            session.target_game_key.as_deref() != Some(active_game.window_key.as_str())
        })
    }

    fn clear_replay_buffer_deadline_for_active_game(&mut self, settings: &RecordingSettings) {
        if settings.capture_mode != RecordingCaptureMode::Game {
            return;
        }
        let Some(active_game) = self.active_game.as_ref() else {
            return;
        };
        let Some(session) = self.replay_session.as_mut() else {
            return;
        };
        if session.target_game_key.as_deref() == Some(active_game.window_key.as_str()) {
            session.game_content_expires_at = None;
        }
    }

    fn capture_target_available(&self, settings: &RecordingSettings) -> bool {
        match settings.capture_mode {
            RecordingCaptureMode::Display => selected_display(settings).is_some(),
            RecordingCaptureMode::Game => self.active_game.is_some(),
        }
    }

    fn capture_game_for_mode(
        &mut self,
        missing_message: &str,
    ) -> Result<Option<DetectedGame>, String> {
        if self
            .settings
            .as_ref()
            .is_some_and(|settings| settings.capture_mode == RecordingCaptureMode::Display)
        {
            return Ok(None);
        }
        self.refreshed_active_game(missing_message).map(Some)
    }

    fn capture_folder_game<'a>(
        &self,
        game: Option<&'a DetectedGame>,
    ) -> Option<&'a RecordingGame> {
        if self
            .settings
            .as_ref()
            .is_some_and(|settings| settings.capture_mode == RecordingCaptureMode::Display)
        {
            None
        } else {
            game.map(|game| &game.game)
        }
    }

    fn refresh_active_capture_metadata(&mut self, settings: &RecordingSettings) {
        if settings.capture_mode != RecordingCaptureMode::Game {
            return;
        }
        if let Some(game) = self.active_game.as_mut() {
            refresh_capture_metadata(game);
        }
    }

    fn active_video_config_changed(&self, settings: &RecordingSettings) -> bool {
        let Some(session) = self.capture_owner_session() else {
            return false;
        };
        let game = if settings.capture_mode == RecordingCaptureMode::Display {
            None
        } else {
            self.active_game.as_ref()
        };
        let source_kind = source_kind(settings, game);
        let video_config = obs_video_config(settings, game, source_kind);
        session.video_config != video_config
    }

    fn refresh_active_output_for_focus(&mut self) -> Result<(), String> {
        self.refresh_active_pause()?;
        self.refresh_active_source()
    }

    fn refresh_active_pause(&mut self) -> Result<(), String> {
        let settings = self.settings.clone().unwrap_or_default();
        let should_pause = should_pause_for_focus(&settings, self.active_game.as_ref(), self.focused);

        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
        for session in [&mut self.replay_session].into_iter().flatten() {
            if session.paused == should_pause || !session.can_pause {
                continue;
            }
            unsafe {
                if !(obs.obs_output_pause)(session.output, should_pause) {
                    return Err(if should_pause {
                        "OBS output failed to pause.".to_string()
                    } else {
                        "OBS output failed to resume.".to_string()
                    });
                }
                let paused = (obs.obs_output_paused)(session.output);
                update_session_pause_time(session, paused);
            }
        }

        let status = self.status();
        emit_event(RecordingEvent::Status { status });
        Ok(())
    }

    fn refresh_active_source(&mut self) -> Result<(), String> {
        let settings = self.settings.clone().unwrap_or_default();
        self.refresh_active_capture_metadata(&settings);
        if !self.active_video_config_changed(&settings) {
            return Ok(());
        }

        self.stop_all_outputs()?;
        self.shutdown_obs();
        self.tick();
        Ok(())
    }

}
