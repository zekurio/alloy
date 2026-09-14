use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use alloy_recorder::protocol::CONTENT_TYPE_MP4;
use serde::Deserialize;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

use crate::capture_library::error::{LibraryError, Result};
use crate::capture_library::paths::{extension, now_rfc3339};
use crate::capture_library::store::{
    CaptureLibrary, ensure_media_in_output, ensure_media_location,
};
use crate::capture_library::types::{ExportRequest, LibraryExport, PostProcess, VideoMeta};

/// Windows process creation flag that suppresses a console window for the child.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MEDIA_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_TOOL_OUTPUT: usize = 2 * 1024 * 1024;
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

pub async fn probe_file(ffprobe: &Path, path: &Path) -> Result<VideoMeta> {
    let output = run_tool(
        ffprobe,
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
    parse_probe_output(output.stdout)
}

fn parse_probe_output(output: Vec<u8>) -> Result<VideoMeta> {
    let parsed: ProbeOutput = serde_json::from_slice(&output)
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
    Ok(VideoMeta {
        duration_ms,
        width: video.and_then(|value| value.width),
        height: video.and_then(|value| value.height),
    })
}

pub async fn assert_upload_mp4(library: &CaptureLibrary, path: &Path) -> Result<()> {
    if extension(path).as_deref() != Some("mp4") {
        return Err(LibraryError::UnsupportedMedia);
    }
    let output = run_tool_for_library(
        library,
        &library.config().ffprobe,
        &[
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            &path.to_string_lossy(),
        ],
        PROBE_TIMEOUT,
    )
    .await?;
    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|_| LibraryError::MediaTool("ffprobe returned invalid JSON".into()))?;
    let Some(video) = parsed
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
    else {
        return Err(LibraryError::MediaTool("MP4 has no video track".into()));
    };
    if !matches!(video.codec_name.as_deref(), Some("h264" | "hevc" | "av1")) {
        return Err(LibraryError::MediaTool(
            "Only H.264, HEVC, or AV1 video can be uploaded".into(),
        ));
    }
    if parsed.streams.iter().any(|stream| {
        stream.codec_type.as_deref() == Some("audio")
            && !matches!(stream.codec_name.as_deref(), Some("aac"))
    }) {
        return Err(LibraryError::MediaTool(
            "Only AAC audio can be uploaded".into(),
        ));
    }
    Ok(())
}

pub async fn export(library: &CaptureLibrary, request: ExportRequest) -> Result<LibraryExport> {
    let item = library
        .find_item(&request.id)
        .ok_or(LibraryError::CaptureNotFound)?;
    let source = PathBuf::from(&item.filename);
    let source_duration = match item.duration_ms {
        Some(value) => value,
        None => probe_file_for_library(library, &source)
            .await?
            .duration_ms
            .ok_or_else(|| LibraryError::InvalidExport("capture has no duration".into()))?,
    };
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
    let export_key = format!(
        "export:{}:{}:{}:{}",
        item.filename, item.modified_at, segment.start_ms, segment.end_ms
    );
    let export_id = crate::capture_library::paths::capture_id(export_key.as_str());
    let output = library.export_path(&export_id)?;
    tokio::fs::create_dir_all(output.parent().ok_or(LibraryError::InvalidPath)?).await?;
    let mut start_offset_ms = 0;
    if full_source && extension(&source).as_deref() == Some("mp4") {
        assert_upload_mp4(library, &source).await?;
        if !output.exists() {
            let temp = temporary_media_path(&output);
            let result = tokio::fs::copy(&source, &temp).await;
            if let Err(error) = result {
                let _ = tokio::fs::remove_file(&temp).await;
                return Err(error.into());
            }
            if let Err(error) = atomic_replace(&temp, &output).await {
                let _ = tokio::fs::remove_file(&temp).await;
                return Err(error);
            }
        }
    } else if !output.exists() || tokio::fs::metadata(&output).await?.len() == 0 {
        let temp = temporary_media_path(&output);
        let result = if full_source {
            transcode_range(library, &source, &temp, 0, source_duration).await
        } else {
            transcode_range(library, &source, &temp, segment.start_ms, segment.end_ms).await
        };
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
        if let Err(error) = atomic_replace(&temp, &output).await {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
    } else if !full_source {
        // This implementation transcodes exact cuts, so no keyframe offset is
        // needed when a cached export is reused.
        start_offset_ms = 0;
    }
    let size_bytes = tokio::fs::metadata(&output).await?.len();
    Ok(LibraryExport {
        id: export_id.clone(),
        media_url: format!("alloy-capture://export/{export_id}"),
        file_name: export_file_name(&item.file_name, segment, full_source),
        content_type: CONTENT_TYPE_MP4.to_string(),
        size_bytes,
        duration_ms: total_ms,
        width: item.width,
        height: item.height,
        start_offset_ms,
    })
}

pub async fn finalize_capture(
    library: &CaptureLibrary,
    filename: &Path,
    post_process: &PostProcess,
) -> Result<()> {
    let filename = ensure_media_location(library.output_folder(), filename)?;
    let temp = match post_process {
        PostProcess::TrimTail { .. } => filename.with_extension("trim.tmp.mp4"),
        PostProcess::ConcatSegments { .. } => filename.with_extension("concat.tmp.mp4"),
    };
    let result = match post_process {
        PostProcess::TrimTail { keep_ms } => trim_tail(library, &filename, &temp, *keep_ms).await,
        PostProcess::ConcatSegments { segment_paths } => {
            concat_segments(library, segment_paths, &temp).await
        }
    };
    match result {
        Ok(true) => {
            atomic_replace(&temp, &filename).await?;
            if let PostProcess::ConcatSegments { segment_paths } = post_process {
                remove_segments_except(segment_paths, &filename).await;
            }
            Ok(())
        }
        Ok(false) => {
            let _ = tokio::fs::remove_file(&temp).await;
            Ok(())
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp).await;
            // Keep the original destination and every concat source so a
            // recorder can retry after a transient ffmpeg failure.
            Err(error)
        }
    }
}

