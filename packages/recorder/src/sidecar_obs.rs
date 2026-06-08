unsafe fn load_symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
    let symbol: Symbol<T> = library.get(name).map_err(|error| {
        format!(
            "Missing libobs symbol {}: {error}",
            String::from_utf8_lossy(name)
        )
    })?;
    Ok(*symbol)
}

unsafe fn create_source(
    obs: &LibObs,
    id: &str,
    name: &str,
    settings: Option<*mut ObsData>,
) -> Result<*mut ObsSource, String> {
    let id = CString::new(id).map_err(|_| "OBS source id contained a nul byte.".to_string())?;
    let name =
        CString::new(name).map_err(|_| "OBS source name contained a nul byte.".to_string())?;
    let source = (obs.obs_source_create)(
        id.as_ptr(),
        name.as_ptr(),
        settings.unwrap_or(ptr::null_mut()),
        ptr::null_mut(),
    );
    if source.is_null() {
        return Err("Could not create OBS capture source.".to_string());
    }
    Ok(source)
}

unsafe fn create_video_encoder(
    obs: &LibObs,
    id: &str,
    settings: *mut ObsData,
) -> Result<*mut ObsEncoder, String> {
    let id =
        CString::new(id).map_err(|_| "OBS video encoder id contained a nul byte.".to_string())?;
    let name = CString::new("alloy_video_encoder").expect("static string has no nul byte");
    let encoder =
        (obs.obs_video_encoder_create)(id.as_ptr(), name.as_ptr(), settings, ptr::null_mut());
    if encoder.is_null() {
        return Err("Could not create OBS video encoder.".to_string());
    }
    Ok(encoder)
}

unsafe fn create_audio_encoder(
    obs: &LibObs,
    id: &str,
    settings: *mut ObsData,
) -> Result<*mut ObsEncoder, String> {
    let id =
        CString::new(id).map_err(|_| "OBS audio encoder id contained a nul byte.".to_string())?;
    let name = CString::new("alloy_audio_encoder").expect("static string has no nul byte");
    let encoder =
        (obs.obs_audio_encoder_create)(id.as_ptr(), name.as_ptr(), settings, 0, ptr::null_mut());
    if encoder.is_null() {
        return Err("Could not create OBS audio encoder.".to_string());
    }
    Ok(encoder)
}

unsafe fn create_output(
    obs: &LibObs,
    id: &str,
    settings: *mut ObsData,
) -> Result<*mut ObsOutput, String> {
    let id = CString::new(id).map_err(|_| "OBS output id contained a nul byte.".to_string())?;
    let name = CString::new("alloy_file_output").expect("static string has no nul byte");
    let output = (obs.obs_output_create)(id.as_ptr(), name.as_ptr(), settings, ptr::null_mut());
    if output.is_null() {
        return Err("Could not create OBS file output.".to_string());
    }
    Ok(output)
}

unsafe fn release_output_graph(
    obs: &LibObs,
    output: *mut ObsOutput,
    video_encoder: *mut ObsEncoder,
    audio_encoder: *mut ObsEncoder,
    video_graph: VideoGraph,
    audio_sources: Vec<*mut ObsSource>,
) {
    (obs.obs_set_output_source)(0, ptr::null_mut());
    for index in 0..MAX_AUDIO_SOURCES {
        (obs.obs_set_output_source)(audio_output_index(index), ptr::null_mut());
    }

    if !output.is_null() {
        (obs.obs_output_release)(output);
    }
    if !video_encoder.is_null() {
        (obs.obs_encoder_release)(video_encoder);
    }
    if !audio_encoder.is_null() {
        (obs.obs_encoder_release)(audio_encoder);
    }
    release_video_graph(obs, video_graph);
    release_audio_sources(obs, audio_sources);
}

unsafe fn release_video_graph(obs: &LibObs, graph: VideoGraph) {
    if !graph.scene.is_null() {
        (obs.obs_scene_release)(graph.scene);
    }
    if !graph.source.is_null() {
        (obs.obs_source_remove)(graph.source);
        (obs.obs_source_release)(graph.source);
    }
}

