use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::{CStr, CString},
    fs,
    io::{self, BufRead, Write},
    os::raw::{c_char, c_void},
    path::{Path, PathBuf},
    process::Command,
    ptr,
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use chrono::{SecondsFormat, Utc};
use libloading::{Library, Symbol};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SIDE_CAR_NAME: &str = "alloy-recorder";
const RECORDER_PROTOCOL_VERSION: u32 = 1;
const CONTENT_TYPE_MP4: &str = "video/mp4";
const DISK_REPLAY_PREFIX: &str = "alloy-replay-buffer-";
const DISK_REPLAY_SEGMENT_SECONDS: u32 = 15;

const VIDEO_FORMAT_NV12: i32 = 2;
const VIDEO_CS_DEFAULT: i32 = 0;
const VIDEO_RANGE_DEFAULT: i32 = 0;
const OBS_SCALE_BILINEAR: i32 = 3;
const OBS_BOUNDS_SCALE_INNER: i32 = 2;
const OBS_ALIGN_CENTER: u32 = 0;
const SPEAKERS_STEREO: i32 = 2;
const OBS_VIDEO_SUCCESS: i32 = 0;
const GAME_CAPTURE_SOURCE_ID: &str = "game_capture";
const MAX_AUDIO_SOURCES: usize = 6;

type ObsData = c_void;
type ObsSource = c_void;
type ObsEncoder = c_void;
type ObsOutput = c_void;
type ObsScene = c_void;
type ObsSceneItem = c_void;
type ObsVideo = c_void;
type ObsAudio = c_void;
type ObsModule = c_void;
type ProcHandler = c_void;

include!("sidecar_types.rs");
include!("sidecar_recorder.rs");
include!("sidecar_recorder_output.rs");
include!("sidecar_recorder_cache.rs");
include!("sidecar_obs.rs");
include!("sidecar_runtime.rs");
