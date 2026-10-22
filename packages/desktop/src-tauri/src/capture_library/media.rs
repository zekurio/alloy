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
    CaptureRecord, ExportRequest, ExportSegment, LibraryExport, PostProcess, VideoMeta,
};
use crate::capture_library::work::Lane;

pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MEDIA_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MIN_EXPORT_SEGMENT_MS: u64 = 100;
const MIN_EXPORT_TOTAL_MS: u64 = 1_000;

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    format: Option<ProbeFormat>,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

/// What one ffprobe run reports about a capture.
struct ProbedMedia {
    meta: VideoMeta,
    video_codec: Option<String>,
    audio_codecs: Vec<String>,
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
    })
}

/// The server accepts MP4 with H.264, HEVC, or AV1 video and AAC audio. A
/// capture that already matches uploads as it is.
fn ensure_uploadable_mp4(path: &Path, probed: &ProbedMedia) -> Result<()> {
    if extension(path).as_deref() != Some("mp4") {
        return Err(LibraryError::UnsupportedMedia);
    }
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

/// Produces the file a publish uploads. A selection that covers the whole
/// capture uploads the capture itself; anything shorter is rendered into the
/// export cache.
pub async fn export(library: &CaptureLibrary, request: ExportRequest) -> Result<LibraryExport> {
    let item = library
        .find_item(&request.id)
        .ok_or(LibraryError::CaptureNotFound)?;
    let source = PathBuf::from(&item.filename);
    let probed = probe_media(library, &source).await?;
    let source_duration = item
        .duration_ms
        .or(probed.meta.duration_ms)
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
        library.replace_exports(&item.id, None)?;
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
            width: item.width,
            height: item.height,
            source_start_ms: 0,
            source_end_ms: source_duration,
            whole_capture: true,
        });
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
                transcode_range(library, &source, &temp, source_start_ms, source_end_ms).await
            })
            .await?;
        }
    }
    // The editor only ever plays the export it just asked for, so the capture
    // keeps one render instead of one per trim the user tried.
    library.replace_exports(&item.id, Some(&export_id))?;
    let size_bytes = tokio::fs::metadata(&output).await?.len();
    Ok(LibraryExport {
        id: export_id,
        // The host fills this from its loopback file server.
        media_url: String::new(),
        file_name: export_file_name(&item.file_name, segment, full_source),
        content_type: CONTENT_TYPE_MP4.to_string(),
        size_bytes,
        duration_ms: source_end_ms - source_start_ms,
        width: item.width,
        height: item.height,
        source_start_ms,
        source_end_ms,
        whole_capture: false,
    })
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
            concat_segments(library, segment_paths, &filename).await?;
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

async fn trim_tail(library: &CaptureLibrary, source: &Path, keep_ms: u64) -> Result<()> {
    let meta = probe_file(library, source).await?;
    let duration = meta
        .duration_ms
        .ok_or_else(|| LibraryError::MediaTool("could not probe trim source".into()))?;
    if duration <= keep_ms {
        return Ok(());
    }
    replace_with(source, |temp| async move {
        transcode_range(library, source, &temp, duration - keep_ms, duration).await
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
    let list = output.with_extension("concat.txt");
    tokio::fs::write(&list, contents).await?;
    let list_text = list.to_string_lossy().into_owned();
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
            .ffmpeg(Lane::Heavy, &args, MEDIA_TIMEOUT)
            .await
            .map(|_| ())
    })
    .await;
    let _ = tokio::fs::remove_file(&list).await;
    result?;
    remove_segments_except(segment_paths, output).await;
    Ok(())
}

async fn transcode_range(
    library: &CaptureLibrary,
    source: &Path,
    output: &Path,
    start_ms: u64,
    end_ms: u64,
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
    library
        .work()
        .ffmpeg(Lane::Heavy, &args, MEDIA_TIMEOUT)
        .await?;
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
    let temp = temporary_path(destination);
    let result = match write(temp.clone()).await {
        Ok(value) => tokio::fs::rename(&temp, destination)
            .await
            .map(|()| value)
            .map_err(LibraryError::from),
        Err(error) => Err(error),
    };
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
    }
    result
}

/// A dot-prefixed name beside `output` that keeps its extension, so ffmpeg
/// still picks the right muxer and folder sweeps can skip work in flight.
pub(crate) fn temporary_path(output: &Path) -> PathBuf {
    let file_name = output
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let (stem, extension) = file_name.rsplit_once('.').unwrap_or((file_name, "tmp"));
    output.with_file_name(format!(".{stem}.{}.tmp.{extension}", Uuid::new_v4()))
}

async fn remove_segments_except(paths: &[String], keep: &Path) {
    let keep = keep.canonicalize().ok();
    for path in paths {
        let candidate = Path::new(path);
        if keep
            .as_ref()
            .zip(candidate.canonicalize().ok().as_ref())
            .is_some_and(|(keep, candidate)| keep == candidate)
        {
            continue;
        }
        let _ = tokio::fs::remove_file(candidate).await;
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