unsafe fn release_audio_sources(obs: &LibObs, audio_sources: Vec<*mut ObsSource>) {
    for index in 0..MAX_AUDIO_SOURCES {
        (obs.obs_set_output_source)(audio_output_index(index), ptr::null_mut());
    }
    for audio_source in audio_sources {
        if !audio_source.is_null() {
            (obs.obs_source_remove)(audio_source);
            (obs.obs_source_release)(audio_source);
        }
    }
}

fn audio_output_index(source_index: usize) -> u32 {
    u32::try_from(source_index + 1).unwrap_or(1)
}

unsafe fn configure_video_encoder(
    obs: &LibObs,
    data: *mut ObsData,
    settings: &RecordingSettings,
    quality: &EffectiveQuality,
) -> Result<(), String> {
    let bitrate = target_bitrate_kbps(quality);
    obs.set_string(data, "rate_control", "CBR")?;
    obs.set_string(data, "profile", "high")?;
    obs.set_string(
        data,
        "preset",
        if settings.encoder == RecordingEncoder::Software {
            "veryfast"
        } else {
            "quality"
        },
    )?;
    obs.set_int(data, "bitrate", i64::from(bitrate))?;
    obs.set_int(data, "keyint_sec", 2)?;
    obs.set_bool(data, "psycho_aq", true)?;
    Ok(())
}

fn choose_video_encoder(settings: &RecordingSettings, available: &HashSet<String>) -> Option<String> {
    video_encoder_candidates(&settings.encoder, &settings.codec)
        .into_iter()
        .find(|candidate| available.contains(*candidate))
        .map(str::to_string)
}

fn available_video_codecs(
    obs: &LibObs,
    settings: &RecordingSettings,
    available: &HashSet<String>,
) -> Vec<RecordingCodec> {
    [
        RecordingCodec::H264,
        RecordingCodec::Hevc,
        RecordingCodec::Av1,
    ]
    .into_iter()
    .filter(|codec| can_create_video_codec(obs, settings, available, codec))
    .collect()
}

fn can_create_video_codec(
    obs: &LibObs,
    settings: &RecordingSettings,
    available: &HashSet<String>,
    codec: &RecordingCodec,
) -> bool {
    let candidates = video_encoder_candidates(&settings.encoder, codec);
    if candidates.is_empty() {
        return false;
    }

    unsafe {
        for candidate in candidates {
            if !available.contains(candidate) {
                continue;
            }

            let probe_settings = RecordingSettings {
                codec: codec.clone(),
                ..settings.clone()
            };
            let data = obs.create_data();
            let result = (|| {
                let quality = effective_quality(&probe_settings);
                configure_video_encoder(obs, data, &probe_settings, &quality)?;
                create_video_encoder(obs, candidate, data)
            })();
            obs.release_data(data);

            if let Ok(encoder) = result {
                (obs.obs_encoder_release)(encoder);
                return true;
            }
        }
    }

    false
}

fn video_encoder_candidates(
    encoder: &RecordingEncoder,
    codec: &RecordingCodec,
) -> Vec<&'static str> {
    match (encoder, codec) {
        (RecordingEncoder::Software, RecordingCodec::H264) => vec!["obs_x264"],
        (RecordingEncoder::Software, _) => Vec::new(),
        (RecordingEncoder::Hardware, RecordingCodec::H264) => vec![
            "jim_nvenc",
            "obs_nvenc_h264_tex",
            "ffmpeg_nvenc",
            "h264_texture_amf",
            "amd_amf_h264",
            "obs_qsv11",
        ],
        (RecordingEncoder::Hardware, RecordingCodec::Hevc) => vec![
            "jim_hevc_nvenc",
            "obs_nvenc_hevc_tex",
            "ffmpeg_hevc_nvenc",
            "h265_texture_amf",
            "amd_amf_hevc",
            "obs_qsv11_hevc",
        ],
        (RecordingEncoder::Hardware, RecordingCodec::Av1) => vec![
            "jim_av1_nvenc",
            "obs_nvenc_av1_tex",
            "av1_texture_amf",
            "amd_amf_av1",
            "obs_qsv11_av1",
        ],
    }
}

