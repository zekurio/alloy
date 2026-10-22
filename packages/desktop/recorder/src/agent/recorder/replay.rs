use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::agent::time::timestamp_file_slug;
use crate::names::file_component;
use crate::protocol::SIDE_CAR_NAME;
use crate::types::{RecordingBufferStorage, RecordingCapturePostProcess, RecordingGame};

use super::{ActiveSession, ReplayBufferConfig};

pub(super) const DISK_REPLAY_PREFIX: &str = "alloy-replay-buffer-";
pub(super) const MEMORY_REPLAY_PREFIX: &str = "alloy-replay-";
/// OBS names every split segment from this pattern, so it keeps the prefix
/// the segment scan looks for. Two splits within one second get a numeric
/// suffix from OBS, since overwriting is off.
pub(super) const DISK_REPLAY_SEGMENT_FORMAT: &str = "alloy-replay-buffer-%CCYY%MM%DD-%hh%mm%ss";
const DISK_REPLAY_SEGMENT_SECONDS: u32 = 15;

/// A scratch folder for one replay session, below the shared scratch root.
/// Each session writes only here, so a save never picks up segments of an
/// earlier game or codec, and stopping the session deletes the folder whole.
pub(super) fn create_session_scratch_folder(root: &Path) -> Result<PathBuf, String> {
    let folder = root.join(format!("session-{}", timestamp_file_slug()));
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "Could not create replay scratch folder {}: {error}",
            folder.display()
        )
    })?;
    Ok(folder)
}

pub(super) fn recording_context_folder(game: Option<&RecordingGame>) -> String {
    game.map(|game| file_component(&game.name, "Desktop"))
        .unwrap_or_else(|| "Desktop".to_string())
}

pub(super) fn saved_recording_path(output_folder: &Path, game: Option<&RecordingGame>) -> PathBuf {
    let directory = output_folder
        .join("Clips")
        .join(recording_context_folder(game));
    unique_recording_path(&directory, "clip")
}

/// A clip name the output folder does not use yet. A disk save's clip does
/// not exist until the host joins its staged parts, so those parts hold the
/// name too; otherwise a second save in the same second would overwrite them.
fn unique_recording_path(directory: &Path, prefix: &str) -> PathBuf {
    let slug = timestamp_file_slug();
    let mut path = directory.join(format!("{prefix}-{slug}.mp4"));
    let mut counter = 2;
    while path.exists() || disk_replay_part_path(&path, 0).is_some_and(|part| part.exists()) {
        path = directory.join(format!("{prefix}-{slug}-{counter}.mp4"));
        counter += 1;
    }
    path
}

/// The staged part `index` of a disk save that becomes `clip`.
fn disk_replay_part_path(clip: &Path, index: usize) -> Option<PathBuf> {
    let stem = clip.file_stem()?.to_str()?;
    Some(clip.with_file_name(format!(".{stem}.part{index:02}.mp4")))
}

pub(super) struct DiskReplaySegment {
    pub(super) path: PathBuf,
    pub(super) modified: SystemTime,
}

pub(super) struct MemoryReplayFile {
    pub(super) path: PathBuf,
    pub(super) modified: SystemTime,
}

pub(super) struct SavedReplayClip {
    pub(super) path: String,
    pub(super) post_process: Option<RecordingCapturePostProcess>,
}

pub(super) fn newest_memory_replay_file(
    directory: &Path,
    modified_after: SystemTime,
) -> Option<MemoryReplayFile> {
    memory_replay_files(directory)
        .into_iter()
        .filter(|replay| replay.modified >= modified_after)
        .max_by_key(|replay| replay.modified)
}

fn memory_replay_files(directory: &Path) -> Vec<MemoryReplayFile> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy();
            if !name.starts_with(MEMORY_REPLAY_PREFIX)
                || name.starts_with(DISK_REPLAY_PREFIX)
                || !name.ends_with(".mp4")
            {
                return None;
            }

            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }

            Some(MemoryReplayFile {
                path,
                modified: metadata.modified().unwrap_or(UNIX_EPOCH),
            })
        })
        .collect()
}

