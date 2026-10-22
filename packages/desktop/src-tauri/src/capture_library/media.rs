use std::path::{Path, PathBuf};
use std::time::Duration;

use alloy_recorder::protocol::CONTENT_TYPE_MP4;
use serde::Deserialize;
use uuid::Uuid;

use crate::capture_library::error::{LibraryError, Result};
use crate::capture_library::paths::extension;
use crate::capture_library::store::{
    CaptureLibrary, ensure_media_in_output, ensure_media_location,
};
use crate::capture_library::types::{
    CaptureRecord, ExportRequest, ExportSegment, LibraryExport, LibraryItem, PostProcess, VideoMeta,
};
use crate::capture_library::work::Lane;

pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MEDIA_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MIN_EXPORT_SEGMENT_MS: u64 = 100;
const MIN_EXPORT_TOTAL_MS: u64 = 1_000;
/// Longest lead-in a publish copy may carry before the selection. The
/// server cuts the selection out of the copy, so the lead-in only costs
/// upload size; a file with sparser keyframes is re-encoded instead.
const MAX_COPY_LEAD_IN_MS: u64 = 10_000;
/// Longest lead-in a copied replay tail may keep. Nothing cuts the tail
/// later, so the saved clip is at most this much longer than asked. The
/// recorder sets a keyframe every two seconds (`keyint_sec`); the extra
/// second is slack for an interval that runs long. A replay with sparser
/// keyframes is re-encoded to the exact length.
const MAX_TAIL_LEAD_IN_MS: u64 = 3_000;
/// Copied past the end of a range, so the frames that close it decode.
const COPY_END_MARGIN_MS: u64 = 250;
/// Slack between packet timestamps and probed durations. Matches the
/// server's `TRIM_FULL_RANGE_TOLERANCE_MS`, which decides when a trim keeps
/// the whole upload.
const COPY_TOLERANCE_MS: u64 = 50;

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    format: Option<ProbeFormat>,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    start_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    start_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PacketProbeOutput {
    #[serde(default)]
    packets: Vec<ProbePacket>,
}

#[derive(Debug, Deserialize)]
struct ProbePacket {
    pts_time: Option<String>,
    flags: Option<String>,
}

/// What one ffprobe run reports about a capture.
struct ProbedMedia {
    meta: VideoMeta,
    video_codec: Option<String>,
    audio_codecs: Vec<String>,
    /// Container start in seconds. Times in the library, in ffmpeg's `-ss`,
    /// and on the server count from here.
    start_seconds: f64,
    /// When the first video frame shows, in ms from the container start.
    video_offset_ms: Option<i64>,
}

/// Reads a capture's duration and dimensions.
pub async fn probe_file(library: &CaptureLibrary, path: &Path) -> Result<VideoMeta> {
    Ok(probe_media(library, path).await?.meta)
}

async fn probe_media(library: &CaptureLibrary, path: &Path) -> Result<ProbedMedia> {
    let output = library
        .work()
        .ffprobe(
            &[
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                "-i",
                &path.to_string_lossy(),
            ],
            PROBE_TIMEOUT,
        )
        .await?;
    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|_| LibraryError::MediaTool("ffprobe returned invalid JSON".into()))?;
    let video = parsed
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"));
    let duration_ms = parsed
        .format
        .as_ref()
        .and_then(|format| format.duration.as_deref())
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| (value * 1_000.0).round() as u64);
    let start_seconds = parsed
        .format
        .as_ref()
        .and_then(|format| parse_seconds(format.start_time.as_deref()))
        .unwrap_or(0.0);
    Ok(ProbedMedia {
        meta: VideoMeta {
            duration_ms,
            width: video.and_then(|value| value.width),
            height: video.and_then(|value| value.height),
        },
        video_codec: video.and_then(|value| value.codec_name.clone()),
        audio_codecs: parsed
            .streams
            .iter()
            .filter(|stream| stream.codec_type.as_deref() == Some("audio"))
            .map(|stream| stream.codec_name.clone().unwrap_or_default())
            .collect(),
        start_seconds,
        video_offset_ms: video
            .and_then(|value| parse_seconds(value.start_time.as_deref()))
            .map(|value| ((value - start_seconds) * 1_000.0).round() as i64),
    })
}

