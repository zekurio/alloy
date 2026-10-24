pub(in crate::agent) use crate::agent::quality::{
    effective_quality, effective_quality_for_base, EffectiveQuality, DEFAULT_VIDEO_DIMENSIONS,
};
use crate::{
    agent::{
        obs::types::{ObsVideoConfig, OutputSourceKind},
        platform::{selected_display_dimensions, DetectedGame},
    },
    types::{RecordingSettings, VideoDimensions},
};

pub(in crate::agent) fn obs_video_config(
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
    if source_kind == OutputSourceKind::Game {
        if let Some(dimensions) = game.and_then(|game| game.capture_dimensions) {
            return dimensions;
        }
    }

    if let Some(dimensions) = selected_display_dimensions(settings) {
        return dimensions;
    }

    let quality = effective_quality(settings);
    VideoDimensions {
        width: quality.width,
        height: quality.height,
    }
}
