#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GameCaptureHookRefresh {
    Continue,
    TargetClosed,
}

impl Recorder {
    fn start_output(
        &mut self,
        settings: &RecordingSettings,
        game: Option<&DetectedGame>,
        kind: ActiveOutputKind,
        capture: RecordingCapture,
        output_config: OutputConfig,
    ) -> Result<ActiveSession, String> {
        let mut source_kind = source_kind(settings, game);
        let shared_capture = self.capture_owner_session().map(|session| {
            (session.video_config, session.source_kind)
        });
        let video_config = match shared_capture {
            Some((video_config, _)) => video_config,
            None => self.ensure_obs_for_source(settings, game, source_kind)?,
        };
        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
        let (video_encoder_id, video_codec) = choose_video_encoder(
            settings,
            &self.available_encoders,
            selected_gpu_label(settings, &self.cached_gpus),
        )
        .ok_or_else(|| unavailable_video_encoder_message(settings))?;
        if video_codec != settings.codec {
            eprintln!(
                "[{SIDE_CAR_NAME}] no {} encoder is available in this OBS instance; recording with {} instead.",
                codec_label(&settings.codec),
                codec_label(&video_codec),
            );
        }
        let encoder_settings = RecordingSettings {
            codec: video_codec.clone(),
            ..settings.clone()
        };
        let audio_encoder_id = choose_audio_encoder(&self.available_encoders)
            .ok_or_else(|| "No OBS audio encoder is available.".to_string())?;

        let output_quality = effective_quality_for_base(settings, video_config.base);
        let mut capture = capture;
        let owns_capture = shared_capture.is_none();
        let (video_graph, audio_graph) =
            if let Some((_video_config, shared_kind)) = shared_capture {
                source_kind = shared_kind;
                capture.source = recording_source_from_kind(source_kind);
                (
                    VideoGraph {
                        scene: ptr::null_mut(),
                        source: ptr::null_mut(),
                        output_source: ptr::null_mut(),
                        source_kind,
                    },
                    empty_audio_graph(),
                )
            } else {
                // SAFETY: OBS is initialized above and this owner session is
                // creating sources for the same libobs instance.
                let video_graph = unsafe {
                    create_video_graph(obs, settings, game, source_kind, video_config.base)?
                };
                unsafe {
                    (obs.obs_set_output_source)(0, video_graph.output_source);
                }

                let audio_graph = match unsafe { create_audio_graph(obs, settings, game) } {
                    Ok(audio_graph) => audio_graph,
                    Err(error) => {
                        unsafe {
                            release_output_graph(
                                obs,
                                ptr::null_mut(),
                                ptr::null_mut(),
                                ptr::null_mut(),
                                video_graph,
                                empty_audio_graph(),
                            );
                        }
                        return Err(error);
                    }
                };
                (video_graph, audio_graph)
            };

        let video_settings = unsafe { obs.create_data() };
        let video_encoder = unsafe {
            let result = (|| {
                configure_video_encoder(obs, video_settings, &encoder_settings, &output_quality)?;
                create_video_encoder(obs, &video_encoder_id, video_settings)
                    .map_err(|_| unavailable_video_encoder_message(&encoder_settings))
            })();
            obs.release_data(video_settings);
            result
        };
        let video_encoder = match video_encoder {
            Ok(video_encoder) => video_encoder,
            Err(error) => {
                unsafe {
                    release_output_graph(
                        obs,
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        video_graph,
                        if owns_capture {
                            audio_graph
                        } else {
                            empty_audio_graph()
                        },
                    );
                }
                return Err(error);
            }
        };
        unsafe { (obs.obs_encoder_set_video)(video_encoder, (obs.obs_get_video)()) };

        let audio_settings = unsafe { obs.create_data() };
        let audio_encoder = unsafe {
            let result = (|| {
                obs.set_int(audio_settings, "bitrate", 160)?;
                create_audio_encoder(obs, &audio_encoder_id, audio_settings)
            })();
            obs.release_data(audio_settings);
            result
        };
        let audio_encoder = match audio_encoder {
            Ok(audio_encoder) => audio_encoder,
            Err(error) => {
                unsafe {
                    release_output_graph(
                        obs,
                        ptr::null_mut(),
                        video_encoder,
                        ptr::null_mut(),
                        video_graph,
                        if owns_capture {
                            audio_graph
                        } else {
                            empty_audio_graph()
                        },
                    );
                }
                return Err(error);
            }
        };
        unsafe { (obs.obs_encoder_set_audio)(audio_encoder, (obs.obs_get_audio)()) };

        let output_settings = unsafe { obs.create_data() };
        let output_id = match &output_config {
            OutputConfig::ReplayBuffer {
                scratch_directory,
                output_directory: _,
                storage,
                replay_seconds: _,
            } => {
                if storage == &RecordingBufferStorage::Disk {
                    let path = scratch_directory.join(format!(
                        "{DISK_REPLAY_PREFIX}{}.mp4",
                        timestamp_file_slug()
                    ));
                    let result = unsafe {
                        obs.set_string(output_settings, "path", &path.to_string_lossy())?;
                        obs.set_string(output_settings, "muxer_settings", "movflags=+faststart")?;
                        obs.set_bool(output_settings, "split_file", true)?;
                        obs.set_int(
                            output_settings,
                            "max_time_sec",
                            i64::from(disk_replay_segment_seconds(
                                settings.replay_buffer_seconds,
                            )),
                        )?;
                        obs.set_int(output_settings, "max_size_mb", 0)
                    };
                    result.map(|_| "ffmpeg_muxer")
                } else {
                    let result = unsafe {
                        obs.set_string(
                            output_settings,
                            "directory",
                            &scratch_directory.to_string_lossy(),
                        )?;
                        obs.set_string(
                            output_settings,
                            "format",
                            "alloy-replay-%CCYY%MM%DD-%hh%mm%ss",
                        )?;
                        obs.set_string(output_settings, "extension", "mp4")?;
                        obs.set_string(output_settings, "muxer_settings", "movflags=+faststart")?;
                        obs.set_int(
                            output_settings,
                            "max_time_sec",
                            i64::from(settings.replay_buffer_seconds),
                        )?;
                        obs.set_int(
                            output_settings,
                            "max_size_mb",
                            i64::from(estimated_replay_buffer_mb(
                                settings,
                                &output_quality,
                            )),
                        )
                    };
                    result.map(|_| "replay_buffer")
                }
            }
        };
        let output_id = match output_id {
            Ok(output_id) => output_id,
            Err(error) => {
                unsafe {
                    obs.release_data(output_settings);
                    release_output_graph(
                        obs,
                        ptr::null_mut(),
                        video_encoder,
                        audio_encoder,
                        video_graph,
                        if owns_capture {
                            audio_graph
                        } else {
                            empty_audio_graph()
                        },
                    );
                }
                return Err(error);
            }
        };
        let output = match unsafe { create_output(obs, output_id, output_settings) } {
            Ok(output) => output,
            Err(error) => {
                unsafe {
                    obs.release_data(output_settings);
                    release_output_graph(
                        obs,
                        ptr::null_mut(),
                        video_encoder,
                        audio_encoder,
                        video_graph,
                        if owns_capture {
                            audio_graph
                        } else {
                            empty_audio_graph()
                        },
                    );
                }
                return Err(error);
            }
        };
        unsafe {
            (obs.obs_output_update)(output, output_settings);
            obs.release_data(output_settings);
            (obs.obs_output_set_video_encoder)(output, video_encoder);
            (obs.obs_output_set_audio_encoder)(output, audio_encoder, 0);
        }

        if unsafe { !(obs.obs_output_start)(output) } {
            // SAFETY: `output` was just created by this libobs instance and has
            // not been released yet.
            let error = unsafe { output_last_error(obs, output) }
                .unwrap_or_else(|| "OBS output failed to start.".to_string());
            unsafe {
                release_output_graph(
                    obs,
                    output,
                    video_encoder,
                    audio_encoder,
                    video_graph,
                    if owns_capture {
                        audio_graph
                    } else {
                        empty_audio_graph()
                    },
                );
            }
            return Err(error);
        }

        let can_pause = unsafe { (obs.obs_output_can_pause)(output) };
        let game_capture_hook_wait = (owns_capture && source_kind == OutputSourceKind::Game)
            .then(|| start_game_capture_hook_wait(game));
        Ok(ActiveSession {
            kind,
            output,
            video_encoder,
            audio_encoder,
            video_encoder_id,
            audio_encoder_id,
            video_codec,
            video_graph,
            video_config,
            audio_graph,
            source_kind,
            output_config,
            capture,
            target_game_key: game.map(|game| game.window_key.clone()),
            game_content_expires_at: None,
            game_capture_hook_wait,
            can_pause,
            paused: false,
            owns_capture,
        })
    }

