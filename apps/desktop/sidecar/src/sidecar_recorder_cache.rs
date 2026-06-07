impl Recorder {
    fn action_error(&mut self, error: &str) -> RecordingActionResult {
        RecordingActionResult {
            ok: false,
            status: self.status(),
            capture: None,
            error: Some(error.to_string()),
        }
    }

    fn available_encoder_set(&self) -> HashSet<String> {
        self.available_encoders.iter().cloned().collect()
    }

    fn available_codecs(&self, settings: &RecordingSettings) -> Vec<RecordingCodec> {
        let codecs = match settings.encoder {
            RecordingEncoder::Hardware => self.available_codecs.clone(),
            RecordingEncoder::Software => {
                if self.available_encoder_set().contains("obs_x264") {
                    vec![RecordingCodec::H264]
                } else {
                    Vec::new()
                }
            }
        };

        codecs
    }

    fn available_gpus(&mut self) -> Vec<String> {
        if self.should_refresh_idle_cache(self.cached_gpus_at, HARDWARE_DISCOVERY_CACHE_TTL) {
            self.cached_gpus = platform_gpus();
            self.cached_gpus_at = Some(Instant::now());
        }
        self.cached_gpus.clone()
    }

    fn available_audio_devices(&mut self) -> Vec<RecordingAudioDeviceSelection> {
        if self.should_refresh_idle_cache(
            self.cached_audio_devices_at,
            HARDWARE_DISCOVERY_CACHE_TTL,
        ) {
            let mut devices = default_audio_devices();
            devices.extend(platform_audio_devices());
            self.cached_audio_devices = dedupe_audio_devices(devices);
            self.cached_audio_devices_at = Some(Instant::now());
        }
        self.cached_audio_devices.clone()
    }

    fn available_audio_applications(&mut self) -> Vec<RecordingAudioApplicationSelection> {
        let game_key = self.active_game.as_ref().map(|game| game.window_key.clone());
        let stale = cache_expired(
            self.cached_audio_applications_at,
            AUDIO_APPLICATION_DISCOVERY_CACHE_TTL,
        ) || self.cached_audio_applications_game_key != game_key;
        if (self.mode == RecordingMode::Idle || self.cached_audio_applications_at.is_none())
            && stale
        {
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
        self.cached_audio_applications.clone()
    }

    fn should_refresh_idle_cache(&self, last_refresh: Option<Instant>, ttl: Duration) -> bool {
        last_refresh.is_none()
            || (self.mode == RecordingMode::Idle && cache_expired(last_refresh, ttl))
    }
}
fn active_session_should_stop(session: &ActiveSession, settings: &RecordingSettings) -> bool {
    if !settings.enabled {
        return true;
    }

    match session.kind {
        ActiveOutputKind::ReplayBuffer => settings.trigger_mode != RecordingTriggerMode::ReplayBuffer,
        ActiveOutputKind::Session => settings.trigger_mode != RecordingTriggerMode::Session,
    }
}

fn active_settings_require_restart(
    current: &RecordingSettings,
    next: &RecordingSettings,
) -> bool {
    current.audio_mode != next.audio_mode
        || current.audio_devices != next.audio_devices
        || current.audio_applications != next.audio_applications
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