fn parse_seconds(value: Option<&str>) -> Option<f64> {
    value
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite())
}

/// The server accepts MP4 with H.264, HEVC, or AV1 video and AAC audio. A
/// capture that already matches uploads as it is.
fn ensure_uploadable_mp4(path: &Path, probed: &ProbedMedia) -> Result<()> {
    if extension(path).as_deref() != Some("mp4") {
        return Err(LibraryError::UnsupportedMedia);
    }
    ensure_uploadable_codecs(probed)
}

/// Streams the server accepts, in any container: these copy into an MP4
/// upload without re-encoding.
fn ensure_uploadable_codecs(probed: &ProbedMedia) -> Result<()> {
    let Some(codec) = probed.video_codec.as_deref() else {
        return Err(LibraryError::MediaTool("MP4 has no video track".into()));
    };
    if !matches!(codec, "h264" | "hevc" | "av1") {
        return Err(LibraryError::MediaTool(
            "Only H.264, HEVC, or AV1 video can be uploaded".into(),
        ));
    }
    if probed.audio_codecs.iter().any(|codec| codec != "aac") {
        return Err(LibraryError::MediaTool(
            "Only AAC audio can be uploaded".into(),
        ));
    }
    Ok(())
}

/// Prunes a capture's export cache; the directory walk runs off the async
/// workers like every other library file operation.
async fn replace_exports(
    library: &CaptureLibrary,
    capture_id: &str,
    keep: Option<&str>,
) -> Result<()> {
    let capture_id = capture_id.to_string();
    let keep = keep.map(str::to_string);
    library
        .off_worker(move |library| library.replace_exports(&capture_id, keep.as_deref()))
        .await
}

/// Produces the file a publish uploads, without re-encoding when it can:
/// - A selection that covers the whole capture uploads the capture itself.
/// - When the caller lets the server cut (`allow_server_trim`), a shorter
///   selection is stream-copied from the keyframe before it, and the export
///   reports the selection as a trim for the server's one frame-exact encode.
/// - Anything else is re-encoded to exactly the selection.
pub async fn export(library: &CaptureLibrary, request: ExportRequest) -> Result<LibraryExport> {
    let id = request.id.clone();
    let item = library
        .off_worker(move |library| library.find_item(&id).ok_or(LibraryError::CaptureNotFound))
        .await?;
    let source = PathBuf::from(&item.filename);
    let probed = probe_media(library, &source).await?;
    // The recorder reports the length it asked for; the file knows its own.
    let source_duration = probed
        .meta
        .duration_ms
        .or(item.duration_ms)
        .ok_or_else(|| LibraryError::InvalidExport("capture has no duration".into()))?;
    let segment = sanitize_segment(request.segments.first(), source_duration)?;
    if request.segments.len() != 1 {
        return Err(LibraryError::InvalidExport(
            "multi-segment exports are not supported".into(),
        ));
    }
    let total_ms = segment.end_ms.saturating_sub(segment.start_ms);
    if total_ms < MIN_EXPORT_TOTAL_MS {
        return Err(LibraryError::InvalidExport("selection is too short".into()));
    }
    let full_source =
        segment.start_ms <= 50 && segment.end_ms.saturating_add(50) >= source_duration;
    if full_source && ensure_uploadable_mp4(&source, &probed).is_ok() {
        // The capture is the export, so nothing is copied into the cache and
        // older renders of this capture are no longer needed.
        replace_exports(library, &item.id, None).await?;
        return Ok(LibraryExport {
            id: item.id.clone(),
            // The host fills this from its loopback file server.
            media_url: String::new(),
            file_name: export_file_name(&item.file_name, segment, true),
            content_type: CONTENT_TYPE_MP4.to_string(),
            size_bytes: tokio::fs::metadata(&source).await?.len(),
            // A whole-file export contains the entire capture, including the
            // few milliseconds the requested segment may have left out.
            duration_ms: source_duration,
            width: probed.meta.width.or(item.width),
            height: probed.meta.height.or(item.height),
            source_start_ms: 0,
            source_end_ms: source_duration,
            trim_start_ms: None,
            trim_end_ms: None,
            whole_capture: true,
        });
    }
    if request.allow_server_trim && ensure_uploadable_codecs(&probed).is_ok() {
        match export_copy(library, &item, &source, &probed, segment).await {
            Ok(export) => return Ok(export),
            Err(LibraryError::MediaCancelled) => return Err(LibraryError::MediaCancelled),
            Err(error) => log::warn!(
                "could not stream-copy {} for upload, re-encoding it: {error}",
                item.file_name
            ),
        }
    }
    // A whole capture the server cannot take as it is gets re-encoded like
    // any other selection.
    let (source_start_ms, source_end_ms) = if full_source {
        (0, source_duration)
    } else {
        (segment.start_ms, segment.end_ms)
    };
    let export_key = format!(
        "export:{}:{}:{}:{}",
        item.filename, item.modified_at, source_start_ms, source_end_ms
    );
    let export_id = crate::capture_library::paths::capture_id(export_key.as_str());
    let output = library.export_path(&item.id, &export_id)?;
    tokio::fs::create_dir_all(output.parent().ok_or(LibraryError::InvalidPath)?).await?;
    {
        // A repeated publish of the same range waits for the render in flight
        // and reuses it.
        let _slot = library.work().exclusive(export_key).await;
        if !output.exists() || tokio::fs::metadata(&output).await?.len() == 0 {
            replace_with(&output, |temp| async move {
                transcode_range(
                    library,
                    &source,
                    &temp,
                    source_start_ms,
                    source_end_ms,
                    Lane::Export,
                )
                .await
            })
            .await?;
        }
    }
    // The editor only ever plays the export it just asked for, so the capture
    // keeps one render instead of one per trim the user tried.
    replace_exports(library, &item.id, Some(&export_id)).await?;
    let size_bytes = tokio::fs::metadata(&output).await?.len();
    Ok(LibraryExport {
        id: export_id,
        // The host fills this from its loopback file server.
        media_url: String::new(),
        file_name: export_file_name(&item.file_name, segment, full_source),
        content_type: CONTENT_TYPE_MP4.to_string(),
        size_bytes,
        duration_ms: source_end_ms - source_start_ms,
        width: probed.meta.width.or(item.width),
        height: probed.meta.height.or(item.height),
        source_start_ms,
        source_end_ms,
        trim_start_ms: None,
        trim_end_ms: None,
        whole_capture: false,
    })
}