fn unavailable_video_encoder_message(settings: &RecordingSettings) -> String {
    format!(
        "{} is not available for the selected {} encoder. Choose a supported codec or switch encoders.",
        codec_label(&settings.codec),
        encoder_label(&settings.encoder),
    )
}

fn codec_label(codec: &RecordingCodec) -> &'static str {
    match codec {
        RecordingCodec::H264 => "H.264",
        RecordingCodec::Hevc => "HEVC",
        RecordingCodec::Av1 => "AV1",
    }
}

fn encoder_label(encoder: &RecordingEncoder) -> &'static str {
    match encoder {
        RecordingEncoder::Hardware => "GPU",
        RecordingEncoder::Software => "CPU",
    }
}

fn choose_audio_encoder(available: &HashSet<String>) -> Option<String> {
    ["ffmpeg_aac", "CoreAudio_AAC", "libfdk_aac", "aac"]
        .into_iter()
        .find(|candidate| available.contains(*candidate))
        .map(str::to_string)
}

fn target_bitrate_kbps(quality: &EffectiveQuality) -> u32 {
    match &quality.bitrate {
        RecordingBitrate::Mbps(value) => value.parse::<u32>().unwrap_or(0).saturating_mul(1000),
        RecordingBitrate::Auto(value) if value != "auto" => {
            value.parse::<u32>().unwrap_or(0).saturating_mul(1000)
        }
        _ => match (quality.height, quality.fps) {
            (height, fps) if height >= 2160 && fps >= 60 => 55_000,
            (height, _) if height >= 2160 => 40_000,
            (height, fps) if height >= 1440 && fps >= 60 => 30_000,
            (height, _) if height >= 1440 => 22_000,
            (height, fps) if height >= 1080 && fps >= 60 => 18_000,
            (height, _) if height >= 1080 => 12_000,
            (_, fps) if fps >= 60 => 8_000,
            _ => 5_000,
        },
    }
}

fn estimated_replay_buffer_mb(settings: &RecordingSettings) -> u32 {
    let quality = effective_quality(settings);
    let video_kbps = target_bitrate_kbps(&quality);
    let audio_kbps = 320;
    let megabytes = u64::from(video_kbps.saturating_add(audio_kbps))
        .saturating_mul(u64::from(settings.replay_buffer_seconds))
        / 8_000;
    u32::try_from(megabytes.clamp(64, 16_384)).unwrap_or(16_384)
}

fn gpu_adapter(settings: &RecordingSettings) -> u32 {
    if settings.gpu == "auto" {
        return 0;
    }

    let value = settings
        .gpu
        .strip_prefix("adapter:")
        .unwrap_or(settings.gpu.as_str());
    let adapter = value.split(':').next().unwrap_or(value);
    adapter.parse::<u32>().unwrap_or(0)
}

unsafe fn create_video_source(
    obs: &LibObs,
    game: Option<&DetectedGame>,
    source_kind: OutputSourceKind,
) -> Result<*mut ObsSource, String> {
    if source_kind == OutputSourceKind::Display {
        let source_settings = obs.create_data();
        configure_display_capture_source(obs, source_settings)?;
        let source = create_source(
            obs,
            platform_display_source_id(),
            "alloy_display_video",
            Some(source_settings),
        );
        obs.release_data(source_settings);
        return source;
    }

    let source_settings = obs.create_data();
    configure_game_capture_source(obs, source_settings, game)?;
    let source = create_source(
        obs,
        GAME_CAPTURE_SOURCE_ID,
        "alloy_game_video",
        Some(source_settings),
    );
    obs.release_data(source_settings);
    source.map_err(|error| {
        format!(
            "{error} OBS game capture is unavailable; make sure the win-capture plugin is bundled."
        )
    })
}

unsafe fn configure_display_capture_source(
    obs: &LibObs,
    data: *mut ObsData,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        const OBS_DISPLAY_METHOD_DXGI: i64 = 1;

        if let Some(display_id) = primary_display_id() {
            obs.set_string(data, "monitor_id", &display_id)?;
        }
        obs.set_int(data, "method", OBS_DISPLAY_METHOD_DXGI)?;
        obs.set_bool(data, "force_sdr", false)?;
    }

    obs.set_bool(data, "capture_cursor", true)?;
    Ok(())
}

