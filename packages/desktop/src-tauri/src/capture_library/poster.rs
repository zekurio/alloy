//! Posters are the library's thumbnails: a JPEG of one representative frame
//! and the BlurHash shown while it loads. Videos and screenshots share this
//! one pipeline, so the grid, the editor and the upload queue all show the
//! same picture, and a video poster starts on the frame the server picks
//! after an upload.

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::task::JoinHandle;

use crate::capture_library::error::{LibraryError, Result};
use crate::capture_library::media::{TempFile, probe_file};
use crate::capture_library::paths::is_image;
use crate::capture_library::store::CaptureLibrary;
use crate::capture_library::work::Lane;

const POSTER_FILE: &str = "poster.jpg";
/// How long a new capture's announcement waits for its poster.
pub const POSTER_WAIT: Duration = Duration::from_secs(3);
const FRAME_TIMEOUT: Duration = Duration::from_secs(30);
/// Longest side of the frame the BlurHash and the blank-frame check read.
/// Matches `UNIFORM_IMAGE_SAMPLE_MAX_DIMENSION` in `@alloy/contracts`.
const SAMPLE_MAX_DIMENSION: u32 = 64;
/// A frame is blank when every channel stays within these bounds. Matches
/// `UNIFORM_IMAGE_*_THRESHOLD` in `@alloy/contracts` and the server poster.
const UNIFORM_CHANNEL_RANGE: u8 = 3;
const UNIFORM_CHANNEL_STDEV: f64 = 1.0;

/// Returns the capture's poster, creating it and recording its BlurHash in
/// the manifest when it is missing. Concurrent calls for one capture share a
/// single run.
pub async fn ensure_poster(library: &CaptureLibrary, id: &str) -> Result<PathBuf> {
    let _slot = library.work().exclusive(format!("poster:{id}")).await;
    // Manifest reads and writes block, so they run off the async workers
    // that also serve the loopback media routes.
    let (output, source) = off_worker(library, id, |library, id| {
        let output = library.thumbnail_path(id)?.join(POSTER_FILE);
        if output.is_file() && library.thumb_blur_hash(id).is_some() {
            return Ok((output, None));
        }
        Ok((output, Some(library.media_path(id)?)))
    })
    .await?;
    let Some(source) = source else {
        return Ok(output);
    };
    let blur_hash = render_poster(library, &source, &output).await?;
    off_worker(library, id, move |library, id| {
        library.remember_poster(id, &source, &blur_hash)
    })
    .await?;
    remove_stale_posters(&output).await;
    Ok(output)
}

/// Runs [`ensure_poster`] as its own task. A caller that stops waiting, such
/// as a thumbnail request the WebView drops when a card scrolls away, leaves
/// it running, so the work is not lost and no temporary file is stranded.
pub fn spawn_poster(library: &CaptureLibrary, id: &str) -> JoinHandle<Result<PathBuf>> {
    let library = library.clone();
    let id = id.to_string();
    tokio::spawn(async move {
        let result = ensure_poster(&library, &id).await;
        if let Err(error) = &result {
            log::warn!("could not create a poster for capture {id}: {error}");
        }
        result
    })
}

/// Gives a new capture's poster up to `wait`, so the library can show the
/// capture with its thumbnail and BlurHash from the first render. A slower
/// poster keeps rendering; the loopback server serves it once it is done.
pub async fn wait_for_poster(library: &CaptureLibrary, id: &str, wait: Duration) {
    let poster = spawn_poster(library, id);
    if !wait.is_zero() {
        let _ = tokio::time::timeout(wait, poster).await;
    }
}

async fn off_worker<T, F>(library: &CaptureLibrary, id: &str, run: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&CaptureLibrary, &str) -> Result<T> + Send + 'static,
{
    let library = library.clone();
    let id = id.to_string();
    tokio::task::spawn_blocking(move || run(&library, &id))
        .await
        .map_err(|error| LibraryError::Io(io::Error::other(error)))?
}

/// The poster file when it already exists. The loopback server answers from
/// this without reading the manifest and falls back to [`ensure_poster`].
pub fn existing_poster(library: &CaptureLibrary, id: &str) -> Option<PathBuf> {
    let output = library.thumbnail_path(id).ok()?.join(POSTER_FILE);
    output.is_file().then_some(output)
}

/// Writes the poster JPEG and returns its BlurHash.
async fn render_poster(library: &CaptureLibrary, source: &Path, output: &Path) -> Result<String> {
    let meta = probe_file(library, source).await?;
    let (Some(width), Some(height)) = (meta.width, meta.height) else {
        return Err(LibraryError::UnsupportedMedia);
    };
    if width == 0 || height == 0 {
        return Err(LibraryError::UnsupportedMedia);
    }
    tokio::fs::create_dir_all(output.parent().ok_or(LibraryError::InvalidPath)?).await?;
    let sample = sample_size(width, height);
    let candidates = if is_image(source) {
        vec![None]
    } else {
        candidate_times(meta.duration_ms.unwrap_or(0))
            .into_iter()
            .map(Some)
            .collect()
    };
    // Candidates render beside the poster and only the chosen one replaces
    // it, so a concurrent request never sees a frame that gets rejected.
    let mut blank: Option<(TempFile, Vec<u8>)> = None;
    let mut chosen = None;
    for at_ms in candidates {
        let temp = TempFile::beside(output);
        let pixels = grab_frame(library, source, temp.path(), at_ms, sample).await?;
        if !is_uniform(&pixels) {
            chosen = Some((temp, pixels));
            break;
        }
        // Keep the first blank frame: a recording that is black throughout
        // gets its opening frame as the poster rather than none.
        blank.get_or_insert((temp, pixels));
    }
    let (temp, pixels) = chosen.or(blank).ok_or(LibraryError::UnsupportedMedia)?;
    temp.persist(output).await?;
    encode_blur_hash(&pixels, sample, (width, height))
}

