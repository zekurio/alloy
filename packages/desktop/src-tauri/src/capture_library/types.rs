use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

/// The capture shapes the recorder defines. They cross the sidecar pipe, the
/// manifest and the renderer bridge unchanged, so the library stores exactly
/// what the recorder sent instead of a second copy that can drift.
pub use alloy_recorder::types::{
    RecordingCapture as CaptureRecord, RecordingCaptureKind as CaptureKind,
    RecordingCapturePostProcess as PostProcess, RecordingCaptureSource as CaptureSource,
    RecordingGame as CaptureGame, RecordingGameGuess as GameGuess,
    RecordingGameGuessMatchKind as GameGuessMatchKind, RecordingGameGuessSource as GameGuessSource,
};

/// The output subfolder a capture kind lives in. The recorder chooses these
/// names when it writes a capture; the library scans and reports the same two.
pub fn collection_for(kind: CaptureKind) -> &'static str {
    match kind {
        CaptureKind::Replay => "Clips",
        CaptureKind::Screenshot => "Screenshots",
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMention {
    pub id: String,
    pub username: String,
    pub image: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    pub filename: String,
    pub title: String,
    pub kind: CaptureKind,
    pub source: CaptureSource,
    pub game_name: Option<String>,
    pub game_icon_url: Option<String>,
    pub game_guess: Option<GameGuess>,
    pub size_bytes: Option<u64>,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
    pub description: Option<String>,
    pub tags: Option<String>,
    #[serde(default)]
    pub mentions: Vec<CaptureMention>,
    pub privacy: Option<String>,
    pub uploaded_clip_id: Option<String>,
    pub uploaded_clip_source_start_ms: Option<u64>,
    pub uploaded_clip_source_duration_ms: Option<u64>,
    pub trim_start_ms: Option<u64>,
    pub trim_end_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureManifest {
    pub version: u8,
    #[serde(default)]
    pub captures: BTreeMap<String, ManifestEntry>,
}

impl Default for CaptureManifest {
    fn default() -> Self {
        Self {
            version: 2,
            captures: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub file_name: String,
    pub media_url: String,
    pub thumbnail_url: Option<String>,
    pub thumb_blur_hash: Option<String>,
    pub collection: String,
    pub kind: CaptureKind,
    pub source: CaptureSource,
    pub group_key: String,
    pub group_label: String,
    pub game_name: Option<String>,
    pub game_icon_url: Option<String>,
    pub game_guess: Option<GameGuess>,
    pub size_bytes: u64,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub description: Option<String>,
    pub tags: Option<String>,
    #[serde(default)]
    pub mentions: Vec<CaptureMention>,
    pub privacy: Option<String>,
    pub uploaded_clip_id: Option<String>,
    pub uploaded_clip_source_start_ms: Option<u64>,
    pub uploaded_clip_source_duration_ms: Option<u64>,
    pub trim_start_ms: Option<u64>,
    pub trim_end_ms: Option<u64>,
    pub created_at: String,
    pub modified_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryGroup {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub icon_url: Option<String>,
    pub total_count: usize,
    pub clip_count: usize,
    pub total_size_bytes: u64,
    pub latest_at: String,
    pub items: Vec<LibraryItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub output_folder: String,
    pub scanned_at: String,
    pub total_count: usize,
    pub total_size_bytes: u64,
    pub items: Vec<LibraryItem>,
    pub groups: Vec<LibraryGroup>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPatch {
    pub id: String,
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub game_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub game_icon_url: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub game_guess: Option<Option<GameGuess>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub tags: Option<Option<String>>,
    pub mentions: Option<Vec<CaptureMention>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub privacy: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub uploaded_clip_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub uploaded_clip_source_start_ms: Option<Option<u64>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub uploaded_clip_source_duration_ms: Option<Option<u64>>,
}

fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimUpdate {
    pub id: String,
    pub trim_start_ms: Option<u64>,
    pub trim_end_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSegment {
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub id: String,
    pub segments: Vec<ExportSegment>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryExport {
    pub id: String,
    pub media_url: String,
    pub file_name: String,
    pub content_type: String,
    pub size_bytes: u64,
    pub duration_ms: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub start_offset_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedImport {
    pub id: String,
    pub file_name: String,
    pub title: String,
    pub size_bytes: u64,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub file_name: String,
    pub error: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesImportResult {
    pub staged: Vec<StagedImport>,
    pub failed: Vec<ImportFailure>,
    pub canceled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitImport {
    pub id: String,
    pub title: String,
    pub game_name: Option<String>,
    pub game_icon_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub clip_id: String,
    pub title: String,
    pub size_bytes: Option<u64>,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub game_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Downloading,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadState {
    pub clip_id: String,
    pub title: String,
    pub status: DownloadStatus,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
    pub library_item_id: Option<String>,
    pub started_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeta {
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}