    fn refresh_game_capture_hook(&mut self) -> Result<GameCaptureHookRefresh, String> {
        let Some(session) = self.replay_session.as_ref() else {
            return Ok(GameCaptureHookRefresh::Continue);
        };
        let Some(wait) = session.game_capture_hook_wait.as_ref() else {
            return Ok(GameCaptureHookRefresh::Continue);
        };
        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
        let poll = game_capture_hook_poll(
            wait,
            Instant::now(),
            unsafe { game_capture_source_hooked(obs, session.video_graph.source) },
            self.active_game
                .as_ref()
                .is_some_and(is_detected_game_alive),
        );
        match poll {
            GameCaptureHookPoll::Ready => {
                if let Some(session) = self.replay_session.as_mut() {
                    session.game_capture_hook_wait = None;
                }
                eprintln!(
                    "[{SIDE_CAR_NAME}] OBS game capture hook ready for {}.",
                    game_capture_target_name(self.active_game.as_ref())
                );
                return Ok(GameCaptureHookRefresh::Continue);
            }
            GameCaptureHookPoll::Closed => {
                return Ok(GameCaptureHookRefresh::TargetClosed);
            }
            GameCaptureHookPoll::Waiting(retry_attempt) => {
                if retry_attempt <= wait.last_logged_attempt {
                    return Ok(GameCaptureHookRefresh::Continue);
                }
                if let Some(wait) = self
                    .replay_session
                    .as_mut()
                    .and_then(|session| session.game_capture_hook_wait.as_mut())
                {
                    wait.last_logged_attempt = retry_attempt;
                }
                eprintln!(
                    "[{SIDE_CAR_NAME}] waiting for successful graphics hook for {}... retry attempt #{retry_attempt}",
                    game_capture_target_name(self.active_game.as_ref())
                );
                return Ok(GameCaptureHookRefresh::Continue);
            }
            GameCaptureHookPoll::TimedOut => {}
        }

        let settings = self.settings.as_ref().cloned().unwrap_or_default();
        let game = self.active_game.clone();
        let session = self
            .replay_session
            .as_mut()
            .ok_or_else(|| "Replay session is not active.".to_string())?;
        let error = game_capture_hook_timeout_message(game.as_ref());
        eprintln!("[{SIDE_CAR_NAME}] {error} Attempting display capture fallback.");
        let fallback_graph = match unsafe {
            create_video_graph(
                obs,
                &settings,
                game.as_ref(),
                OutputSourceKind::Display,
                session.video_config.base,
            )
        } {
            Ok(graph) => graph,
            Err(fallback_error) => {
                session.game_capture_hook_wait = Some(GameCaptureHookWait {
                    started_at: Instant::now(),
                    last_logged_attempt: 0,
                });
                return Err(format!(
                    "{error} Display capture fallback also failed: {fallback_error}"
                ));
            }
        };

        unsafe {
            // `obs_set_output_source` retains the new scene and releases the
            // previous one, so switch channels before releasing our graph.
            (obs.obs_set_output_source)(0, fallback_graph.output_source);
            let previous_graph = std::mem::replace(&mut session.video_graph, fallback_graph);
            release_video_graph(obs, previous_graph);
        }
        session.source_kind = OutputSourceKind::Display;
        session.capture.source = recording_source_from_kind(session.source_kind);
        session.game_capture_hook_wait = None;
        eprintln!(
            "[{SIDE_CAR_NAME}] display capture fallback is active for {}.",
            game_capture_target_name(game.as_ref())
        );
        Ok(GameCaptureHookRefresh::Continue)
    }