pub(super) fn replay_file_modified_at_or_after(path: &Path, modified_after: SystemTime) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    metadata
        .modified()
        .map(|modified| modified >= modified_after)
        .unwrap_or(false)
}

pub(super) fn newest_disk_replay_segment(directory: &Path) -> Option<DiskReplaySegment> {
    disk_replay_segments(directory)
        .into_iter()
        .max_by_key(|segment| segment.modified)
}

fn disk_replay_segments(directory: &Path) -> Vec<DiskReplaySegment> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy();
            if !name.starts_with(DISK_REPLAY_PREFIX) || !name.ends_with(".mp4") {
                return None;
            }

            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }

            Some(DiskReplaySegment {
                path,
                modified: metadata.modified().unwrap_or(UNIX_EPOCH),
            })
        })
        .collect()
}

fn wait_for_stable_file(path: &Path) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut last_size = None;
    let mut stable_ticks = 0;
    while Instant::now() < deadline {
        if let Ok(metadata) = fs::metadata(path) {
            let size = metadata.len();
            if size > 0 && last_size == Some(size) {
                stable_ticks += 1;
            } else {
                stable_ticks = 0;
            }
            if stable_ticks >= 3 {
                return Ok(());
            }
            last_size = Some(size);
        }
        thread::sleep(Duration::from_millis(250));
    }

    if !path.exists() {
        return Err("OBS disk replay buffer did not produce a file.".to_string());
    }

    Err(format!(
        "OBS replay file did not become stable before the deadline: {}",
        path.display()
    ))
}

pub(super) fn save_disk_replay_clip(
    scratch_directory: &Path,
    output_directory: &Path,
    game: Option<&RecordingGame>,
    replay_seconds: u32,
    closed_segment: &Path,
) -> Result<SavedReplayClip, String> {
    wait_for_stable_file(closed_segment)?;
    let mut segments = disk_replay_segments(scratch_directory);
    segments.sort_by_key(|segment| segment.modified);
    if let Some(closed_index) = segments
        .iter()
        .position(|segment| segment.path.as_path() == closed_segment)
    {
        segments.truncate(closed_index.saturating_add(1));
    } else {
        let closed_modified = fs::metadata(closed_segment)
            .and_then(|metadata| metadata.modified())
            .unwrap_or_else(|_| SystemTime::now());
        segments.retain(|segment| segment.modified <= closed_modified);
    }

    let keep_count = disk_replay_segment_count(replay_seconds);
    let selected = segments
        .into_iter()
        .rev()
        .take(keep_count)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Err("OBS disk replay buffer did not produce a file.".to_string());
    }

    let output = saved_recording_path(output_directory, game);
    let output_parent = output
        .parent()
        .ok_or_else(|| "Could not determine replay output folder.".to_string())?;
    fs::create_dir_all(output_parent)
        .map_err(|error| format!("Could not create replay output folder: {error}"))?;
    // A lone segment is joined too: scratch segments skip faststart, and the
    // host's join is the remux that adds it.
    let segment_paths = copy_disk_replay_segment_parts(&selected, &output)?;
    Ok(SavedReplayClip {
        path: output.to_string_lossy().into_owned(),
        post_process: Some(RecordingCapturePostProcess::ConcatSegments { segment_paths }),
    })
}

pub(super) fn move_saved_replay_to_output(
    path: &str,
    output_directory: &Path,
    game: Option<&RecordingGame>,
    duration_seconds: u32,
    replay_seconds: u32,
) -> Result<SavedReplayClip, String> {
    let source = PathBuf::from(path);
    wait_for_stable_file(&source)?;
    let mut output = saved_recording_path(output_directory, game);
    let output_parent = output
        .parent()
        .ok_or_else(|| "Could not determine replay output folder.".to_string())?;
    fs::create_dir_all(output_parent)
        .map_err(|error| format!("Could not create replay output folder: {error}"))?;

    if source == output {
        return Ok(SavedReplayClip {
            path: source.to_string_lossy().into_owned(),
            post_process: replay_trim_post_process(duration_seconds, replay_seconds),
        });
    }

    if output.exists() {
        output = saved_recording_path(output_directory, game);
    }

    if source != output {
        match fs::rename(&source, &output) {
            Ok(()) => {}
            Err(_) => fs::copy(&source, &output)
                .and_then(|_| fs::remove_file(&source))
                .map(|_| ())
                .map_err(|error| format!("Could not move replay clip out of scratch: {error}"))?,
        }
    }

    Ok(SavedReplayClip {
        path: output.to_string_lossy().into_owned(),
        post_process: replay_trim_post_process(duration_seconds, replay_seconds),
    })
}