unsafe fn create_video_graph(
    obs: &LibObs,
    game: Option<&DetectedGame>,
    source_kind: OutputSourceKind,
    base_dimensions: VideoDimensions,
) -> Result<VideoGraph, String> {
    let source = create_video_source(obs, game, source_kind)?;
    create_scaled_video_scene(obs, source, base_dimensions).map_err(|error| {
        (obs.obs_source_remove)(source);
        (obs.obs_source_release)(source);
        error
    })
}

unsafe fn create_scaled_video_scene(
    obs: &LibObs,
    source: *mut ObsSource,
    base_dimensions: VideoDimensions,
) -> Result<VideoGraph, String> {
    let name = CString::new("alloy_video_scene").expect("static string has no nul byte");
    let scene = (obs.obs_scene_create_private)(name.as_ptr());
    if scene.is_null() {
        return Err("Could not create OBS video scene.".to_string());
    }

    let item = (obs.obs_scene_add)(scene, source);
    if item.is_null() {
        (obs.obs_scene_release)(scene);
        return Err("Could not add capture source to OBS video scene.".to_string());
    }

    let bounds = Vec2 {
        x: base_dimensions.width as f32,
        y: base_dimensions.height as f32,
    };
    (obs.obs_sceneitem_set_bounds_type)(item, OBS_BOUNDS_SCALE_INNER);
    (obs.obs_sceneitem_set_bounds_alignment)(item, OBS_ALIGN_CENTER);
    (obs.obs_sceneitem_set_bounds)(item, &bounds);
    (obs.obs_sceneitem_set_scale_filter)(item, OBS_SCALE_BILINEAR);

    let output_source = (obs.obs_scene_get_source)(scene);
    if output_source.is_null() {
        (obs.obs_scene_release)(scene);
        return Err("OBS video scene did not expose an output source.".to_string());
    }

    Ok(VideoGraph {
        scene,
        source,
        output_source,
    })
}

struct AudioSourceConfig {
    source_id: &'static str,
    name: String,
    device_id: Option<String>,
    window: Option<String>,
    priority: Option<i64>,
    volume: f32,
}

const OBS_WINDOW_PRIORITY_EXE: i64 = 2;

unsafe fn create_audio_sources(
    obs: &LibObs,
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
) -> Result<Vec<*mut ObsSource>, String> {
    let configs = audio_source_configs(settings, game)?;
    let mut sources = Vec::new();

    for config in configs.into_iter().take(MAX_AUDIO_SOURCES) {
        let source_settings = obs.create_data();
        let source = (|| {
            if let Some(device_id) = config.device_id.as_deref() {
                obs.set_string(source_settings, "device_id", device_id)?;
            }
            if let Some(window) = config.window.as_deref() {
                obs.set_string(source_settings, "window", window)?;
            }
            if let Some(priority) = config.priority {
                obs.set_int(source_settings, "priority", priority)?;
            }
            create_source(obs, config.source_id, &config.name, Some(source_settings))
        })();
        obs.release_data(source_settings);

        let source = match source {
            Ok(source) => source,
            Err(error) => {
                release_audio_sources(obs, sources);
                return Err(error);
            }
        };

        (obs.obs_source_set_audio_mixers)(source, 1);
        (obs.obs_source_set_volume)(source, config.volume);
        (obs.obs_set_output_source)(audio_output_index(sources.len()), source);
        sources.push(source);
    }

    Ok(sources)
}

