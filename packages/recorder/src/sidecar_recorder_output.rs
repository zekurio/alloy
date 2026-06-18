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
            (
                session.video_graph,
                session.video_config,
                session.audio_sources.clone(),
                session.source_kind,
            )
        });
        let video_config = shared_capture
            .as_ref()
            .map(|(_, video_config, _, _)| *video_config)
            .unwrap_or(self.ensure_obs_for_source(settings, game, source_kind)?);
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
            codec: video_codec,
            ..settings.clone()
        };
        let audio_encoder_id = choose_audio_encoder(&self.available_encoders)
            .ok_or_else(|| "No OBS audio encoder is available.".to_string())?;

        let output_quality = effective_quality_for_base(settings, video_config.base);
        let mut capture = capture;
        let owns_capture = shared_capture.is_none();
        let (mut video_graph, audio_sources) =
            if let Some((video_graph, _video_config, audio_sources, shared_kind)) = shared_capture {
                source_kind = shared_kind;
                capture.source = recording_source_from_kind(source_kind);
                (video_graph, audio_sources)
            } else {
                let video_graph =
                    unsafe { create_video_graph(obs, settings, game, source_kind, video_config.base)? };
                unsafe {
                    (obs.obs_set_output_source)(0, video_graph.output_source);
                }

                let audio_sources = match unsafe { create_audio_sources(obs, settings, game) } {
                    Ok(audio_sources) => audio_sources,
                    Err(error) => {
                        unsafe {
                            release_output_graph(
                                obs,
                                ptr::null_mut(),
                                ptr::null_mut(),
                                ptr::null_mut(),
                                video_graph,
                                Vec::new(),
                            );
                        }
                        return Err(error);
                    }
                };
                (video_graph, audio_sources)
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
                        if owns_capture { audio_sources } else { Vec::new() },
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
                        if owns_capture { audio_sources } else { Vec::new() },
                    );
                }
                return Err(error);
            }
        };
        unsafe { (obs.obs_encoder_set_audio)(audio_encoder, (obs.obs_get_audio)()) };

        if let Err(error) = unsafe {
            Self::ensure_game_capture_ready_or_fallback(
                obs,
                settings,
                game,
                video_config.base,
                &mut source_kind,
                &mut video_graph,
                &mut capture,
            )
        } {
            unsafe {
                release_output_graph(
                    obs,
                    ptr::null_mut(),
                    video_encoder,
                    audio_encoder,
                    video_graph,
                    if owns_capture { audio_sources } else { Vec::new() },
                );
            }
            return Err(error);
        }

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
                        if owns_capture { audio_sources } else { Vec::new() },
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
                        if owns_capture { audio_sources } else { Vec::new() },
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
            let error = output_last_error(obs, output)
                .unwrap_or_else(|| "OBS output failed to start.".to_string());
            unsafe {
                release_output_graph(
                    obs,
                    output,
                    video_encoder,
                    audio_encoder,
                    video_graph,
                    if owns_capture { audio_sources } else { Vec::new() },
                );
            }
            return Err(error);
        }

        let can_pause = unsafe { (obs.obs_output_can_pause)(output) };
        Ok(ActiveSession {
            kind,
            output,
            video_encoder,
            audio_encoder,
            video_graph,
            video_config,
            audio_sources,
            source_kind,
            output_config,
            capture,
            can_pause,
            paused: false,
            owns_capture,
        })
    }

    unsafe fn ensure_game_capture_ready_or_fallback(
        obs: &LibObs,
        settings: &RecordingSettings,
        game: Option<&DetectedGame>,
        base_dimensions: VideoDimensions,
        source_kind: &mut OutputSourceKind,
        video_graph: &mut VideoGraph,
        capture: &mut RecordingCapture,
    ) -> Result<(), String> {
        if *source_kind != OutputSourceKind::Game {
            return Ok(());
        }

        if let Err(error) = wait_for_game_capture_hook(obs, video_graph.source, game) {
            if game.is_some_and(|game| !is_detected_game_alive(game)) {
                return Err(error);
            }

            eprintln!("[{SIDE_CAR_NAME}] {error} Attempting display capture fallback.");
            let fallback_kind = OutputSourceKind::Display;
            let fallback_graph = create_video_graph(obs, settings, game, fallback_kind, base_dimensions)
                .map_err(|fallback_error| {
                    format!("{error} Display capture fallback also failed: {fallback_error}")
                })?;

            (obs.obs_set_output_source)(0, ptr::null_mut());
            release_video_graph(obs, *video_graph);
            *source_kind = fallback_kind;
            *video_graph = fallback_graph;
            (obs.obs_set_output_source)(0, video_graph.output_source);
            capture.source = recording_source_from_kind(*source_kind);
            eprintln!(
                "[{SIDE_CAR_NAME}] display capture fallback is active for {}.",
                game_capture_target_name(game)
            );
        }

        Ok(())
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

        let deadline = SystemTime::now() + Duration::from_secs(8);
        while (obs.obs_output_active)(session.output) {
            if SystemTime::now() >= deadline {
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
                session.audio_sources,
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
        let saved_after = SystemTime::now()
            .checked_sub(Duration::from_secs(2))
            .unwrap_or(UNIX_EPOCH);
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
