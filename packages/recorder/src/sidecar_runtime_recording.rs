fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn system_time_iso(value: SystemTime) -> String {
    DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn timestamp_file_slug() -> String {
    Utc::now().format("%Y%m%d-%H%M%S%.3f").to_string()
}

fn capture_identifier() -> String {
    let mut bytes = random_identifier_bytes().unwrap_or_else(|| timestamp_millis().to_be_bytes());
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}

fn random_identifier_bytes() -> Option<[u8; 16]> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };

    let mut bytes = [0u8; 16];
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            u32::try_from(bytes.len()).ok()?,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    (status >= 0).then_some(bytes)
}

fn recording_context_folder(game: Option<&RecordingGame>) -> String {
    game.map(|game| file_component(&game.name, "Desktop"))
        .unwrap_or_else(|| "Desktop".to_string())
}

fn saved_recording_path(
    output_folder: &Path,
    collection: &str,
    game: Option<&RecordingGame>,
) -> PathBuf {
    output_folder
        .join(collection)
        .join(recording_context_folder(game))
        .join(format!("{}.mp4", capture_identifier()))
}

struct DiskReplaySegment {
    path: PathBuf,
    modified: SystemTime,
}

struct MemoryReplayFile {
    path: PathBuf,
    modified: SystemTime,
}

struct SavedReplayClip {
    path: String,
    post_process: Option<RecordingCapturePostProcess>,
}

fn newest_memory_replay_file(
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

fn replay_file_modified_at_or_after(path: &Path, modified_after: SystemTime) -> bool {
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

fn newest_disk_replay_segment(directory: &Path) -> Option<DiskReplaySegment> {
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
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut last_size = None;
    while Instant::now() < deadline {
        if let Ok(metadata) = fs::metadata(path) {
            let size = metadata.len();
            if size > 0 && last_size == Some(size) {
                return Ok(());
            }
            last_size = Some(size);
        }
        thread::sleep(Duration::from_millis(100));
    }

    if path.exists() {
        Ok(())
    } else {
        Err("OBS disk replay buffer did not produce a file.".to_string())
    }
}

fn save_disk_replay_clip(
    scratch_directory: &Path,
    output_directory: &Path,
    game: Option<&RecordingGame>,
    replay_seconds: u32,
    closed_segment: &Path,
) -> Result<SavedReplayClip, String> {
    wait_for_stable_file(closed_segment)?;
    let closed_modified = fs::metadata(closed_segment)
        .and_then(|metadata| metadata.modified())
        .unwrap_or_else(|_| SystemTime::now());
    let mut segments: Vec<DiskReplaySegment> = disk_replay_segments(scratch_directory)
        .into_iter()
        .filter(|segment| segment.modified <= closed_modified)
        .collect();
    segments.sort_by_key(|segment| segment.modified);

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

    let output = saved_recording_path(output_directory, "Clips", game);
    let output_parent = output
        .parent()
        .ok_or_else(|| "Could not determine replay output folder.".to_string())?;
    fs::create_dir_all(output_parent)
        .map_err(|error| format!("Could not create replay output folder: {error}"))?;
    if selected.len() == 1 {
        fs::copy(closed_segment, &output)
            .map_err(|error| format!("Could not save disk replay clip: {error}"))?;
        return Ok(SavedReplayClip {
            path: output.to_string_lossy().into_owned(),
            post_process: None,
        });
    }

    let segment_paths = copy_disk_replay_segment_parts(&selected, &output)?;
    Ok(SavedReplayClip {
        path: output.to_string_lossy().into_owned(),
        post_process: Some(RecordingCapturePostProcess::ConcatSegments { segment_paths }),
    })
}

fn move_saved_replay_to_output(
    path: &str,
    output_directory: &Path,
    game: Option<&RecordingGame>,
    duration_seconds: u32,
    replay_seconds: u32,
) -> Result<SavedReplayClip, String> {
    let source = PathBuf::from(path);
    wait_for_stable_file(&source)?;
    let mut output = saved_recording_path(output_directory, "Clips", game);
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
        output = saved_recording_path(output_directory, "Clips", game);
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

fn copy_disk_replay_segment_parts(
    segments: &[DiskReplaySegment],
    output: &Path,
) -> Result<Vec<String>, String> {
    let parent = output
        .parent()
        .ok_or_else(|| "Could not determine replay output folder.".to_string())?;
    let stem = output
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "Could not determine replay output name.".to_string())?;

    segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let part = parent.join(format!("{stem}.part{index:02}.tmp"));
            fs::copy(&segment.path, &part)
                .map(|_| part.to_string_lossy().into_owned())
                .map_err(|error| format!("Could not stage disk replay segment: {error}"))
        })
        .collect()
}

fn disk_replay_segment_seconds(replay_seconds: u32) -> u32 {
    replay_seconds.clamp(1, DISK_REPLAY_SEGMENT_SECONDS)
}

fn disk_replay_segment_count(replay_seconds: u32) -> usize {
    let segment_seconds = disk_replay_segment_seconds(replay_seconds);
    usize::try_from(replay_seconds.div_ceil(segment_seconds).saturating_add(1)).unwrap_or(2)
}

fn cleanup_disk_replay_segments(config: &OutputConfig, keep: Option<&str>) {
    let OutputConfig::ReplayBuffer {
        scratch_directory,
        output_directory: _,
        storage,
        replay_seconds,
    } = config
    else {
        return;
    };
    if storage != &RecordingBufferStorage::Disk {
        return;
    }

    let mut segments = disk_replay_segments(scratch_directory);
    segments.sort_by_key(|segment| segment.modified);
    let remove_count = segments
        .len()
        .saturating_sub(disk_replay_segment_count(*replay_seconds));
    for segment in segments.into_iter().take(remove_count) {
        if keep.is_some_and(|keep| Path::new(keep) == segment.path) {
            continue;
        }
        let _ = fs::remove_file(segment.path);
    }
}

fn update_session_pause_time(session: &mut ActiveSession, paused: bool) {
    if paused == session.paused {
        return;
    }

    let now = SystemTime::now();
    if paused {
        session.paused_at = Some(now);
    } else if let Some(paused_at) = session.paused_at.take() {
        session.total_paused += now.duration_since(paused_at).unwrap_or_default();
    }
    session.paused = paused;
}

fn session_total_paused(session: &ActiveSession) -> Duration {
    let current_pause = session
        .paused_at
        .and_then(|paused_at| SystemTime::now().duration_since(paused_at).ok())
        .unwrap_or_default();
    session.total_paused.saturating_add(current_pause)
}

fn session_duration_ms(started_at: SystemTime, total_paused: Duration) -> Option<u64> {
    let elapsed = started_at.elapsed().ok()?.saturating_sub(total_paused);
    u64::try_from(elapsed.as_millis()).ok()
}

fn unix_millis_to_system_time(value: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(value)
}

fn bookmark_position_ms(session: &ActiveSession, requested_at: SystemTime) -> u64 {
    let elapsed = requested_at
        .duration_since(session.started_at)
        .unwrap_or_default()
        .saturating_sub(session_total_paused(session));
    u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
}