/// Seeks to `at_ms`, writes the frame as a JPEG to `jpeg`, and returns the
/// same frame scaled to `sample` as tightly packed RGBA.
async fn grab_frame(
    library: &CaptureLibrary,
    source: &Path,
    jpeg: &Path,
    at_ms: Option<u64>,
    sample: (u32, u32),
) -> Result<Vec<u8>> {
    let seek = at_ms.map(|value| format!("{}.{:03}", value / 1_000, value % 1_000));
    let source_text = source.to_string_lossy().into_owned();
    let jpeg_text = jpeg.to_string_lossy().into_owned();
    let filter = format!(
        "[0:v:0]split=2[poster][sample];\
         [poster]scale='min(1280,iw)':-2:out_range=full[jpeg];\
         [sample]scale={}:{},format=rgba[raw]",
        sample.0, sample.1
    );
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
    ];
    // Seeking before the input uses the fast keyframe seek, which stays
    // quick on long, high-bitrate recordings.
    if let Some(seek) = seek.as_deref() {
        args.extend(["-ss", seek]);
    }
    args.extend([
        "-i",
        &source_text,
        "-filter_complex",
        &filter,
        "-map",
        "[jpeg]",
        "-frames:v",
        "1",
        "-pix_fmt",
        "yuvj420p",
        "-q:v",
        "3",
        "-f",
        "image2",
        "-y",
        &jpeg_text,
        "-map",
        "[raw]",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "pipe:1",
    ]);
    let output = library
        .work()
        .ffmpeg(Lane::Light, &args, FRAME_TIMEOUT)
        .await?;
    let expected = sample.0 as usize * sample.1 as usize * 4;
    if output.stdout.len() != expected || tokio::fs::metadata(jpeg).await?.len() == 0 {
        return Err(LibraryError::MediaTool(
            "ffmpeg did not produce a poster frame".into(),
        ));
    }
    Ok(output.stdout)
}

/// The opening frame first: it is the frame playback reveals, so any later
/// candidate makes the poster and the starting picture two different images.
/// The rest are fallbacks for recordings that open on a blank frame. Mirrors
/// the server's poster candidates.
fn candidate_times(duration_ms: u64) -> Vec<u64> {
    let duration = duration_ms as f64;
    let max_ms = duration_ms.saturating_sub(50);
    let mut times = Vec::new();
    for value in [
        0.0,
        100.0,
        (duration - 100.0).min(1_000.0),
        duration * 0.1,
        duration * 0.5,
    ] {
        let clamped = (value.max(0.0).round() as u64).min(max_ms);
        if !times.contains(&clamped) {
            times.push(clamped);
        }
    }
    times
}

fn sample_size(width: u32, height: u32) -> (u32, u32) {
    let scale = f64::from(SAMPLE_MAX_DIMENSION) / f64::from(width.max(height));
    let scale = scale.min(1.0);
    (
        ((f64::from(width) * scale).round() as u32).max(1),
        ((f64::from(height) * scale).round() as u32).max(1),
    )
}

fn is_uniform(rgba: &[u8]) -> bool {
    let pixels = rgba.len() / 4;
    if pixels <= 1 {
        return true;
    }
    (0..3).all(|channel| {
        let values = rgba.as_chunks::<4>().0.iter().map(|pixel| pixel[channel]);
        let (min, max) = values
            .clone()
            .fold((u8::MAX, u8::MIN), |(min, max), value| {
                (min.min(value), max.max(value))
            });
        let mean = values.clone().map(f64::from).sum::<f64>() / pixels as f64;
        let variance = values
            .map(|value| (f64::from(value) - mean).powi(2))
            .sum::<f64>()
            / pixels as f64;
        max - min <= UNIFORM_CHANNEL_RANGE && variance.sqrt() <= UNIFORM_CHANNEL_STDEV
    })
}

/// Encodes with the component counts `blurHashComponents` in
/// `@alloy/contracts` picks for the capture's aspect ratio, the same counts
/// the server uses, so a clip's placeholder keeps its shape after upload.
fn encode_blur_hash(rgba: &[u8], sample: (u32, u32), source: (u32, u32)) -> Result<String> {
    let (x, y) = blur_hash_components(source.0, source.1);
    blurhash::encode(x, y, sample.0, sample.1, rgba)
        .map_err(|error| LibraryError::MediaTool(format!("could not encode BlurHash: {error}")))
}

fn blur_hash_components(width: u32, height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (1, 1);
    }
    let x = (16.0 * f64::from(width) / f64::from(height)).sqrt();
    let y = x * f64::from(height) / f64::from(width);
    let clamp = |value: f64| (value.floor() as u32 + 1).clamp(1, 9);
    (clamp(x), clamp(y))
}

/// Drops thumbnails older builds left beside the poster.
async fn remove_stale_posters(output: &Path) {
    let Some(folder) = output.parent() else {
        return;
    };
    let Ok(mut entries) = tokio::fs::read_dir(folder).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        // Dot-prefixed files are posters still being written.
        if name == POSTER_FILE || name.to_string_lossy().starts_with('.') {
            continue;
        }
        if entry.file_type().await.is_ok_and(|kind| kind.is_file()) {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}