/// Exports a selection as a stream copy that starts on the keyframe before
/// it, so the upload keeps the recorder's encode and codec. The server's
/// frame-exact cut is then the only encode the published clip goes through.
async fn export_copy(
    library: &CaptureLibrary,
    item: &LibraryItem,
    source: &Path,
    probed: &ProbedMedia,
    segment: ExportSegment,
) -> Result<LibraryExport> {
    let keyframe = keyframe_at_or_before(
        library,
        source,
        probed,
        segment.start_ms,
        MAX_COPY_LEAD_IN_MS,
    )
    .await?
    .ok_or_else(|| LibraryError::MediaTool("no keyframe shortly before the selection".into()))?;
    // Selections that start within one keyframe interval share a copy.
    let export_key = format!(
        "export:copy:{}:{}:{}:{}",
        item.filename, item.modified_at, keyframe, segment.end_ms
    );
    let export_id = crate::capture_library::paths::capture_id(export_key.as_str());
    let output = library.export_path(&item.id, &export_id)?;
    tokio::fs::create_dir_all(output.parent().ok_or(LibraryError::InvalidPath)?).await?;
    {
        let _slot = library.work().exclusive(export_key).await;
        if !output.exists() || tokio::fs::metadata(&output).await?.len() == 0 {
            replace_with(&output, |temp| async move {
                copy_packets(
                    library,
                    source,
                    probed,
                    &temp,
                    keyframe,
                    segment.end_ms + COPY_END_MARGIN_MS,
                    Lane::Export,
                )
                .await
            })
            .await?;
        }
    }
    let measured = measure_copy(library, &output, keyframe, segment, MAX_COPY_LEAD_IN_MS).await;
    let copied = match measured {
        Ok(copied) => copied,
        Err(error) => {
            let _ = tokio::fs::remove_file(&output).await;
            return Err(error);
        }
    };
    replace_exports(library, &item.id, Some(&export_id)).await?;
    // The trim is in the copy's time. Its end is not clamped to the copy:
    // the server clamps against the duration it measures, and a clamped
    // minimum-length selection would fall under its minimum.
    let trim_start = segment.start_ms.saturating_sub(copied.start_ms);
    let trim_end = segment.end_ms - copied.start_ms;
    let keeps_all =
        trim_start <= COPY_TOLERANCE_MS && trim_end + COPY_TOLERANCE_MS >= copied.duration_ms;
    Ok(LibraryExport {
        id: export_id,
        // The host fills this from its loopback file server.
        media_url: String::new(),
        file_name: export_file_name(&item.file_name, segment, false),
        content_type: CONTENT_TYPE_MP4.to_string(),
        size_bytes: tokio::fs::metadata(&output).await?.len(),
        duration_ms: copied.duration_ms,
        width: probed.meta.width.or(item.width),
        height: probed.meta.height.or(item.height),
        source_start_ms: copied.start_ms,
        source_end_ms: copied.start_ms + copied.duration_ms,
        trim_start_ms: (!keeps_all).then_some(trim_start),
        trim_end_ms: (!keeps_all).then_some(trim_end),
        whole_capture: false,
    })
}

