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

        let active_paths_changed = self.mode != RecordingMode::Idle
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
        let active_output_should_stop = self.session.as_ref().is_some_and(|session| {
            active_session_should_stop(session, &settings)
                || self
                    .settings
                    .as_ref()
                    .is_some_and(|current| active_settings_require_restart(current, &settings))
                || active_paths_changed
                || needs_reinit
        });

        self.settings = Some(settings);
        self.output_folder = Some(output_folder);
        self.replay_scratch_folder = Some(replay_scratch_folder);
        self.obs_runtime_dir = params.obs_runtime_dir;
        self.last_error = None;

        if active_output_should_stop {
            self.stop_active_auto_output(true)?;
        }

        if needs_reinit {
            self.shutdown_obs();
        }

        if !self
            .settings
            .as_ref()
            .is_some_and(|settings| settings.enabled)
        {
            if self.mode != RecordingMode::Idle {
                self.stop_active_auto_output(false)?;
            }
            self.shutdown_obs();
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

        let status = self.status();
        emit_event(RecordingEvent::Status {
            status: status.clone(),
        });
        Ok(status)
    }

    fn status(&mut self) -> RecordingStatus {
        let settings = self.settings.clone().unwrap_or_default();
        let backend = if self.obs.is_some() {
            RecordingBackendState::Ready
        } else if self.last_error.is_some() {
            RecordingBackendState::Error
        } else {
            RecordingBackendState::Missing
        };

        let paused = self.session.as_ref().is_some_and(|session| session.paused);
        let run_state = match (&backend, &self.mode, paused) {
            (RecordingBackendState::Error, _, _) => RecordingRunState::Error,
            (_, _, true) => RecordingRunState::Paused,
            (_, RecordingMode::Recording, _) => RecordingRunState::Recording,
            (_, RecordingMode::ReplayBuffer, _) => RecordingRunState::ReplayBuffer,
            _ => RecordingRunState::Idle,
        };

        let available_audio_devices = if settings.audio_mode == RecordingAudioMode::Devices {
            self.available_audio_devices()
        } else {
            self.cached_audio_devices.clone()
        };
        let available_audio_applications =
            if settings.audio_mode == RecordingAudioMode::Applications {
                self.available_audio_applications()
            } else {
                self.cached_audio_applications.clone()
            };

        RecordingStatus {
            backend,
            mode: self.mode.clone(),
            trigger_mode: settings.trigger_mode.clone(),
            run_state,
            active_game: self.active_game.as_ref().map(|game| game.game.name.clone()),
            active_game_detail: self.active_game.as_ref().map(|game| game.game.clone()),
            focused: self.focused,
            current_source: self
                .session
                .as_ref()
                .map(|session| session.capture.source.clone())
                .or_else(|| {
                    self.last_capture
                        .as_ref()
                        .map(|capture| capture.source.clone())
                }),
            current_capture: self
                .session
                .as_ref()
                .map(|session| session.capture.clone())
                .or_else(|| self.last_capture.clone()),
            replay_buffer_seconds: settings.replay_buffer_seconds,
            available_gpus: self.available_gpus(),
            available_codecs: self.available_codecs(&settings),
            available_audio_devices,
            available_audio_applications,
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
        if self.mode != RecordingMode::Idle {
            return Err("Stop the current recording before starting replay buffer.".to_string());
        }

        let settings = self.settings.clone().unwrap_or_default();
        let game = if settings.record_desktop {
            None
        } else {
            Some(
                self.active_game
                    .clone()
                    .ok_or_else(|| "No detected game is available for replay buffer.".to_string())?,
            )
        };
        let output_folder = self.current_output_folder();
        let replay_scratch_folder = self.current_replay_scratch_folder();
        let path = saved_recording_path(
            &output_folder,
            "Clips",
            game.as_ref().map(|game| &game.game),
        );
        let capture = self.new_capture(
            &settings,
            game.as_ref(),
            RecordingTriggerMode::ReplayBuffer,
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

        self.mode = RecordingMode::ReplayBuffer;
        self.session = Some(session);
        self.last_capture = None;
        self.last_error = None;
        let status = self.status();
        emit_event(RecordingEvent::Status {
            status: status.clone(),
        });
        Ok(())
    }

    fn stop_active_replay_buffer(&mut self) -> Result<(), String> {
        if self.mode != RecordingMode::ReplayBuffer {
            return Err("No replay buffer is running.".to_string());
        }

        let Some(session) = self.session.take() else {
            self.mode = RecordingMode::Idle;
            return Err("Replay buffer state was lost.".to_string());
        };

        let output_config = session.output_config.clone();
        unsafe {
            self.stop_output(session)?;
        }
        self.mode = RecordingMode::Idle;
        self.last_error = None;
        cleanup_disk_replay_segments(&output_config, None);
        let status = self.status();
        emit_event(RecordingEvent::Status {
            status: status.clone(),
        });
        Ok(())
    }

    fn save_replay_clip(&mut self) -> RecordingActionResult {
        if self.mode != RecordingMode::ReplayBuffer {
            return RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            };
        }

        let Some(session) = self.session.as_ref() else {
            let error = "Replay buffer state was lost.".to_string();
            self.last_error = Some(error.clone());
            let result = self.action_error(&error);
            emit_event(RecordingEvent::Error {
                error,
                status: result.status.clone(),
            });
            return result;
        };

        let save = unsafe { self.save_replay(session) };
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

        let settings = self.settings.clone().unwrap_or_default();
        let output_dimensions = session.video_config.output;
        let capture = RecordingCapture {
            id: format!("capture-{}", timestamp_millis()),
            filename: path.clone(),
            content_type: CONTENT_TYPE_MP4.to_string(),
            size_bytes: fs::metadata(&path).ok().map(|metadata| metadata.len()),
            duration_ms: Some(u64::from(settings.replay_buffer_seconds) * 1000),
            width: Some(output_dimensions.width),
            height: Some(output_dimensions.height),
            game: session.capture.game.clone(),
            source: session.capture.source.clone(),
            trigger_mode: RecordingTriggerMode::ReplayBuffer,
            created_at: now_iso(),
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

    fn stop_recording(&mut self) -> RecordingActionResult {
        let Some(kind) = self.session.as_ref().map(|session| session.kind) else {
            self.mode = RecordingMode::Idle;
            return RecordingActionResult {
                ok: true,
                status: self.status(),
                capture: None,
                error: None,
            };
        };

        match kind {
            ActiveOutputKind::ReplayBuffer => match self.stop_active_replay_buffer() {
                Ok(()) => RecordingActionResult {
                    ok: true,
                    status: self.status(),
                    capture: None,
                    error: None,
                },
                Err(error) => self.stop_action_error(error),
            },
            ActiveOutputKind::Session => match self.stop_active_file_output() {
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
            },
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
        if let Some(session) = self.session.take() {
            unsafe {
                let _ = self.stop_output(session);
            }
        }
        self.mode = RecordingMode::Idle;
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
        let game = self.active_game.clone();
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
            if self.mode != RecordingMode::Idle {
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
        trigger_mode: RecordingTriggerMode,
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
            trigger_mode,
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
        let status = self.status();
        emit_event(RecordingEvent::GameEnded {
            game: active_game.game.clone(),
            status,
        });
        Some(active_game.game)
    }

    fn tick(&mut self) {
        if self.settings.is_none() {
            return;
        }
        let settings = self.settings.clone().unwrap_or_default();
        let ended_game = if settings.record_desktop {
            self.active_game = None;
            self.focused = false;
            None
        } else {
            let active_game = self.active_game.clone();
            self.observe_game(detect_game_activity(active_game.as_ref()))
        };

        if ended_game.is_some() && self.session.is_some() {
            if let Err(error) = self.stop_active_auto_output(true) {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
            }
            return;
        }

        if self
            .session
            .as_ref()
            .is_some_and(|session| active_session_should_stop(session, &settings))
        {
            if let Err(error) = self.stop_active_auto_output(true) {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
            }
            return;
        }

        if matches!(self.mode, RecordingMode::Recording | RecordingMode::ReplayBuffer) {
            if let Err(error) = self.refresh_active_output_for_focus() {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
            }
            return;
        }

        if settings.enabled
            && self.mode == RecordingMode::Idle
            && (settings.record_desktop || self.active_game.is_some())
        {
            let start = match settings.trigger_mode {
                RecordingTriggerMode::ReplayBuffer => self.start_replay_buffer(),
                RecordingTriggerMode::Session => self.start_session_recording(),
            };
            if let Err(error) = start {
                self.last_error = Some(error.clone());
                let status = self.status();
                emit_event(RecordingEvent::Error { error, status });
            }
        }
    }

    fn start_session_recording(&mut self) -> Result<(), String> {
        let settings = self.settings.clone().unwrap_or_default();
        let game = self
            .active_game
            .clone()
            .ok_or_else(|| "No detected game is available for session recording.".to_string())?;
        let output_folder = self.current_output_folder();
        let filename = saved_recording_path(&output_folder, "Sessions", Some(&game.game));
        let capture = self.new_capture(
            &settings,
            Some(&game),
            RecordingTriggerMode::Session,
            filename.to_string_lossy().into_owned(),
        );
        let session =
            self.start_file_output(&settings, Some(&game), ActiveOutputKind::Session, capture)?;
        self.mode = RecordingMode::Recording;
        self.session = Some(session);
        self.last_capture = None;
        self.last_error = None;
        let status = self.status();
        emit_event(RecordingEvent::Status { status });
        Ok(())
    }

    fn stop_active_file_output(&mut self) -> Result<RecordingCapture, String> {
        let Some(session) = self.session.take() else {
            self.mode = RecordingMode::Idle;
            return Err("Recording state was lost.".to_string());
        };
        let mut capture = session.capture.clone();
        let started_at = session.started_at;
        let total_paused = session_total_paused(&session);
        unsafe {
            self.stop_output(session)?;
        }
        self.mode = RecordingMode::Idle;
        capture.size_bytes = fs::metadata(&capture.filename)
            .ok()
            .map(|metadata| metadata.len());
        capture.duration_ms = session_duration_ms(started_at, total_paused);
        self.last_capture = Some(capture.clone());
        self.last_error = None;
        Ok(capture)
    }

    fn stop_active_auto_output(&mut self, emit_file_capture: bool) -> Result<(), String> {
        let Some(kind) = self.session.as_ref().map(|session| session.kind) else {
            self.mode = RecordingMode::Idle;
            return Ok(());
        };

        match kind {
            ActiveOutputKind::ReplayBuffer => self.stop_active_replay_buffer(),
            ActiveOutputKind::Session => {
                let capture = self.stop_active_file_output()?;
                if emit_file_capture {
                    let status = self.status();
                    emit_event(RecordingEvent::CaptureReady { capture, status });
                } else {
                    let status = self.status();
                    emit_event(RecordingEvent::Status { status });
                }
                Ok(())
            }
        }
    }

    fn refresh_active_output_for_focus(&mut self) -> Result<(), String> {
        self.refresh_active_pause()?;
        self.refresh_active_source()
    }

    fn refresh_active_pause(&mut self) -> Result<(), String> {
        let settings = self.settings.clone().unwrap_or_default();
        let should_pause = should_pause_for_focus(&settings, self.active_game.as_ref(), self.focused);

        let Some(session) = self.session.as_mut() else {
            return Ok(());
        };
        if session.paused == should_pause {
            return Ok(());
        }
        if !session.can_pause {
            return Ok(());
        }

        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
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

        let status = self.status();
        emit_event(RecordingEvent::Status { status });
        Ok(())
    }

    fn refresh_active_source(&mut self) -> Result<(), String> {
        let settings = self.settings.clone().unwrap_or_default();
        let desired = source_kind_for_focus(&settings, self.focused);
        let Some(current_kind) = self.session.as_ref().map(|session| session.source_kind) else {
            return Ok(());
        };
        if current_kind == desired {
            return Ok(());
        }

        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
        let game = self.active_game.clone();
        let base_dimensions = self
            .session
            .as_ref()
            .map(|session| session.video_config.base)
            .unwrap_or_else(|| obs_video_config(&settings, game.as_ref(), desired).base);
        let new_graph = unsafe { create_video_graph(obs, game.as_ref(), desired, base_dimensions)? };
        let old_graph = {
            let session = self.session.as_mut().expect("session exists");
            let old_graph = session.video_graph;
            session.video_graph = new_graph;
            session.source_kind = desired;
            session.capture.source = recording_source_from_kind(desired);
            old_graph
        };

        unsafe {
            (obs.obs_set_output_source)(0, new_graph.output_source);
            release_video_graph(obs, old_graph);
        }
        let status = self.status();
        emit_event(RecordingEvent::Status { status });
        Ok(())
    }

}
