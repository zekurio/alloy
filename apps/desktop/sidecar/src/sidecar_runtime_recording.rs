fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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

#[cfg(windows)]
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

#[cfg(not(windows))]
fn random_identifier_bytes() -> Option<[u8; 16]> {
    use std::io::Read as _;

    let mut bytes = [0u8; 16];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .ok()?;
    Some(bytes)
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
) -> Result<String, String> {
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
    let copied = || {
        fs::copy(closed_segment, &output)
            .map(|_| output.to_string_lossy().into_owned())
            .map_err(|error| format!("Could not save disk replay clip: {error}"))
    };

    if selected.len() == 1 {
        return copied();
    }

    concat_disk_replay_segments(&selected, &output).or_else(|_| copied())
}

fn move_saved_replay_to_output(
    path: &str,
    output_directory: &Path,
    game: Option<&RecordingGame>,
) -> Result<String, String> {
    let source = PathBuf::from(path);
    wait_for_stable_file(&source)?;
    let mut output = saved_recording_path(output_directory, "Clips", game);
    let output_parent = output
        .parent()
        .ok_or_else(|| "Could not determine replay output folder.".to_string())?;
    fs::create_dir_all(output_parent)
        .map_err(|error| format!("Could not create replay output folder: {error}"))?;

    if source == output {
        return Ok(source.to_string_lossy().into_owned());
    }

    if output.exists() {
        output = saved_recording_path(output_directory, "Clips", game);
    }

    match fs::rename(&source, &output) {
        Ok(()) => Ok(output.to_string_lossy().into_owned()),
        Err(_) => fs::copy(&source, &output)
            .and_then(|_| fs::remove_file(&source))
            .map(|_| output.to_string_lossy().into_owned())
            .map_err(|error| format!("Could not move replay clip out of scratch: {error}")),
    }
}

fn concat_disk_replay_segments(
    segments: &[DiskReplaySegment],
    output: &Path,
) -> Result<String, String> {
    let manifest = output.with_extension("concat.txt");
    let manifest_contents = segments
        .iter()
        .map(|segment| format!("file '{}'\n", ffmpeg_concat_path(&segment.path)))
        .collect::<String>();
    fs::write(&manifest, manifest_contents)
        .map_err(|error| format!("Could not prepare disk replay concat: {error}"))?;

    let result = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
        ])
        .arg(&manifest)
        .args(["-c", "copy"])
        .arg(output)
        .status()
        .map_err(|error| format!("Could not run ffmpeg for disk replay concat: {error}"))
        .and_then(|status| {
            if status.success() {
                Ok(output.to_string_lossy().into_owned())
            } else {
                Err(format!("ffmpeg concat exited with status {status}."))
            }
        });
    let _ = fs::remove_file(manifest);
    result
}

fn ffmpeg_concat_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''")
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
