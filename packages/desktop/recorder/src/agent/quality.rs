//! Recording quality shared by every capture backend: the quality presets,
//! output dimensions for a source, and the automatic bitrate.

use crate::types::{
    RecordingBitrate, RecordingQualityProfile, RecordingQualitySettings, RecordingResolution,
    RecordingSettings, VideoDimensions,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::agent) struct EffectiveQuality {
    pub(in crate::agent) width: u32,
    pub(in crate::agent) height: u32,
    pub(in crate::agent) fps: u32,
    pub(in crate::agent) bitrate: RecordingBitrate,
}

pub(in crate::agent) const DEFAULT_VIDEO_DIMENSIONS: VideoDimensions = VideoDimensions {
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

#[cfg(windows)]
pub(in crate::agent) fn effective_quality(settings: &RecordingSettings) -> EffectiveQuality {
    effective_quality_with_source_dimensions(settings, None)
}

pub(in crate::agent) fn effective_quality_for_base(
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

    let scaled_width =
        u64::from(target_height) * u64::from(dimensions.width) / u64::from(dimensions.height);
    (even_dimension(scaled_width), target_height)
}

fn even_dimension(value: u64) -> u32 {
    let clamped = value.clamp(2, u64::from(u32::MAX)) as u32;
    clamped - (clamped % 2)
}

pub(in crate::agent) fn target_bitrate_kbps(quality: &EffectiveQuality) -> u32 {
    if let Some(kbps) = quality.bitrate.custom_kbps() {
        return kbps;
    }

    match (quality.height, quality.fps) {
        (height, fps) if height >= 2160 && fps >= 60 => 55_000,
        (height, _) if height >= 2160 => 40_000,
        (height, fps) if height >= 1440 && fps >= 60 => 30_000,
        (height, _) if height >= 1440 => 22_000,
        (height, fps) if height >= 1080 && fps >= 60 => 18_000,
        (height, _) if height >= 1080 => 12_000,
        (_, fps) if fps >= 60 => 8_000,
        _ => 5_000,
    }
}
