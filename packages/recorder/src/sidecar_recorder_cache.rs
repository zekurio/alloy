impl Recorder {
    fn action_error(&mut self, error: &str) -> RecordingActionResult {
        RecordingActionResult {
            ok: false,
            status: self.status(),
            capture: None,
            error: Some(error.to_string()),
        }
    }

    fn available_codecs(&self, settings: &RecordingSettings) -> Vec<RecordingCodec> {
        let caps = self.codec_caps.clone().unwrap_or_default();
        match settings.encoder {
            RecordingEncoder::Hardware => caps
                .hardware
                .into_iter()
                .filter(|codec| {
                    codec_allowed_for_gpu_label(
                        codec,
                        selected_gpu_label(settings, &self.cached_gpus),
                    )
                })
                .collect(),
            RecordingEncoder::Software => {
                if caps.software_h264 {
                    vec![RecordingCodec::H264]
                } else {
                    Vec::new()
                }
            }
        }
    }

    /// Keeps `codec_caps` current so `status()` reports supported codecs even
    /// when recording is disabled. While OBS is up for an active recording the
    /// capabilities are already known; otherwise OBS is spun up briefly to probe
    /// the encoders and torn back down. The result is cached per GPU adapter +
    /// runtime so this only re-probes when the relevant inputs change.
    fn refresh_codec_capabilities(&mut self) {
        let Some(settings) = self.settings.clone() else {
            return;
        };
        let key = (
            gpu_adapter(&settings),
            selected_gpu_label(&settings, &self.cached_gpus).map(str::to_string),
            self.obs_runtime_dir.clone(),
        );
        let cached = self
            .codec_caps
            .take()
            .filter(|_| self.codec_caps_key.as_ref() == Some(&key));

        if self.obs.is_some() {
            let live = CodecCaps {
                hardware: self.available_codecs.clone(),
                software_h264: has_software_h264_encoder(&self.available_encoders),
            };
            // Encoder registration can transiently fail while the GPU is busy
            // (AMD's AMF helper probe under gaming load), so a codec that ever
            // probed fine on this adapter stays supported instead of flapping
            // to unsupported in the settings UI.
            self.codec_caps = Some(match cached {
                Some(cached) => merge_codec_caps(cached, live),
                None => live,
            });
            self.codec_caps_key = Some(key);
            return;
        }

        if cached.is_some() {
            self.codec_caps = cached;
            return;
        }

        if self.codec_caps_failed_probe.as_ref().is_some_and(
            |(failed_key, failed_at)| {
                failed_key == &key && failed_at.elapsed() < CODEC_PROBE_RETRY_COOLDOWN
            },
        ) {
            return;
        }

        match self.probe_codec_capabilities(&settings) {
            Ok(caps) => {
                self.codec_caps = Some(caps);
                self.codec_caps_key = Some(key);
                self.codec_caps_failed_probe = None;
            }
            Err(error) => {
                eprintln!("[{SIDE_CAR_NAME}] codec capability probe failed: {error}");
                self.codec_caps_failed_probe = Some((key, Instant::now()));
            }
        }
    }

    /// Whether `codec_caps` already reflect the current adapter + runtime.
    fn codec_caps_current(&self) -> bool {
        let Some(settings) = self.settings.as_ref() else {
            return true;
        };
        self.codec_caps.is_some()
            && self
                .codec_caps_key
                .as_ref()
                .is_some_and(|(adapter, gpu_label, runtime)| {
                    *adapter == gpu_adapter(settings)
                        && gpu_label.as_deref()
                            == selected_gpu_label(settings, &self.cached_gpus)
                        && runtime == &self.obs_runtime_dir
                })
    }

    /// Briefly initializes OBS on a default canvas to enumerate the available
    /// video encoders, then shuts it back down. Used only when no recording is
    /// active; an active recording already keeps OBS (and the encoder list) up.
    fn probe_codec_capabilities(&self, settings: &RecordingSettings) -> Result<CodecCaps, String> {
        let video_config = ObsVideoConfig {
            base: DEFAULT_VIDEO_DIMENSIONS,
            output: DEFAULT_VIDEO_DIMENSIONS,
            fps: 60,
            hdr_enabled: false,
        };
        let obs = LibObs::load(self.obs_runtime_dir.as_deref())?;
        let caps = unsafe {
            obs.start(
                self.obs_runtime_dir.as_deref(),
                video_config,
                gpu_adapter(settings),
            )?;
            let encoders = obs.enumerate_encoders();
            let hardware_settings = RecordingSettings {
                encoder: RecordingEncoder::Hardware,
                ..settings.clone()
            };
            let caps = CodecCaps {
                hardware: available_video_codecs(
                    &obs,
                    &hardware_settings,
                    &encoders,
                    selected_gpu_label(settings, &self.cached_gpus),
                ),
                software_h264: has_software_h264_encoder(&encoders),
            };
            obs.shutdown();
            caps
        };
        Ok(caps)
    }

    /// Refresh the hardware and audio discovery caches that `status()` reads.
    /// Called from the recorder thread (tick/configure) so `status()` stays
    /// cheap enough to answer from a snapshot without touching the platform.
    fn refresh_discovery_caches(&mut self) {
        self.refresh_gpu_cache();
        match self.settings.as_ref().map(|settings| &settings.audio_mode) {
            Some(RecordingAudioMode::Applications) => {
                self.refresh_audio_application_cache();
                // Input devices (microphones) stay manageable in applications
                // mode, so keep their list current alongside the app streams.
                self.refresh_audio_device_cache();
            }
            Some(RecordingAudioMode::Devices) | None => self.refresh_audio_device_cache(),
        }
    }

    fn refresh_gpu_cache(&mut self) {
        if self.should_refresh_idle_cache(self.cached_gpus_at, HARDWARE_DISCOVERY_CACHE_TTL) {
            self.cached_gpus = platform_gpus();
            self.cached_gpus_at = Some(Instant::now());
        }
    }

    fn refresh_audio_device_cache(&mut self) {
        if self.should_refresh_idle_cache(
            self.cached_audio_devices_at,
            HARDWARE_DISCOVERY_CACHE_TTL,
        ) {
            let mut devices = default_audio_devices();
            devices.extend(platform_audio_devices());
            self.cached_audio_devices = dedupe_audio_devices(devices);
            self.cached_audio_devices_at = Some(Instant::now());
        }
    }

    fn refresh_audio_application_cache(&mut self) {
        let game_key = self.active_game.as_ref().map(|game| game.window_key.clone());
        let stale = cache_expired(
            self.cached_audio_applications_at,
            AUDIO_APPLICATION_DISCOVERY_CACHE_TTL,
        ) || self.cached_audio_applications_game_key != game_key;
        // Refreshed even while recording: the settings UI must list apps that
        // started (or joined a voice call) mid-session, and the enumeration is
        // cheap next to the detection work each tick already does.
        if stale {
            let mut applications: Vec<_> = available_audio_applications(self.active_game.as_ref())
                .into_values()
                .collect();
            applications.sort_by(|a, b| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
                    .then_with(|| a.id.cmp(&b.id))
            });
            self.cached_audio_applications = applications;
            self.cached_audio_applications_at = Some(Instant::now());
            self.cached_audio_applications_game_key = game_key;
        }
    }

    fn should_refresh_idle_cache(&self, last_refresh: Option<Instant>, ttl: Duration) -> bool {
        last_refresh.is_none()
            || (self.current_mode() == RecordingMode::Idle && cache_expired(last_refresh, ttl))
    }

    fn current_mode(&self) -> RecordingMode {
        if self.replay_session.is_some() {
            RecordingMode::ReplayBuffer
        } else {
            RecordingMode::Idle
        }
    }

    fn capture_owner_session(&self) -> Option<&ActiveSession> {
        self.replay_session
            .as_ref()
            .filter(|session| session.owns_capture)
    }

    fn has_active_outputs(&self) -> bool {
        self.replay_session.is_some()
    }
}
fn active_session_should_stop(session: &ActiveSession, settings: &RecordingSettings) -> bool {
    match session.kind {
        ActiveOutputKind::ReplayBuffer => !settings.enabled,
    }
}

