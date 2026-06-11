impl Drop for Recorder {
    fn drop(&mut self) {
        self.shutdown();
    }
}

const HARDWARE_DISCOVERY_CACHE_TTL: Duration = Duration::from_secs(60);
const AUDIO_APPLICATION_DISCOVERY_CACHE_TTL: Duration = Duration::from_secs(10);

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

        let next_quality = effective_quality(&settings);
        let next_adapter = gpu_adapter(&settings);
        let needs_reinit = self
            .settings
            .as_ref()
            .map(|settings| (effective_quality(settings), gpu_adapter(settings)))
            != Some((next_quality, next_adapter))
            || self.obs_runtime_dir != params.obs_runtime_dir;
        let active_output_should_stop = self
            .settings
            .as_ref()
            .is_some_and(|current| active_settings_require_restart(current, &settings))
            || active_paths_changed
            || needs_reinit;

        self.settings = Some(settings);
        self.output_folder = Some(output_folder);
        self.replay_scratch_folder = Some(replay_scratch_folder);
        self.obs_runtime_dir = params.obs_runtime_dir;
        self.last_error = None;

        if active_output_should_stop {
            self.stop_all_outputs(true)?;
        }

        if needs_reinit {
            self.shutdown_obs();
        }

        self.refresh_discovery_caches();

        if !self.settings.as_ref().is_some_and(|settings| settings.enabled) {
            self.stop_all_outputs(false)?;
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
            .is_some_and(|session| session.paused)
            || self
                .long_session
                .as_ref()
                .is_some_and(|session| session.paused);
        let run_state = match (&backend, &mode, paused) {
            (RecordingBackendState::Error, _, _) => RecordingRunState::Error,
            (_, _, true) => RecordingRunState::Paused,
            (_, RecordingMode::Recording, _) => RecordingRunState::Recording,
            (_, RecordingMode::ReplayBuffer, _) => RecordingRunState::ReplayBuffer,
            _ => RecordingRunState::Idle,
        };

        RecordingStatus {
            backend,
            mode,
            capture_mode: settings.capture_mode.clone(),
            run_state,
            replay_active: self.replay_session.is_some(),
            long_recording_active: self.long_session.is_some(),
            active_game: self.active_game.as_ref().map(|game| game.game.name.clone()),
            active_game_detail: self.active_game.as_ref().map(|game| game.game.clone()),
            active_display: self.active_display.clone(),
            focused: self.focused,
            current_source: self
                .long_session
                .as_ref()
                .map(|session| session.capture.source.clone())
                .or_else(|| {
                    self.replay_session
                        .as_ref()
                        .map(|session| session.capture.source.clone())
                })
                .or_else(|| {
                    self.last_capture
                        .as_ref()
                        .map(|capture| capture.source.clone())
                }),
            current_capture: self
                .long_session
                .as_ref()
                .map(|session| session.capture.clone())
                .or_else(|| {
                    self.replay_session
                        .as_ref()
                        .map(|session| session.capture.clone())
                })
                .or_else(|| self.last_capture.clone()),
            replay_buffer_seconds: settings.replay_buffer_seconds,
            available_gpus: self.cached_gpus.clone(),
            available_codecs: self.available_codecs(&settings),
            available_audio_devices: self.cached_audio_devices.clone(),
            available_audio_applications: self.cached_audio_applications.clone(),
            message: self.last_error.clone(),
        }
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
        let output_folder = self.current_output_folder();
        let replay_scratch_folder = self.current_replay_scratch_folder();
        let path = saved_recording_path(
            &output_folder,
            "Clips",
            self.capture_folder_game(game.as_ref()),
        );
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
        emit_event(RecordingEvent::RecordingStarted { status });
        Ok(())
    }

    fn stop_active_replay_buffer(&mut self) -> Result<(), String> {
        let Some(mut session) = self.replay_session.take() else {
            return Err("Replay buffer state was lost.".to_string());
        };

        self.transfer_capture_ownership_from(&mut session);
        let output_config = session.output_config.clone();
        unsafe {
            self.stop_output(session)?;
        }
        self.last_error = None;
        cleanup_disk_replay_segments(&output_config, None);
        let status = self.status();
        emit_event(RecordingEvent::Status {
            status: status.clone(),
        });
        Ok(())
    }

    fn save_replay_clip(&mut self, params: SaveReplayClipParams) -> RecordingActionResult {
        if self.replay_session.is_none() {
            return RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            };
        }

        let Some(session) = self.replay_session.as_ref() else {
            let error = "Replay buffer state was lost.".to_string();
            self.last_error = Some(error.clone());
            let result = self.action_error(&error);
            emit_event(RecordingEvent::Error {
                error,
                status: result.status.clone(),
            });
            return result;
        };

        let settings = self.settings.clone().unwrap_or_default();
        let requested_at = unix_millis_to_system_time(params.requested_at_unix_ms);
        let duration_seconds = params
            .duration_seconds
            .clamp(15, settings.replay_buffer_seconds.max(15));
        let save = unsafe { self.save_replay(session, duration_seconds) };
        let path = match save {
            Ok(path) => path,
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
            chapter_status: RecordingChapterStatus::None,
            chapter_error: None,
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

    fn add_bookmark(&mut self, params: RecordingActionRequest) -> RecordingActionResult {
        let Some(session) = self.long_session.as_mut() else {
            return RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            };
        };

        let requested_at = unix_millis_to_system_time(params.requested_at_unix_ms);
        let position_ms = bookmark_position_ms(session, requested_at);
        session.bookmarks.push(RecordingBookmark {
            requested_at,
            position_ms,
        });
        RecordingActionResult {
            ok: true,
            status: self.status(),
            capture: None,
            error: None,
        }
    }

    fn toggle_long_recording(&mut self, _params: RecordingActionRequest) -> RecordingActionResult {
        if self.long_session.is_some() {
            self.manual_long_recording = false;
            return match self.stop_active_long_recording(true) {
                Ok(capture) => {
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
                Err(error) => self.stop_action_error(error),
            };
        }

        self.manual_long_recording = true;
        match self.start_long_recording() {
            Ok(()) => RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            },
            Err(error) => self.stop_action_error(error),
        }
    }

    fn stop_recording(&mut self) -> RecordingActionResult {
        if !self.has_active_outputs() {
            return RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            };
        }

        match self.stop_all_outputs(true) {
            Ok(capture) => RecordingActionResult {
                ok: true,
                status: self.status(),
                capture,
                error: None,
            },
            Err(error) => self.stop_action_error(error),
        }
    }

    fn stop_action_error(&mut self, error: String) -> RecordingActionResult {
        self.last_error = Some(error.clone());
        let result = self.action_error(&error);
        emit_event(RecordingEvent::Error {
            error,
            status: result.status.clone(),
        });
        result
    }

    fn shutdown(&mut self) {
        if let Some(session) = self.replay_session.take() {
            unsafe {
                let _ = self.stop_output(session);
            }
        }
        if let Some(session) = self.long_session.take() {
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
                gpu_adapter(settings),
            )?;
            self.available_encoders = obs.enumerate_encoders();
            let hardware_settings = RecordingSettings {
                encoder: RecordingEncoder::Hardware,
                ..settings.clone()
            };
            self.available_codecs =
                available_video_codecs(&obs, &hardware_settings, &self.available_encoder_set());
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

    fn current_output_folder(&self) -> PathBuf {
        let output_folder = self
            .output_folder
            .clone()
            .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let _ = fs::create_dir_all(&output_folder);
        output_folder
    }

    fn current_replay_scratch_folder(&self) -> PathBuf {
        let scratch_folder = self.replay_scratch_folder.clone().unwrap_or_else(|| {
            self.current_output_folder().join(".alloy-replay-buffer")
        });
        let _ = fs::create_dir_all(&scratch_folder);
        scratch_folder
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
            chapter_status: RecordingChapterStatus::None,
            chapter_error: None,
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
        let settings = self.settings.clone().unwrap_or_default();
        let previous_game_key = self.active_game.as_ref().map(|game| game.window_key.clone());
        let ended_game = if settings.capture_mode == RecordingCaptureMode::Game {
            if let Some(active_game) = self
                .active_game
                .clone()
                .filter(|game| !detected_game_allowed(game, &settings))
            {
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
            } else {
                let active_game = self.active_game.clone();
                self.observe_game(detect_game_activity(active_game.as_ref(), &settings))
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

        if ended_game.is_some() || game_switched {
            if let Err(error) = self.handle_game_boundary(&settings) {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
                return;
            }
        }

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

        if settings.capture_mode == RecordingCaptureMode::Game
            && settings.long_recording.auto_record_games
            && self.long_session.is_none()
            && self.active_game.is_some()
        {
            self.manual_long_recording = false;
            if let Err(error) = self.start_long_recording() {
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
            }
        }
    }

    fn clear_closed_active_game(&mut self) -> Option<RecordingGame> {
        let active_game = self
            .active_game
            .clone()
            .filter(|game| !is_detected_game_alive(game))?;

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

    fn start_long_recording(&mut self) -> Result<(), String> {
        if self.long_session.is_some() {
            return Ok(());
        }
        let settings = self.settings.clone().unwrap_or_default();
        let game =
            self.capture_game_for_mode("No detected game is available for long recording.")?;
        let output_folder = self.current_output_folder();
        let filename = saved_recording_path(
            &output_folder,
            "Sessions",
            self.capture_folder_game(game.as_ref()),
        );
        let capture = self.new_capture(
            &settings,
            game.as_ref(),
            RecordingCaptureKind::LongRecording,
            filename.to_string_lossy().into_owned(),
        );
        let session = self.start_file_output(
            &settings,
            game.as_ref(),
            ActiveOutputKind::LongRecording,
            capture,
        )?;
        self.long_session = Some(session);
        self.last_capture = None;
        self.last_error = None;
        let status = self.status();
        emit_event(RecordingEvent::Status { status });
        Ok(())
    }

    fn stop_active_long_recording(
        &mut self,
        embed_chapters: bool,
    ) -> Result<RecordingCapture, String> {
        let Some(mut session) = self.long_session.take() else {
            return Err("Recording state was lost.".to_string());
        };
        self.transfer_capture_ownership_from(&mut session);
        let mut capture = session.capture.clone();
        let started_at = session.started_at;
        let total_paused = session_total_paused(&session);
        let bookmarks = session.bookmarks.clone();
        unsafe {
            self.stop_output(session)?;
        }
        capture.size_bytes = fs::metadata(&capture.filename)
            .ok()
            .map(|metadata| metadata.len());
        capture.duration_ms = session_duration_ms(started_at, total_paused);
        if embed_chapters && !bookmarks.is_empty() {
            match embed_bookmarks_as_chapters(&capture.filename, &bookmarks, capture.duration_ms) {
                Ok(()) => {
                    capture.chapter_status = RecordingChapterStatus::Ok;
                    capture.chapter_error = None;
                    capture.size_bytes = fs::metadata(&capture.filename)
                        .ok()
                        .map(|metadata| metadata.len());
                }
                Err(error) => {
                    capture.chapter_status = RecordingChapterStatus::Failed;
                    capture.chapter_error = Some(error);
                }
            }
        }
        self.last_capture = Some(capture.clone());
        self.last_error = None;
        Ok(capture)
    }

    fn stop_all_outputs(
        &mut self,
        emit_file_capture: bool,
    ) -> Result<Option<RecordingCapture>, String> {
        if self.replay_session.is_some() {
            self.stop_active_replay_buffer()?;
        }

        if self.long_session.is_some() {
            let capture = self.stop_active_long_recording(true)?;
            if emit_file_capture {
                let status = self.status();
                emit_event(RecordingEvent::CaptureReady {
                    capture: capture.clone(),
                    status,
                });
            } else {
                let status = self.status();
                emit_event(RecordingEvent::Status { status });
            }
            return Ok(Some(capture));
        }
        Ok(None)
    }

    fn handle_game_boundary(&mut self, settings: &RecordingSettings) -> Result<(), String> {
        let restart_auto_long = settings.capture_mode == RecordingCaptureMode::Game
            && settings.long_recording.auto_record_games
            && self.long_session.is_some()
            && !self.manual_long_recording
            && self.active_game.is_some();

        if self.replay_session.is_some() {
            self.stop_active_replay_buffer()?;
        }
        if self.long_session.is_some() {
            let capture = self.stop_active_long_recording(true)?;
            let status = self.status();
            emit_event(RecordingEvent::CaptureReady { capture, status });
        }

        if restart_auto_long {
            self.manual_long_recording = false;
            self.start_long_recording()?;
        }
        if settings.enabled && self.capture_target_available(settings) {
            self.start_replay_buffer()?;
        }
        Ok(())
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

    fn transfer_capture_ownership_from(&mut self, session: &mut ActiveSession) {
        if !session.owns_capture {
            return;
        }
        if let Some(long_session) = self.long_session.as_mut() {
            long_session.owns_capture = true;
            long_session.video_graph = session.video_graph;
            long_session.audio_sources = session.audio_sources.clone();
            long_session.source_kind = session.source_kind;
            session.owns_capture = false;
            return;
        }
        if let Some(replay_session) = self.replay_session.as_mut() {
            replay_session.owns_capture = true;
            replay_session.video_graph = session.video_graph;
            replay_session.audio_sources = session.audio_sources.clone();
            replay_session.source_kind = session.source_kind;
            session.owns_capture = false;
        }
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
        for session in [&mut self.replay_session, &mut self.long_session]
            .into_iter()
            .flatten()
        {
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
        Ok(())
    }

}