fn audio_source_configs(
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
) -> Result<Vec<AudioSourceConfig>, String> {
    match settings.audio_mode {
        RecordingAudioMode::Devices => Ok(selected_audio_devices(settings)
            .into_iter()
            .map(audio_device_source_config)
            .collect()),
        RecordingAudioMode::Applications => {
            let applications = selected_audio_applications(settings, game);
            if applications.is_empty() {
                return Ok(Vec::new());
            }
            let Some(source_id) = platform_application_audio_source_id() else {
                return Err(
                    "Application audio capture requires OBS process audio support.".to_string(),
                );
            };

            Ok(applications
                .into_iter()
                .filter(|application| !application.window.is_empty())
                .map(|application| AudioSourceConfig {
                    source_id,
                    name: format!("alloy_application_audio_{}", file_slug(&application.name)),
                    device_id: None,
                    window: Some(application.window),
                    priority: Some(OBS_WINDOW_PRIORITY_EXE),
                    volume: audio_volume(application.volume),
                })
                .collect())
        }
    }
}

fn selected_audio_devices(settings: &RecordingSettings) -> Vec<RecordingAudioDeviceSelection> {
    let selected: Vec<_> = settings
        .audio_devices
        .iter()
        .filter(|device| device.enabled)
        .cloned()
        .collect();
    if !selected.is_empty() || !settings.audio_devices.is_empty() {
        return selected;
    }

    default_audio_devices()
        .into_iter()
        .filter(|device| device.enabled)
        .collect()
}

fn selected_audio_applications(
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
) -> Vec<RecordingAudioApplicationSelection> {
    let current_application = game.and_then(|game| audio_application_from_game(game, true));
    let mut available = available_audio_applications(game);
    let selected: Vec<_> = settings
        .audio_applications
        .iter()
        .filter(|application| application.enabled)
        .map(|application| {
            available
                .remove(&application.id)
                .map(|available_application| RecordingAudioApplicationSelection {
                    enabled: application.enabled,
                    volume: application.volume,
                    ..available_application
                })
                .unwrap_or_else(|| application.clone())
        })
        .collect();
    if !selected.is_empty() || !settings.audio_applications.is_empty() {
        return selected;
    }

    current_application.into_iter().collect()
}

fn audio_device_source_config(device: RecordingAudioDeviceSelection) -> AudioSourceConfig {
    let (source_id, prefix) = match device.kind {
        RecordingAudioDeviceKind::Output => (platform_audio_output_source_id(), "output"),
        RecordingAudioDeviceKind::Input => (platform_audio_input_source_id(), "input"),
    };

    AudioSourceConfig {
        source_id,
        name: format!("alloy_{prefix}_audio_{}", file_slug(&device.label)),
        device_id: Some(device.id),
        window: None,
        priority: None,
        volume: audio_volume(device.volume),
    }
}

fn audio_volume(volume: u32) -> f32 {
    (volume.min(100) as f32) / 100.0
}

unsafe fn configure_game_capture_source(
    obs: &LibObs,
    data: *mut ObsData,
    game: Option<&DetectedGame>,
) -> Result<(), String> {
    if let Some(obs_window) = game.and_then(|game| game.obs_window.as_deref()) {
        obs.set_string(data, "capture_mode", "window")?;
        obs.set_string(data, "window", obs_window)?;
        obs.set_string(data, "capture_window", obs_window)?;
    } else {
        obs.set_string(data, "capture_mode", "any_fullscreen")?;
        obs.set_string(data, "window", "")?;
        obs.set_string(data, "capture_window", "")?;
    }
    obs.set_string(data, "rgb10a2_space", "srgb")?;
    obs.set_bool(data, "capture_cursor", true)?;
    // Keep overlay capture off by default: it adds another hook path that can
    // interfere with normal Win32 window movement while Alloy is recording or
    // keeping a replay buffer alive.
    obs.set_bool(data, "capture_overlays", false)?;
    obs.set_bool(data, "anti_cheat_hook", true)?;
    obs.set_bool(data, "sli_compatibility", false)?;
    Ok(())
}

fn source_kind(settings: &RecordingSettings, _game: Option<&DetectedGame>) -> OutputSourceKind {
    if settings.record_desktop {
        OutputSourceKind::Display
    } else {
        OutputSourceKind::Game
    }
}

fn source_kind_for_focus(settings: &RecordingSettings, _focused: bool) -> OutputSourceKind {
    if settings.record_desktop {
        OutputSourceKind::Display
    } else {
        OutputSourceKind::Game
    }
}

