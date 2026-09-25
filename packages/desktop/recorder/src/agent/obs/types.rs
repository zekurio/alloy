use std::time::Instant;

use crate::types::VideoDimensions;

use super::bindings::{ObsScene, ObsSource};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::agent) struct ObsVideoConfig {
    pub(in crate::agent) base: VideoDimensions,
    pub(in crate::agent) output: VideoDimensions,
    pub(in crate::agent) fps: u32,
    pub(in crate::agent) hdr_enabled: bool,
}

pub(in crate::agent) struct VideoGraph {
    pub(in crate::agent) scene: *mut ObsScene,
    pub(in crate::agent) source: *mut ObsSource,
    pub(in crate::agent) output_source: *mut ObsSource,
    pub(in crate::agent) source_kind: OutputSourceKind,
}

pub(in crate::agent) struct AudioGraph {
    /// Audio capture sources attached directly to OBS output channels
    /// `AUDIO_OUTPUT_CHANNEL_BASE + i` in order.
    pub(in crate::agent) sources: Vec<AudioSource>,
}

pub(in crate::agent) struct AudioSource {
    /// Settings selector the source was created from, stable across volume
    /// edits and selection changes.
    pub(in crate::agent) selector: String,
    /// Resolved capture target (`device_id` or `window`) the source was
    /// created with; a different target needs a different OBS source.
    pub(in crate::agent) target: String,
    pub(in crate::agent) source: *mut ObsSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::agent) enum OutputSourceKind {
    Game,
    Display,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::agent) struct ObsEncoderDescriptor {
    pub(in crate::agent) id: String,
    pub(in crate::agent) kind: ObsEncoderKind,
    pub(in crate::agent) codec: String,
    pub(in crate::agent) caps: u32,
    pub(in crate::agent) display_name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::agent) enum ObsEncoderKind {
    Audio,
    Video,
}

impl ObsEncoderDescriptor {
    pub(in crate::agent) fn has_cap(&self, cap: u32) -> bool {
        self.caps & cap != 0
    }

    pub(in crate::agent) fn is_internal_or_deprecated(&self) -> bool {
        self.has_cap(super::bindings::OBS_ENCODER_CAP_INTERNAL)
            || self.has_cap(super::bindings::OBS_ENCODER_CAP_DEPRECATED)
    }
}

#[derive(Debug)]
pub(in crate::agent) struct GameCaptureHookWait {
    pub(in crate::agent) started_at: Instant,
    pub(in crate::agent) last_logged_attempt: u32,
}