async fn trim_tail(
    library: &CaptureLibrary,
    source: &Path,
    output: &Path,
    keep_ms: u64,
) -> Result<bool> {
    let meta = probe_file_for_library(library, source).await?;
    let duration = meta
        .duration_ms
        .ok_or_else(|| LibraryError::MediaTool("could not probe trim source".into()))?;
    if duration <= keep_ms {
        return Ok(false);
    }
    transcode_range(library, source, output, duration - keep_ms, duration).await?;
    Ok(true)
}

async fn concat_segments(
    library: &CaptureLibrary,
    segment_paths: &[String],
    output: &Path,
) -> Result<bool> {
    if segment_paths.is_empty() {
        return Ok(false);
    }
    let list = output.with_extension("concat.txt");
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
    tokio::fs::write(&list, contents).await?;
    let result = run_tool_for_library(
        library,
        &library.config().ffmpeg,
        &[
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
            &list.to_string_lossy(),
            "-map",
            "0:v:0?",
            "-map",
            "0:a?",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-y",
            &output.to_string_lossy(),
        ],
        MEDIA_TIMEOUT,
    )
    .await;
    let _ = tokio::fs::remove_file(list).await;
    result.map(|_| true)
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
    let output = output.to_path_buf();
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
    run_tool_for_library(library, &library.config().ffmpeg, &args, MEDIA_TIMEOUT).await?;
    let metadata = tokio::fs::metadata(&output).await?;
    if metadata.len() == 0 {
        return Err(LibraryError::MediaTool(
            "ffmpeg produced an empty file".into(),
        ));
    }
    Ok(())
}

async fn run_tool(path: &Path, args: &[&str], limit: Duration) -> Result<ToolOutput> {
    let mut command = Command::new(path);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Media tools are console programs; without this flag a GUI-subsystem
    // parent such as the packaged desktop app gets a console window flashed
    // on screen for every ffmpeg/ffprobe run.
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| {
        LibraryError::MediaTool(format!("could not start {}: {error}", path.display()))
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| LibraryError::MediaTool("media tool stdout was not captured".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| LibraryError::MediaTool("media tool stderr was not captured".into()))?;
    let stdout_task = tokio::spawn(read_limited(stdout));
    let stderr_task = tokio::spawn(read_limited(stderr));
    let result = timeout(limit, async {
        let (status, stdout, stderr) = tokio::try_join!(
            child.wait(),
            async {
                stdout_task
                    .await
                    .map_err(|error| io::Error::other(error.to_string()))?
            },
            async {
                stderr_task
                    .await
                    .map_err(|error| io::Error::other(error.to_string()))?
            },
        )?;
        Ok::<_, io::Error>((status, stdout, stderr))
    })
    .await;
    let (status, stdout, stderr) = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            let _ = child.kill().await;
            return Err(
                if error.kind() == io::ErrorKind::Other
                    && error.to_string().contains("output limit")
                {
                    LibraryError::MediaTool("tool output is too large".into())
                } else {
                    LibraryError::MediaTool(error.to_string())
                },
            );
        }
        Err(_) => {
            let _ = child.kill().await;
            return Err(LibraryError::MediaToolTimeout);
        }
    };
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(LibraryError::MediaTool(if detail.is_empty() {
            format!("{} exited with {status}", path.display())
        } else {
            detail.chars().take(1_000).collect()
        }));
    }
    Ok(ToolOutput { stdout })
}