/// Where a stream copy sits in the capture it was copied from.
struct CopiedRange {
    /// Capture time of the copy's time zero.
    start_ms: u64,
    duration_ms: u64,
}

/// The latest keyframe at or before `at_ms`, at most `max_lead_in_ms`
/// before it. Reads packet flags only, nothing is decoded.
async fn keyframe_at_or_before(
    library: &CaptureLibrary,
    source: &Path,
    probed: &ProbedMedia,
    at_ms: u64,
    max_lead_in_ms: u64,
) -> Result<Option<u64>> {
    let earliest_ms = at_ms.saturating_sub(max_lead_in_ms);
    // Packet times are absolute; library times count from the container
    // start.
    let interval = format!(
        "{:.3}%{:.3}",
        probed.start_seconds + earliest_ms as f64 / 1_000.0,
        probed.start_seconds + (at_ms + 1) as f64 / 1_000.0
    );
    let output = library
        .work()
        .ffprobe(
            &[
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-select_streams",
                "v:0",
                "-read_intervals",
                &interval,
                "-show_entries",
                "packet=pts_time,flags",
                "-print_format",
                "json",
                "-i",
                &source.to_string_lossy(),
            ],
            PROBE_TIMEOUT,
        )
        .await?;
    let parsed: PacketProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|_| LibraryError::MediaTool("ffprobe returned invalid JSON".into()))?;
    Ok(parsed
        .packets
        .iter()
        .filter(|packet| {
            packet
                .flags
                .as_deref()
                .is_some_and(|flags| flags.starts_with('K'))
        })
        .filter_map(|packet| parse_seconds(packet.pts_time.as_deref()))
        .map(|seconds| ((seconds - probed.start_seconds) * 1_000.0).round())
        .filter(|ms| *ms >= 0.0)
        .map(|ms| ms as u64)
        .filter(|ms| *ms <= at_ms && at_ms - ms <= max_lead_in_ms)
        .max())
}

/// Copies the capture's packets from the keyframe at `keyframe_ms` up to
/// `until_ms` into `output`.
async fn copy_packets(
    library: &CaptureLibrary,
    source: &Path,
    probed: &ProbedMedia,
    output: &Path,
    keyframe_ms: u64,
    until_ms: u64,
    lane: Lane,
) -> Result<()> {
    let source_text = source.to_string_lossy().into_owned();
    let output_text = output.to_string_lossy().into_owned();
    // From the first frame on, a remux keeps the capture's own timeline.
    // Later, seeking just past the keyframe lands on it however its
    // timestamp rounds, and a stream copy keeps every packet from it on.
    // Shifting the timestamps to start at zero, instead of letting the
    // muxer hide the lead-in behind an edit list, keeps frames where their
    // timestamps say: an edit list over B-frames moves them by a frame.
    let from_start = keyframe_ms as i64 <= probed.video_offset_ms.unwrap_or(0).max(0);
    let start = format_seconds(keyframe_ms + 1);
    let duration = format_seconds(until_ms.saturating_sub(keyframe_ms + 1));
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
    ];
    if !from_start {
        args.extend(["-ss", &start]);
    }
    args.extend([
        "-i",
        &source_text,
        "-t",
        &duration,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
    ]);
    if !from_start {
        args.extend(["-avoid_negative_ts", "make_zero"]);
    }
    args.extend(["-movflags", "+faststart", "-y", &output_text]);
    library.work().ffmpeg(lane, &args, MEDIA_TIMEOUT).await?;
    Ok(())
}