fn replay_trim_post_process(
    duration_seconds: u32,
    replay_seconds: u32,
) -> Option<RecordingCapturePostProcess> {
    (duration_seconds < replay_seconds).then_some(RecordingCapturePostProcess::TrimTail {
        keep_ms: u64::from(duration_seconds.max(1)) * 1000,
    })
}

/// Stages the segments of a disk save beside the clip they will become, as
/// `.<clip>.partNN.mp4`. The host joins them into `<clip>.mp4`, which does
/// not exist until then, and deletes them. The dot prefix keeps library
/// scans from listing them, and the `.mp4` extension lets the host accept
/// them as media. The parts, not the scratch segments, are what the host
/// recovers after a restart: the scratch folder is emptied whenever a new
/// recorder starts.
fn copy_disk_replay_segment_parts(
    segments: &[DiskReplaySegment],
    output: &Path,
) -> Result<Vec<String>, String> {
    let mut parts = Vec::with_capacity(segments.len());
    for (index, segment) in segments.iter().enumerate() {
        let part = disk_replay_part_path(output, index)
            .ok_or_else(|| "Could not determine replay output name.".to_string())?;
        if let Err(error) = fs::copy(&segment.path, &part) {
            let _ = fs::remove_file(&part);
            for staged in &parts {
                let _ = fs::remove_file(staged);
            }
            return Err(format!("Could not stage disk replay segment: {error}"));
        }
        parts.push(part.to_string_lossy().into_owned());
    }
    Ok(parts)
}

pub(super) fn disk_replay_segment_seconds(replay_seconds: u32) -> u32 {
    replay_seconds.clamp(1, DISK_REPLAY_SEGMENT_SECONDS)
}

fn disk_replay_segment_count(replay_seconds: u32) -> usize {
    let segment_seconds = disk_replay_segment_seconds(replay_seconds);
    usize::try_from(replay_seconds.div_ceil(segment_seconds).saturating_add(1)).unwrap_or(2)
}

pub(super) fn replay_buffer_duration(session: &ActiveSession) -> Duration {
    Duration::from_secs(u64::from(session.output_config.replay_seconds.max(1)))
}

/// Deletes every scratch segment older than the ones a save can still use.
/// OBS writes only the newest segment and never looks back, so without this
/// the folder grows for as long as the session runs.
pub(super) fn prune_disk_replay_segments(config: &ReplayBufferConfig) {
    let ReplayBufferConfig {
        scratch_directory,
        output_directory: _,
        storage,
        replay_seconds,
    } = config;
    if storage != &RecordingBufferStorage::Disk {
        return;
    }

    let mut segments = disk_replay_segments(scratch_directory);
    segments.sort_by_key(|segment| segment.modified);
    let remove_count = segments
        .len()
        .saturating_sub(disk_replay_segment_count(*replay_seconds));
    for segment in segments.into_iter().take(remove_count) {
        let _ = fs::remove_file(segment.path);
    }
}

/// Removes a session's scratch folder with whatever OBS left in it. Saved
/// clips were copied or moved out before this runs.
pub(super) fn remove_session_scratch_folder(config: &ReplayBufferConfig) {
    match fs::remove_dir_all(&config.scratch_directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => eprintln!(
            "[{SIDE_CAR_NAME}] could not remove replay scratch folder {}: {error}",
            config.scratch_directory.display()
        ),
    }
}