pub(crate) async fn probe_file_for_library(
    library: &CaptureLibrary,
    path: &Path,
) -> Result<VideoMeta> {
    let output = run_tool_for_library(
        library,
        &library.config().ffprobe,
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
    parse_probe_output(output.stdout)
}

async fn run_tool_for_library(
    library: &CaptureLibrary,
    path: &Path,
    args: &[&str],
    limit: Duration,
) -> Result<ToolOutput> {
    let _activity = library.begin_media();
    let cancellation = library.media_cancellation();
    tokio::select! {
        _ = cancellation.cancelled() => Err(LibraryError::MediaCancelled),
        result = run_tool(path, args, limit) => result,
    }
}

async fn read_limited<R>(mut reader: R) -> io::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut chunk = [0_u8; 16 * 1024];
    loop {
        let count = reader.read(&mut chunk).await?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > MAX_TOOL_OUTPUT {
            return Err(io::Error::other("tool output limit exceeded"));
        }
        output.extend_from_slice(&chunk[..count]);
    }
}

struct ToolOutput {
    stdout: Vec<u8>,
}

async fn atomic_replace(source: &Path, destination: &Path) -> Result<()> {
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // Temporary files are written beside the destination. Rename replaces the
    // file in one operation and leaves the original intact if replacement fails.
    tokio::fs::rename(source, destination).await?;
    Ok(())
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

fn sanitize_segment(
    segment: Option<&crate::capture_library::types::ExportSegment>,
    duration_ms: u64,
) -> Result<crate::capture_library::types::ExportSegment> {
    let Some(segment) = segment else {
        return Err(LibraryError::InvalidExport("selection is empty".into()));
    };
    let start_ms = segment.start_ms.min(duration_ms);
    let end_ms = segment.end_ms.max(start_ms).min(duration_ms);
    if end_ms.saturating_sub(start_ms) < MIN_EXPORT_SEGMENT_MS {
        return Err(LibraryError::InvalidExport("selection is too short".into()));
    }
    Ok(crate::capture_library::types::ExportSegment { start_ms, end_ms })
}

fn format_seconds(value: u64) -> String {
    format!("{}.{:03}", value / 1_000, value % 1_000)
}

fn temporary_media_path(output: &Path) -> PathBuf {
    let file_name = output
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("export.mp4");
    let stem = file_name.strip_suffix(".mp4").unwrap_or(file_name);
    output.with_file_name(format!(".{stem}.{}.tmp.mp4", Uuid::new_v4()))
}

fn export_file_name(
    source: &str,
    segment: crate::capture_library::types::ExportSegment,
    full_source: bool,
) -> String {
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

pub async fn finalize_capture_record(
    library: &CaptureLibrary,
    capture: &mut crate::capture_library::types::CaptureRecord,
) -> Result<()> {
    let Some(post_process) = capture.post_process.clone() else {
        return Ok(());
    };
    let filename = PathBuf::from(&capture.filename);
    let result = finalize_capture(library, &filename, &post_process).await;
    if result.is_ok() {
        capture.post_process = None;
        capture.size_bytes = tokio::fs::metadata(&filename)
            .await
            .ok()
            .map(|value| value.len());
        capture.duration_ms = probe_file_for_library(library, &filename)
            .await
            .ok()
            .and_then(|value| value.duration_ms)
            .or(capture.duration_ms);
    }
    result
}

/// Creates and caches a JPEG poster for a video. The source file remains
/// untouched when ffmpeg fails, and an existing poster is reused by the HTTP
/// layer before this function is called.
pub async fn generate_thumbnail(
    library: &CaptureLibrary,
    id: &str,
    source: &Path,
) -> Result<PathBuf> {
    let source = ensure_media_in_output(library.output_folder(), source)?;
    if !source.is_file() || !crate::capture_library::paths::is_video(&source) {
        return Err(LibraryError::UnsupportedMedia);
    }
    let folder = library.thumbnail_path(id)?;
    tokio::fs::create_dir_all(&folder).await?;
    let output = folder.join("generated.jpg");
    let temp = folder.join(format!(".generated.{}.tmp", Uuid::new_v4()));
    let source_text = source.to_string_lossy().into_owned();
    let temp_text = temp.to_string_lossy().into_owned();
    let args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        "0",
        "-i",
        &source_text,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(1280,iw)':-2:out_range=full",
        "-pix_fmt",
        "yuvj420p",
        "-q:v",
        "3",
        "-f",
        "image2",
        "-y",
        &temp_text,
    ];
    match run_tool_for_library(library, &library.config().ffmpeg, &args, PROBE_TIMEOUT).await {
        Ok(_) => {
            atomic_replace(&temp, &output).await?;
            Ok(output.canonicalize()?)
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp).await;
            Err(error)
        }
    }
}

pub fn generated_media_name(path: &Path) -> String {
    format!(
        "{}-{}.mp4",
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("clip"),
        now_rfc3339().replace(':', "-")
    )
}