/// Measures where a copy made by [`copy_packets`] sits in its capture and
/// checks that it holds `range` with at most `max_lead_in_ms` before it.
async fn measure_copy(
    library: &CaptureLibrary,
    copy: &Path,
    keyframe_ms: u64,
    range: ExportSegment,
    max_lead_in_ms: u64,
) -> Result<CopiedRange> {
    let probed = probe_media(library, copy).await?;
    let duration_ms = probed
        .meta
        .duration_ms
        .ok_or_else(|| LibraryError::MediaTool("stream copy has no duration".into()))?;
    // The copy's first video frame is the keyframe. Shifting timestamps to
    // zero moves it off zero by the B-frame delay, or by audio that starts
    // before it, so measure where it shows.
    let start_ms = u64::try_from(keyframe_ms as i64 - probed.video_offset_ms.unwrap_or(0))
        .map_err(|_| LibraryError::MediaTool("stream copy starts before its capture".into()))?;
    if start_ms > range.start_ms + COPY_TOLERANCE_MS
        || range.start_ms.saturating_sub(start_ms) > max_lead_in_ms + COPY_TOLERANCE_MS
        || start_ms + duration_ms + COPY_TOLERANCE_MS < range.end_ms
    {
        return Err(LibraryError::MediaTool(
            "stream copy does not cover the selection".into(),
        ));
    }
    Ok(CopiedRange {
        start_ms,
        duration_ms,
    })
}

/// Whether the files a raw capture is made of still exist. A disk replay is
/// joined from segments into a destination that does not exist until the
/// join creates it, so its segments stand in for it until then.
pub fn capture_sources_present(capture: &CaptureRecord) -> bool {
    if Path::new(&capture.filename).is_file() {
        return true;
    }
    match &capture.post_process {
        Some(PostProcess::ConcatSegments { segment_paths }) => {
            !segment_paths.is_empty() && segment_paths.iter().all(|path| Path::new(path).is_file())
        }
        _ => false,
    }
}

/// Deletes what remains of the staged segments of a capture that will never
/// be joined, because a segment or the whole recording is gone.
pub async fn discard_capture_sources(capture: &CaptureRecord) {
    if let Some(PostProcess::ConcatSegments { segment_paths }) = &capture.post_process {
        remove_staged_parts(Path::new(&capture.filename), segment_paths).await;
    }
}

/// Applies the recorder's post-processing to a raw capture, then records the
/// file's final size and duration. Without post-processing there is nothing
/// to do. On failure the original destination and every concat source stay
/// in place, so the recorder can retry after a transient ffmpeg failure.
pub async fn finalize_capture(library: &CaptureLibrary, capture: &mut CaptureRecord) -> Result<()> {
    let Some(post_process) = capture.post_process.clone() else {
        return Ok(());
    };
    let filename = ensure_media_location(library.output_folder(), &capture.filename)?;
    match &post_process {
        PostProcess::TrimTail { keep_ms } => trim_tail(library, &filename, *keep_ms).await?,
        PostProcess::ConcatSegments { segment_paths } => {
            // Only the join creates the destination, in one rename. If it
            // exists, an earlier run joined the segments and stopped before
            // it deleted them all or recorded the clip.
            if !filename.is_file() {
                concat_segments(library, segment_paths, &filename).await?;
            }
            remove_staged_parts(Path::new(&capture.filename), segment_paths).await;
        }
    }
    // The recorder reports what it asked for; the file says what it holds.
    capture.post_process = None;
    capture.size_bytes = tokio::fs::metadata(&filename)
        .await
        .ok()
        .map(|value| value.len());
    capture.duration_ms = probe_file(library, &filename)
        .await
        .ok()
        .and_then(|value| value.duration_ms)
        .or(capture.duration_ms);
    Ok(())
}

