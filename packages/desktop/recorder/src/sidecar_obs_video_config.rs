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
            bitrate: RecordingBitrate::mbps("5"),
        },
        RecordingQualityProfile::Standard => RecordingQualitySettings {
            resolution: RecordingResolution::R1080p,
            fps: 60,
            bitrate: RecordingBitrate::mbps("15"),
        },
        RecordingQualityProfile::High => RecordingQualitySettings {
            resolution: RecordingResolution::R1440p,
            fps: 60,
            bitrate: RecordingBitrate::mbps("30"),
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
        RecordingResolution::R720p => output_dimensions_for_height(source_dimensions, 1280, 720),
        RecordingResolution::R1080p => output_dimensions_for_height(source_dimensions, 1920, 1080),
        RecordingResolution::R1440p => output_dimensions_for_height(source_dimensions, 2560, 1440),
        RecordingResolution::R2160p => output_dimensions_for_height(source_dimensions, 3840, 2160),
    };
    EffectiveQuality {
        width,
        height,
        fps: quality.fps.clamp(30, 120),
        bitrate: quality.bitrate,
    }
}

fn output_dimensions_for_height(
    source_dimensions: Option<VideoDimensions>,
    fallback_width: u32,
    target_height: u32,
) -> (u32, u32) {
    let Some(dimensions) = source_dimensions.filter(|dimensions| dimensions.height > 0) else {
        return (fallback_width, target_height);
    };

    let scaled_width = u64::from(target_height) * u64::from(dimensions.width)
        / u64::from(dimensions.height);
    (even_dimension(scaled_width), target_height)
}

fn even_dimension(value: u64) -> u32 {
    let clamped = value.clamp(2, u64::from(u32::MAX)) as u32;
    clamped - (clamped % 2)
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
        hdr_enabled: game.is_some_and(|game| game.hdr_enabled),
    }
}

fn capture_base_dimensions(
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
    source_kind: OutputSourceKind,
) -> VideoDimensions {
    capture_base_dimensions_with_display(
        settings,
        game,
        source_kind,
        selected_display_dimensions(settings),
    )
}

fn capture_base_dimensions_with_display(
    settings: &RecordingSettings,
    game: Option<&DetectedGame>,
    source_kind: OutputSourceKind,
    display_dimensions: Option<VideoDimensions>,
) -> VideoDimensions {
    if source_kind == OutputSourceKind::Game {
        if let Some(dimensions) = game.and_then(|game| game.capture_dimensions) {
            return dimensions;
        }
    }

    if source_kind == OutputSourceKind::Game || source_kind == OutputSourceKind::Display {
        if let Some(dimensions) = display_dimensions {
            return dimensions;
        }
    }

    let quality = effective_quality(settings);
    VideoDimensions {
        width: quality.width,
        height: quality.height,
    }
}