/// Settings whose change requires tearing down active outputs. Allow/deny game
/// list edits are intentionally absent: the tick loop already ends sessions
/// whose active game became disallowed, so list edits never interrupt an
/// unrelated active recording.
fn active_settings_require_restart(
    current: &RecordingSettings,
    next: &RecordingSettings,
) -> bool {
    current.audio_mode != next.audio_mode
        || current.audio_devices != next.audio_devices
        || current.audio_applications != next.audio_applications
        || current.capture_mode != next.capture_mode
        || current.selected_display_id != next.selected_display_id
        || current.encoder != next.encoder
        || current.gpu != next.gpu
        || current.codec != next.codec
        || effective_quality(current) != effective_quality(next)
        || current.replay_buffer_seconds != next.replay_buffer_seconds
        || current.buffer_storage != next.buffer_storage
}

fn cache_expired(last_refresh: Option<Instant>, ttl: Duration) -> bool {
    last_refresh.is_none_or(|last_refresh| last_refresh.elapsed() >= ttl)
}

/// Union of cached and freshly observed codec capabilities, in canonical
/// codec order.
fn merge_codec_caps(cached: CodecCaps, live: CodecCaps) -> CodecCaps {
    let mut hardware = live.hardware;
    for codec in cached.hardware {
        if !hardware.contains(&codec) {
            hardware.push(codec);
        }
    }
    hardware.sort_by_key(|codec| match codec {
        RecordingCodec::H264 => 0,
        RecordingCodec::Hevc => 1,
        RecordingCodec::Av1 => 2,
    });
    CodecCaps {
        hardware,
        software_h264: cached.software_h264 || live.software_h264,
    }
}