/// Keeps the last `keep_ms` of a replay, from the keyframe at or before
/// that point. Copying keeps the recorder's encode and codec and spares the
/// CPU while a game may still run; the clip runs up to one keyframe interval
/// longer, the way disk replays keep whole segments. Without a keyframe
/// within [`MAX_TAIL_LEAD_IN_MS`], the tail is re-encoded to the exact
/// length.
async fn trim_tail(library: &CaptureLibrary, source: &Path, keep_ms: u64) -> Result<()> {
    let probed = probe_media(library, source).await?;
    let duration = probed
        .meta
        .duration_ms
        .ok_or_else(|| LibraryError::MediaTool("could not probe trim source".into()))?;
    if duration <= keep_ms {
        return Ok(());
    }
    let tail = ExportSegment {
        start_ms: duration - keep_ms,
        end_ms: duration,
    };
    let keyframe =
        keyframe_at_or_before(library, source, &probed, tail.start_ms, MAX_TAIL_LEAD_IN_MS).await;
    let copied = match keyframe {
        Ok(Some(keyframe)) => {
            replace_with(source, |temp| async move {
                copy_packets(
                    library,
                    source,
                    &probed,
                    &temp,
                    keyframe,
                    duration + COPY_END_MARGIN_MS,
                    Lane::Finalize,
                )
                .await?;
                // Check the copy before it replaces the recording.
                measure_copy(library, &temp, keyframe, tail, MAX_TAIL_LEAD_IN_MS)
                    .await
                    .map(|_| ())
            })
            .await
        }
        Ok(None) => Err(LibraryError::MediaTool(
            "no keyframe shortly before the tail".into(),
        )),
        Err(error) => Err(error),
    };
    match copied {
        Ok(()) => return Ok(()),
        Err(LibraryError::MediaCancelled) => return Err(LibraryError::MediaCancelled),
        Err(error) => log::warn!(
            "could not stream-copy the tail of {}, re-encoding it: {error}",
            source.display()
        ),
    }
    replace_with(source, |temp| async move {
        transcode_range(
            library,
            source,
            &temp,
            tail.start_ms,
            tail.end_ms,
            Lane::Finalize,
        )
        .await
    })
    .await
}

async fn concat_segments(
    library: &CaptureLibrary,
    segment_paths: &[String],
    output: &Path,
) -> Result<()> {
    if segment_paths.is_empty() {
        return Ok(());
    }
    let mut contents = String::new();
    for path in segment_paths {
        let path = ensure_media_in_output(library.output_folder(), Path::new(path))?;
        if path
            .to_string_lossy()
            .chars()
            .any(|value| matches!(value, '\r' | '\n'))
        {
            return Err(LibraryError::InvalidPath);
        }
        // The concat demuxer accepts single-quoted paths with doubled quotes.
        let escaped = path
            .to_string_lossy()
            .replace('\\', "/")
            .replace('\'', "'\\''");
        contents.push_str(&format!("file '{escaped}'\n"));
    }
    // A temporary like the join's output, so a failed or dropped join never
    // leaves it in the clip folder.
    let list = TempFile::beside(&output.with_extension("txt"));
    tokio::fs::write(list.path(), contents).await?;
    let list_text = list.path().to_string_lossy().into_owned();
    let result = replace_with(output, |temp| async move {
        let temp_text = temp.to_string_lossy().into_owned();
        let args = [
            "-hide_banner",
            "-loglevel",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_text,
            "-map",
            "0:v:0?",
            "-map",
            "0:a?",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-y",
            &temp_text,
        ];
        library
            .work()
            .ffmpeg(Lane::Finalize, &args, MEDIA_TIMEOUT)
            .await
            .map(|_| ())
    })
    .await;
    drop(list);
    result
}