fn should_pause_for_focus(
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
    focused: bool,
) -> bool {
    !settings.record_desktop && game.is_some() && !focused
}

fn recording_source_from_kind(source_kind: OutputSourceKind) -> RecordingCaptureSource {
    if source_kind == OutputSourceKind::Display {
        RecordingCaptureSource::Desktop
    } else {
        RecordingCaptureSource::Game
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct EffectiveQuality {
    width: u32,
    height: u32,
    fps: u32,
    bitrate: RecordingBitrate,
}

const DEFAULT_VIDEO_DIMENSIONS: VideoDimensions = VideoDimensions {
    width: 1920,
    height: 1080,
};

fn selected_quality_settings(settings: &RecordingSettings) -> RecordingQualitySettings {
    match settings.quality_profile {
        RecordingQualityProfile::Low => RecordingQualitySettings {
            resolution: RecordingResolution::R720p,
            fps: 30,
            bitrate: RecordingBitrate::Mbps("5".to_string()),
        },
        RecordingQualityProfile::Standard => RecordingQualitySettings {
            resolution: RecordingResolution::R1080p,
            fps: 60,
            bitrate: RecordingBitrate::Mbps("15".to_string()),
        },
        RecordingQualityProfile::High => RecordingQualitySettings {
            resolution: RecordingResolution::R1440p,
            fps: 60,
            bitrate: RecordingBitrate::Mbps("30".to_string()),
        },
        RecordingQualityProfile::Custom => settings.custom_quality.clone(),
    }
}

fn effective_quality(settings: &RecordingSettings) -> EffectiveQuality {
    effective_quality_with_source_dimensions(settings, None)
}

fn effective_quality_for_base(
    settings: &RecordingSettings,
    base_dimensions: VideoDimensions,
) -> EffectiveQuality {
    effective_quality_with_source_dimensions(settings, Some(base_dimensions))
}

fn effective_quality_with_source_dimensions(
    settings: &RecordingSettings,
    source_dimensions: Option<VideoDimensions>,
) -> EffectiveQuality {
    let quality = selected_quality_settings(settings);
    let (width, height) = match quality.resolution {
        RecordingResolution::Source => {
            let dimensions = source_dimensions.unwrap_or(DEFAULT_VIDEO_DIMENSIONS);
            (dimensions.width, dimensions.height)
        }
        RecordingResolution::R720p => (1280, 720),
        RecordingResolution::R1080p => (1920, 1080),
        RecordingResolution::R1440p => (2560, 1440),
        RecordingResolution::R2160p => (3840, 2160),
    };
    EffectiveQuality {
        width,
        height,
        fps: quality.fps.clamp(30, 120),
        bitrate: quality.bitrate,
    }
}

fn obs_video_config(
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
    source_kind: OutputSourceKind,
) -> ObsVideoConfig {
    let base = capture_base_dimensions(settings, game, source_kind);
    let quality = effective_quality_for_base(settings, base);
    ObsVideoConfig {
        base,
        output: VideoDimensions {
            width: quality.width,
            height: quality.height,
        },
        fps: quality.fps,
    }
}

fn capture_base_dimensions(
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
    source_kind: OutputSourceKind,
) -> VideoDimensions {
    if source_kind == OutputSourceKind::Game {
        if let Some(dimensions) = game.and_then(|game| game.capture_dimensions) {
            return dimensions;
        }
    }

    if source_kind == OutputSourceKind::Display {
        if let Some(dimensions) = primary_display_dimensions() {
            return dimensions;
        }
    }

    let quality = effective_quality(settings);
    VideoDimensions {
        width: quality.width,
        height: quality.height,
    }
}

fn output_last_error(obs: &LibObs, output: *mut ObsOutput) -> Option<String> {
    let raw = unsafe { (obs.obs_output_get_last_error)(output) };
    if raw.is_null() {
        return None;
    }
    let message = unsafe { CStr::from_ptr(raw).to_string_lossy().into_owned() };
    if message.is_empty() {
        None
    } else {
        Some(message)
    }
}

include!("sidecar_obs_platform.rs");