    unsafe fn stop_output(&self, session: ActiveSession) -> Result<(), String> {
        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
        if session.paused && session.can_pause {
            (obs.obs_output_pause)(session.output, false);
        }
        (obs.obs_output_stop)(session.output);

        let deadline = Instant::now() + Duration::from_secs(8);
        while (obs.obs_output_active)(session.output) {
            if Instant::now() >= deadline {
                (obs.obs_output_force_stop)(session.output);
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }

        if session.owns_capture {
            release_output_graph(
                obs,
                session.output,
                session.video_encoder,
                session.audio_encoder,
                session.video_graph,
                session.audio_graph,
            );
        } else {
            release_output_only(obs, session.output, session.video_encoder, session.audio_encoder);
        }
        Ok(())
    }

    unsafe fn save_replay(
        &self,
        session: &ActiveSession,
        duration_seconds: u32,
    ) -> Result<SavedReplayClip, String> {
        if session.kind != ActiveOutputKind::ReplayBuffer {
            return Err("Current OBS output is not a replay buffer.".to_string());
        }
        let OutputConfig::ReplayBuffer {
            scratch_directory,
            output_directory,
            storage,
            replay_seconds,
        } = &session.output_config;
        if storage == &RecordingBufferStorage::Disk {
            return self.save_disk_replay(
                session,
                scratch_directory,
                output_directory,
                duration_seconds.min(*replay_seconds),
            );
        }
        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
        let handler = (obs.obs_output_get_proc_handler)(session.output);
        if handler.is_null() {
            return Err("OBS replay buffer has no procedure handler.".to_string());
        }

        let previous_replay_path = unsafe { last_replay_path(obs, handler) };
        let save_name = CString::new("save").expect("static string has no nul byte");
        let mut save_data = CallData::default();
        let saved_after = SystemTime::now();
        if !(obs.proc_handler_call)(handler, save_name.as_ptr(), &mut save_data) {
            free_calldata(obs, &mut save_data);
            return Err("OBS replay buffer failed to save.".to_string());
        }
        free_calldata(obs, &mut save_data);

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Some(path) = unsafe { last_replay_path(obs, handler) } {
                let source = Path::new(&path);
                if previous_replay_path.as_deref() != Some(path.as_str())
                    || replay_file_modified_at_or_after(source, saved_after)
                {
                    return move_saved_replay_to_output(
                        &path,
                        output_directory,
                        session.capture.game.as_ref(),
                        duration_seconds,
                        *replay_seconds,
                    );
                }
            }
            thread::sleep(Duration::from_millis(100));
        }

        if let Some(replay) = newest_memory_replay_file(scratch_directory, saved_after) {
            return move_saved_replay_to_output(
                &replay.path.to_string_lossy(),
                output_directory,
                session.capture.game.as_ref(),
                duration_seconds,
                *replay_seconds,
            );
        }

        Err("OBS saved replay, but did not report a file path.".to_string())
    }