async fn transcode_range(
    library: &CaptureLibrary,
    source: &Path,
    output: &Path,
    start_ms: u64,
    end_ms: u64,
    lane: Lane,
) -> Result<()> {
    if end_ms <= start_ms {
        return Err(LibraryError::InvalidExport("empty media range".into()));
    }
    let start = format_seconds(start_ms);
    let duration = format_seconds(end_ms - start_ms);
    let args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        &start,
        "-i",
        &source.to_string_lossy(),
        "-t",
        &duration,
        "-map",
        "0:v:0?",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-y",
        &output.to_string_lossy(),
    ];
    library.work().ffmpeg(lane, &args, MEDIA_TIMEOUT).await?;
    if tokio::fs::metadata(output).await?.len() == 0 {
        return Err(LibraryError::MediaTool(
            "ffmpeg produced an empty file".into(),
        ));
    }
    Ok(())
}

/// Writes `destination` through a temporary file beside it. The rename
/// replaces the file in one step, so readers see the old file or the new one,
/// and the old one stays intact when `write` fails.
pub(crate) async fn replace_with<T, F, Fut>(destination: &Path, write: F) -> Result<T>
where
    F: FnOnce(PathBuf) -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let temp = TempFile::beside(destination);
    let value = write(temp.path().to_path_buf()).await?;
    temp.persist(destination).await?;
    Ok(value)
}

/// A temporary file beside the one it will replace. It is deleted when
/// dropped, so a job that fails, is cancelled, or whose future is dropped
/// never strands it.
pub(crate) struct TempFile(Option<PathBuf>);

impl TempFile {
    /// A dot-prefixed name beside `output` that keeps its extension, so
    /// ffmpeg still picks the right muxer and folder sweeps skip it.
    pub(crate) fn beside(output: &Path) -> Self {
        let file_name = output
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("media");
        let (stem, extension) = file_name.rsplit_once('.').unwrap_or((file_name, "tmp"));
        Self(Some(output.with_file_name(format!(
            ".{stem}.{}.tmp.{extension}",
            Uuid::new_v4()
        ))))
    }

    pub(crate) fn path(&self) -> &Path {
        self.0.as_deref().unwrap_or(Path::new(""))
    }

    /// Replaces `destination` in one rename, which leaves the old file
    /// intact when it fails.
    pub(crate) async fn persist(mut self, destination: &Path) -> Result<()> {
        let Some(path) = self.0.take() else {
            return Err(LibraryError::InvalidPath);
        };
        if let Err(error) = tokio::fs::rename(&path, destination).await {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(error.into());
        }
        Ok(())
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Deletes the segments the recorder staged for `destination`, which it
/// names `.<clip>.partNN.mp4` beside the clip. Any other path a capture
/// lists is not the host's to delete.
async fn remove_staged_parts(destination: &Path, paths: &[String]) {
    let (Some(folder), Some(stem)) = (
        destination.parent(),
        destination.file_stem().and_then(|value| value.to_str()),
    ) else {
        return;
    };
    let prefix = format!(".{stem}.part");
    for path in paths {
        let part = Path::new(path);
        let staged = part.parent() == Some(folder)
            && part
                .file_name()
                .and_then(|value| value.to_str())
                .and_then(|name| name.strip_prefix(&prefix))
                .and_then(|rest| rest.strip_suffix(".mp4"))
                .is_some_and(|index| {
                    !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit())
                });
        if staged {
            let _ = tokio::fs::remove_file(part).await;
        }
    }
}

fn sanitize_segment(segment: Option<&ExportSegment>, duration_ms: u64) -> Result<ExportSegment> {
    let Some(segment) = segment else {
        return Err(LibraryError::InvalidExport("selection is empty".into()));
    };
    let start_ms = segment.start_ms.min(duration_ms);
    let end_ms = segment.end_ms.max(start_ms).min(duration_ms);
    if end_ms.saturating_sub(start_ms) < MIN_EXPORT_SEGMENT_MS {
        return Err(LibraryError::InvalidExport("selection is too short".into()));
    }
    Ok(ExportSegment { start_ms, end_ms })
}

fn format_seconds(value: u64) -> String {
    format!("{}.{:03}", value / 1_000, value % 1_000)
}

fn export_file_name(source: &str, segment: ExportSegment, full_source: bool) -> String {
    let path = Path::new(source);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("clip");
    if full_source {
        format!("{stem}.mp4")
    } else {
        format!(
            "{stem}-{}-{}.mp4",
            segment.start_ms / 1_000,
            segment.end_ms / 1_000
        )
    }
}
