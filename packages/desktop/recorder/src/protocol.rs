//! Constants that are part of the agent's stdio JSON protocol.

/// Executable stem the desktop host spawns, and the name reported by `version`.
pub const SIDE_CAR_NAME: &str = "alloy-agent";

/// Bumped whenever the request/response shape changes incompatibly.
pub const RECORDER_PROTOCOL_VERSION: u32 = 1;

/// Content type reported for captured clips.
pub const CONTENT_TYPE_MP4: &str = "video/mp4";