    unsafe fn save_disk_replay(
        &self,
        session: &ActiveSession,
        scratch_directory: &Path,
        output_directory: &Path,
        replay_seconds: u32,
    ) -> Result<SavedReplayClip, String> {
        let segment = newest_disk_replay_segment(scratch_directory)
            .ok_or_else(|| "Disk replay buffer has not created a segment yet.".to_string())?;
        let obs = self
            .obs
            .as_ref()
            .ok_or_else(|| "OBS is not initialized.".to_string())?;
        let handler = (obs.obs_output_get_proc_handler)(session.output);
        if handler.is_null() {
            return Err("OBS disk replay output has no procedure handler.".to_string());
        }

        let split_file = CString::new("split_file").expect("static string has no nul byte");
        let mut data = CallData::default();
        if !(obs.proc_handler_call)(handler, split_file.as_ptr(), &mut data) {
            free_calldata(obs, &mut data);
            return Err("OBS disk replay buffer failed to split.".to_string());
        }
        free_calldata(obs, &mut data);

        let saved = save_disk_replay_clip(
            scratch_directory,
            output_directory,
            session.capture.game.as_ref(),
            replay_seconds,
            &segment.path,
        )?;
        cleanup_disk_replay_segments(&session.output_config, Some(&saved.path));
        Ok(saved)
    }
}

unsafe fn last_replay_path(obs: &LibObs, handler: *mut ProcHandler) -> Option<String> {
    let mut data = CallData::default();
    let get_last_replay = CString::new("get_last_replay").expect("static string has no nul byte");
    if !(obs.proc_handler_call)(handler, get_last_replay.as_ptr(), &mut data) {
        free_calldata(obs, &mut data);
        return None;
    }

    let key = CString::new("path").expect("static string has no nul byte");
    let mut raw_path: *const c_char = ptr::null();
    let path = if (obs.calldata_get_string)(&data, key.as_ptr(), &mut raw_path)
        && !raw_path.is_null()
    {
        let path = CStr::from_ptr(raw_path).to_string_lossy().into_owned();
        (!path.is_empty()).then_some(path)
    } else {
        None
    };
    free_calldata(obs, &mut data);
    path
}
