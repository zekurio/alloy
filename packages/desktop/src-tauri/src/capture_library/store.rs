use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::capture_library::error::{LibraryError, Result};
use crate::capture_library::media::probe_file_for_library;
use crate::capture_library::paths::{
    capture_id, ensure_within, extension, is_image, is_media, manifest_key, now_rfc3339,
    safe_component, safe_file_stem, title_for_capture, unique_path,
};
use crate::capture_library::types::{
    CaptureKind, CaptureManifest, CaptureRecord, CaptureSource, CommitImport, FilesImportResult,
    GameGuess, ImportFailure, LibraryGroup, LibraryItem, LibrarySnapshot, ManifestEntry, MetaPatch,
    StagedImport, TrimUpdate, collection_for,
};

const MANIFEST_VERSION: u8 = 2;
const MAX_MANIFEST_BYTES: usize = 64 * 1024 * 1024;
const MAX_MANIFEST_ENTRIES: usize = 100_000;
const MAX_TITLE_LENGTH: usize = 256;
const MAX_DESCRIPTION_LENGTH: usize = 20_000;
const MAX_TAGS_LENGTH: usize = 4_000;
const MAX_MENTIONS: usize = 100;
const MAX_STAGED_IMPORT_AGE: Duration = Duration::from_secs(24 * 60 * 60);

static MANIFEST_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct CaptureLibraryConfig {
    pub output_folder: PathBuf,
    /// Holds the manifest with titles, trims and upload links.
    pub user_data_folder: PathBuf,
    /// Holds regenerable files: import staging, thumbnails and export renders.
    pub cache_folder: PathBuf,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub max_download_bytes: u64,
}

impl CaptureLibraryConfig {
    pub fn new(
        output_folder: impl Into<PathBuf>,
        user_data_folder: impl Into<PathBuf>,
        cache_folder: impl Into<PathBuf>,
        ffmpeg: impl Into<PathBuf>,
        ffprobe: impl Into<PathBuf>,
    ) -> Self {
        Self {
            output_folder: output_folder.into(),
            user_data_folder: user_data_folder.into(),
            cache_folder: cache_folder.into(),
            ffmpeg: ffmpeg.into(),
            ffprobe: ffprobe.into(),
            max_download_bytes: 8 * 1024 * 1024 * 1024,
        }
    }

    fn manifest_path(&self) -> PathBuf {
        self.user_data_folder.join("recording-library.json")
    }

    fn imports_folder(&self) -> PathBuf {
        self.cache_folder.join("recording-library-imports")
    }

    fn thumbnails_folder(&self) -> PathBuf {
        self.cache_folder.join("recording-thumbnails")
    }

    fn exports_folder(&self) -> PathBuf {
        self.cache_folder.join("recording-exports")
    }
}

#[derive(Clone)]
pub struct CaptureLibrary {
    inner: Arc<LibraryInner>,
}

struct LibraryInner {
    config: CaptureLibraryConfig,
    manifest_lock: Arc<Mutex<()>>,
    staged: Mutex<HashMap<String, StagedInternal>>,
    media_cancel: CancellationToken,
    media_active: AtomicUsize,
    media_idle: Notify,
}

pub(crate) struct MediaActivity {
    inner: Arc<LibraryInner>,
}

impl Drop for MediaActivity {
    fn drop(&mut self) {
        if self.inner.media_active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.inner.media_idle.notify_waiters();
        }
    }
}

#[derive(Clone, Debug)]
struct StagedInternal {
    id: String,
    staged_path: PathBuf,
    file_name: String,
    extension: String,
    title: String,
    size_bytes: u64,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    created_at: String,
}

impl CaptureLibrary {
    pub fn new(config: CaptureLibraryConfig) -> Result<Self> {
        fs::create_dir_all(&config.output_folder)?;
        fs::create_dir_all(&config.user_data_folder)?;
        fs::create_dir_all(&config.cache_folder)?;
        let manifest_lock = manifest_lock_for(&config.manifest_path());
        let library = Self {
            inner: Arc::new(LibraryInner {
                config,
                manifest_lock,
                staged: Mutex::new(HashMap::new()),
                media_cancel: CancellationToken::new(),
                media_active: AtomicUsize::new(0),
                media_idle: Notify::new(),
            }),
        };
        Ok(library)
    }

    /// Drops thumbnail and export folders whose capture no longer exists in
    /// the output folder or the manifest. The cache is shared by every output
    /// folder and the files are regenerable, so the host runs this once at
    /// startup in the background, not on every open or on a timer.
    pub fn remove_orphan_cache_folders(&self) {
        let mut known: std::collections::HashSet<String> = self
            .read_manifest()
            .captures
            .into_values()
            .map(|entry| entry.id)
            .collect();
        // A failed scan says nothing about which captures exist, so keep every
        // cache folder rather than deleting the whole cache.
        let Ok(snapshot) = self.snapshot() else {
            return;
        };
        known.extend(snapshot.items.into_iter().map(|item| item.id));
        for root in [
            self.inner.config.thumbnails_folder(),
            self.inner.config.exports_folder(),
        ] {
            let Ok(entries) = fs::read_dir(&root) else {
                continue;
            };
            for entry in entries.flatten() {
                let Some(id) = entry.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                if known.contains(&id) || !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    continue;
                }
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }

    pub fn config(&self) -> &CaptureLibraryConfig {
        &self.inner.config
    }

    pub fn output_folder(&self) -> &Path {
        &self.inner.config.output_folder
    }

    /// Requests cancellation of all ffmpeg and ffprobe work for this library.
    /// A library is not reusable after this call; the shell creates a new one
    /// when it changes the output folder or starts a new session.
    pub fn cancel_media(&self) {
        self.inner.media_cancel.cancel();
    }

    /// Cancels media work and waits until every child process has been
    /// released. This is intended for an orderly application shutdown.
    pub async fn shutdown_media(&self) {
        self.cancel_media();
        loop {
            if self.inner.media_active.load(Ordering::Acquire) == 0 {
                return;
            }
            let notified = self.inner.media_idle.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.inner.media_active.load(Ordering::Acquire) == 0 {
                return;
            }
            notified.await;
        }
    }

    pub(crate) fn begin_media(&self) -> MediaActivity {
        self.inner.media_active.fetch_add(1, Ordering::AcqRel);
        MediaActivity {
            inner: Arc::clone(&self.inner),
        }
    }

    pub(crate) fn media_cancellation(&self) -> CancellationToken {
        self.inner.media_cancel.clone()
    }

    pub fn media_path(&self, id: &str) -> Result<PathBuf> {
        self.find_media_path(id)
            .ok_or(LibraryError::CaptureNotFound)
    }

    /// Where an export render for a capture is written. Every export of one
    /// capture shares a folder named after the capture, so a new render can
    /// replace the older ones and deleting the capture drops them all.
    pub fn export_path(&self, capture_id: &str, export_id: &str) -> Result<PathBuf> {
        if !is_capture_id(export_id) {
            return Err(LibraryError::InvalidPath);
        }
        let root = self.exports_folder_for(capture_id)?;
        ensure_within(&root, &root.join(export_id).with_extension("mp4"))
    }

    /// Resolves an export id for the loopback file server, which is handed the
    /// export id alone. Only the capture folders below the exports folder are
    /// searched, so no other file can be reached through this route.
    pub fn find_export_path(&self, export_id: &str) -> Result<PathBuf> {
        if !is_capture_id(export_id) {
            return Err(LibraryError::InvalidPath);
        }
        let root = self.inner.config.exports_folder().canonicalize()?;
        let file_name = format!("{export_id}.mp4");
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let Ok(candidate) = entry.path().join(&file_name).canonicalize() else {
                continue;
            };
            if candidate.is_file() && candidate.starts_with(&root) {
                return Ok(candidate);
            }
        }
        Err(LibraryError::CaptureNotFound)
    }

    /// Keeps only the named render among a capture's exports. Older renders
    /// are unreachable once the editor has a newer one, and every export is
    /// reproducible from the capture.
    pub(crate) fn replace_exports(&self, capture_id: &str, export_id: &str) -> Result<()> {
        let keep = self
            .export_path(capture_id, export_id)?
            .file_name()
            .ok_or(LibraryError::InvalidPath)?
            .to_os_string();
        for entry in fs::read_dir(self.exports_folder_for(capture_id)?)? {
            let entry = entry?;
            let name = entry.file_name();
            // Renders in flight are written to a dot-prefixed temporary file
            // beside the destination; leave a concurrent export its own.
            if name == keep || name.to_string_lossy().starts_with('.') {
                continue;
            }
            if entry.file_type()?.is_file() {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(())
    }

    fn exports_folder_for(&self, capture_id: &str) -> Result<PathBuf> {
        if !is_capture_id(capture_id) {
            return Err(LibraryError::InvalidPath);
        }
        let root = self.inner.config.exports_folder();
        ensure_within(&root, &root.join(capture_id))
    }

    pub fn thumbnail_path(&self, id: &str) -> Result<PathBuf> {
        if !is_capture_id(id) {
            return Err(LibraryError::InvalidPath);
        }
        let root = self.inner.config.thumbnails_folder();
        fs::create_dir_all(&root)?;
        let folder = ensure_within(&root, &root.join(id))?;
        let root = root.canonicalize()?;
        if folder.exists() && !folder.canonicalize()?.starts_with(&root) {
            return Err(LibraryError::InvalidPath);
        }
        Ok(folder)
    }

    pub fn read_manifest(&self) -> CaptureManifest {
        let _guard = self
            .inner
            .manifest_lock
            .lock()
            .expect("manifest lock poisoned");
        read_manifest_file(&self.inner.config.manifest_path())
    }

    pub fn snapshot(&self) -> Result<LibrarySnapshot> {
        let manifest = self.read_manifest();
        let mut items = Vec::new();
        for kind in [CaptureKind::Replay, CaptureKind::Screenshot] {
            let root = self.inner.config.output_folder.join(collection_for(kind));
            scan_collection(&root, kind, &manifest, &mut items)?;
        }
        items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        let total_size_bytes = items.iter().map(|item| item.size_bytes).sum();
        let groups = group_items(&items);
        Ok(LibrarySnapshot {
            output_folder: self
                .inner
                .config
                .output_folder
                .to_string_lossy()
                .into_owned(),
            scanned_at: now_rfc3339(),
            total_count: items.len(),
            total_size_bytes,
            items,
            groups,
        })
    }

    pub fn find_item(&self, id: &str) -> Option<LibraryItem> {
        self.snapshot()
            .ok()?
            .items
            .into_iter()
            .find(|item| item.id == id)
    }

    /// Resolves a capture id to its file without building a snapshot. The
    /// loopback media route calls this for every request, including every
    /// range request while a video seeks, so it must not walk the whole
    /// library and stat every file the way `find_item` does.
    pub fn find_media_path(&self, id: &str) -> Option<PathBuf> {
        if !is_capture_id(id) {
            return None;
        }
        let manifest = self.read_manifest();
        if let Some(entry) = manifest.captures.values().find(|entry| entry.id == id)
            && let Some(path) = self.media_in_collection(Path::new(&entry.filename))
        {
            return Some(path);
        }
        // Captures without a manifest entry derive their id from their path,
        // so fall back to a walk that only hashes names.
        for collection in ["Clips", "Screenshots"] {
            let Ok(root) = self
                .inner
                .config
                .output_folder
                .join(collection)
                .canonicalize()
            else {
                continue;
            };
            let mut found = None;
            let _ = walk_media_files(&root, &mut |path| {
                if found.is_some() || capture_id(&path) != id {
                    return;
                }
                // A manifest entry wins over the derived id, so a file whose
                // entry names a different id is not this capture.
                let claimed = manifest
                    .captures
                    .get(&manifest_key(&path))
                    .is_some_and(|entry| is_capture_id(&entry.id) && entry.id != id);
                if !claimed {
                    found = Some(path);
                }
            });
            if let Some(path) = found.and_then(|path| self.media_in_collection(&path)) {
                return Some(path);
            }
        }
        None
    }

    /// Accepts a path only when it is an existing media file below one of the
    /// scanned collection folders, matching what `snapshot` would report.
    fn media_in_collection(&self, path: &Path) -> Option<PathBuf> {
        ["Clips", "Screenshots"].iter().find_map(|collection| {
            let root = self
                .inner
                .config
                .output_folder
                .join(collection)
                .canonicalize()
                .ok()?;
            let path = ensure_within(&root, path).ok()?;
            (is_media(&path) && path.is_file()).then_some(path)
        })
    }

    pub fn remember_capture(&self, capture: &CaptureRecord) -> Result<()> {
        let filename = ensure_media_in_output(&self.inner.config.output_folder, &capture.filename)?;
        if !filename.is_file() || !is_media(&filename) {
            return Err(LibraryError::UnsupportedMedia);
        }
        let metadata = fs::metadata(&filename)?;
        self.mutate_manifest(|manifest| {
            let key = manifest_key(&filename);
            let existing = manifest.captures.get(&key).cloned().unwrap_or_default();
            let now = now_rfc3339();
            let entry = ManifestEntry {
                id: if is_capture_id(&existing.id) {
                    existing.id.clone()
                } else {
                    capture_id(&filename)
                },
                filename: filename.to_string_lossy().into_owned(),
                title: if capture.kind == CaptureKind::Screenshot {
                    format!("Screenshot {now}")
                } else {
                    title_for_capture(&capture.created_at)
                },
                kind: capture.kind,
                source: capture.source,
                game_name: capture.game.as_ref().map(|game| game.name.clone()),
                game_icon_url: capture.game.as_ref().and_then(|game| game.icon_url.clone()),
                game_guess: capture.game.as_ref().and_then(|game| game.guess.clone()),
                size_bytes: Some(metadata.len()),
                duration_ms: capture.duration_ms,
                width: capture.width,
                height: capture.height,
                created_at: capture.created_at.clone(),
                updated_at: now,
                ..existing
            };
            manifest.captures.insert(key, entry);
            Ok(())
        })
    }

    pub fn update_metadata(&self, patch: MetaPatch) -> Result<String> {
        validate_meta_patch(&patch)?;
        let item = self
            .find_item(&patch.id)
            .ok_or(LibraryError::CaptureNotFound)?;
        let move_display_capture =
            patch.game_name.is_some() && item.source == CaptureSource::Display;
        let mut moved = None;
        let result = self.mutate_manifest(|manifest| {
            let old_key = manifest_key(Path::new(&item.filename));
            let mut entry = manifest
                .captures
                .remove(&old_key)
                .unwrap_or_else(|| manifest_entry_from_item(&item));
            if let Some(title) = patch.title {
                entry.title = title.trim().to_string();
            }
            if let Some(value) = patch.game_name {
                entry.game_name = value;
            }
            if let Some(value) = patch.game_icon_url {
                entry.game_icon_url = value;
            }
            if let Some(value) = patch.game_guess {
                entry.game_guess = value;
            }
            if let Some(value) = patch.description {
                entry.description = value;
            }
            if let Some(value) = patch.tags {
                entry.tags = value;
            }
            if let Some(value) = patch.mentions {
                entry.mentions = value;
            }
            if let Some(value) = patch.privacy {
                entry.privacy = value;
            }
            if let Some(value) = patch.uploaded_clip_id {
                if value != entry.uploaded_clip_id {
                    entry.uploaded_clip_source_start_ms = None;
                    entry.uploaded_clip_source_duration_ms = None;
                }
                entry.uploaded_clip_id = value;
            }
            if let Some(value) = patch.uploaded_clip_source_start_ms {
                entry.uploaded_clip_source_start_ms = value;
            }
            if let Some(value) = patch.uploaded_clip_source_duration_ms {
                entry.uploaded_clip_source_duration_ms = value;
            }
            entry.updated_at = now_rfc3339();
            if move_display_capture {
                let source = PathBuf::from(&entry.filename);
                let destination =
                    display_capture_destination(self, &source, entry.game_name.as_deref())?;
                if source != destination {
                    move_media_file_sync(&source, &destination)?;
                    moved = Some((source, destination.clone()));
                    entry.filename = destination.to_string_lossy().into_owned();
                }
            }
            let id = entry.id.clone();
            manifest
                .captures
                .insert(manifest_key(Path::new(&entry.filename)), entry);
            Ok(id)
        });
        match result {
            Ok(id) => Ok(id),
            Err(error) => {
                if let Some((source, destination)) = moved {
                    let _ = move_media_file_sync(&destination, &source);
                }
                Err(error)
            }
        }
    }

    pub fn set_trim(&self, update: TrimUpdate) -> Result<String> {
        validate_trim(update.trim_start_ms, update.trim_end_ms)?;
        let item = self
            .find_item(&update.id)
            .ok_or(LibraryError::CaptureNotFound)?;
        self.mutate_manifest(|manifest| {
            let key = manifest_key(Path::new(&item.filename));
            let entry = manifest
                .captures
                .entry(key)
                .or_insert_with(|| manifest_entry_from_item(&item));
            entry.trim_start_ms = update.trim_start_ms;
            entry.trim_end_ms = update.trim_end_ms;
            entry.updated_at = now_rfc3339();
            Ok(entry.id.clone())
        })
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let path = ensure_media_in_output(&self.inner.config.output_folder, self.media_path(id)?)?;
        // Volumes without a recycle bin (network shares, some removable
        // drives) cannot trash a file. Deleting for good beats refusing.
        if let Err(error) = trash::delete(&path) {
            log::warn!(
                "trash unavailable for {}, deleting permanently: {error}",
                path.display()
            );
            fs::remove_file(&path)?;
        }
        self.mutate_manifest(|manifest| {
            manifest.captures.remove(&manifest_key(&path));
            Ok(())
        })?;
        // The capture is gone, so its cached thumbnails and export renders
        // have nothing left to belong to.
        if let Ok(folder) = self.thumbnail_path(id) {
            let _ = fs::remove_dir_all(folder);
        }
        if let Ok(folder) = self.exports_folder_for(id) {
            let _ = fs::remove_dir_all(folder);
        }
        Ok(())
    }

    pub fn reveal_path(&self, id: &str) -> Result<PathBuf> {
        self.media_path(id)
    }

    pub async fn stage_files(&self, paths: &[PathBuf]) -> FilesImportResult {
        self.cleanup_stale_staged().await;
        let mut staged = Vec::new();
        let mut failed = Vec::new();
        for source in paths {
            match self.stage_one(source).await {
                Ok(value) => staged.push(value),
                Err(error) => failed.push(ImportFailure {
                    file_name: source
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("file")
                        .to_string(),
                    error: error.to_string(),
                }),
            }
        }
        FilesImportResult {
            staged,
            failed,
            canceled: paths.is_empty(),
        }
    }

    pub async fn commit_staged(&self, request: CommitImport) -> Result<String> {
        validate_commit(&request)?;
        let staged = self
            .inner
            .staged
            .lock()
            .expect("staged lock poisoned")
            .get(&request.id)
            .cloned()
            .ok_or(LibraryError::StagedImportNotFound)?;
        let collection = if is_image(Path::new(&staged.file_name)) {
            "Screenshots"
        } else {
            "Clips"
        };
        let root = self
            .inner
            .config
            .output_folder
            .join(collection)
            .join(safe_component(
                request.game_name.as_deref(),
                "Uncategorized",
            ));
        fs::create_dir_all(&root)?;
        let extension = format!(".{}", staged.extension);
        let destination = unique_path(
            &root,
            &safe_file_stem(Some(request.title.as_str()), "import"),
            &extension,
        );
        move_file(&staged.staged_path, &destination).await?;
        let destination = ensure_media_in_output(&self.inner.config.output_folder, &destination)?;
        let id = capture_id(&destination);
        let now = now_rfc3339();
        self.mutate_manifest(|manifest| {
            manifest.captures.insert(
                manifest_key(&destination),
                ManifestEntry {
                    id: id.clone(),
                    filename: destination.to_string_lossy().into_owned(),
                    title: request.title.trim().to_string(),
                    kind: if collection == "Screenshots" {
                        CaptureKind::Screenshot
                    } else {
                        CaptureKind::Replay
                    },
                    source: CaptureSource::Display,
                    game_name: request.game_name.clone(),
                    game_icon_url: request.game_icon_url.clone(),
                    game_guess: None,
                    size_bytes: Some(staged.size_bytes),
                    duration_ms: staged.duration_ms,
                    width: staged.width,
                    height: staged.height,
                    created_at: staged.created_at.clone(),
                    updated_at: now,
                    ..ManifestEntry::default()
                },
            );
            Ok(())
        })?;
        self.inner
            .staged
            .lock()
            .expect("staged lock poisoned")
            .remove(&request.id);
        Ok(id)
    }

    pub async fn discard_staged(&self, id: &str) -> Result<()> {
        let staged = self
            .inner
            .staged
            .lock()
            .expect("staged lock poisoned")
            .remove(id);
        if let Some(staged) = staged {
            let _ = tokio::fs::remove_file(staged.staged_path).await;
        }
        Ok(())
    }

    pub fn store_thumbnail(&self, id: &str, bytes: &[u8]) -> Result<PathBuf> {
        if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024 {
            return Err(LibraryError::InvalidMetadata("invalid thumbnail".into()));
        }
        let source = self.media_path(id)?;
        let metadata = fs::metadata(&source)?;
        let folder = self.thumbnail_path(id)?;
        fs::create_dir_all(&folder)?;
        let filename = format!("{}-{}.jpg", id, metadata.len());
        let path = ensure_within(&folder, &folder.join(filename))?;
        let temp = path.with_extension(format!("jpg.{}.tmp", Uuid::new_v4()));
        fs::write(&temp, bytes)?;
        if let Err(error) = fs::rename(&temp, &path) {
            let _ = fs::remove_file(&temp);
            return Err(error.into());
        }
        for entry in fs::read_dir(&folder)? {
            let entry = entry?;
            if entry.path() != path && entry.file_type()?.is_file() {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(path)
    }

    /// Registers a completed server download after its temporary file has
    /// been moved into the library. The caller must pass a supported content
    /// type and a path below the configured output folder.
    pub fn register_download(
        &self,
        request: &crate::capture_library::types::DownloadRequest,
        path: &Path,
        content_type: &str,
        size_bytes: u64,
    ) -> Result<String> {
        validate_download_request(request)?;
        let path = ensure_media_in_output(&self.inner.config.output_folder, path)?;
        if !path.is_file()
            || !matches!(
                content_type,
                "image/png"
                    | "image/jpeg"
                    | "image/webp"
                    | "video/mp4"
                    | "video/quicktime"
                    | "video/x-matroska"
                    | "video/webm"
            )
        {
            return Err(LibraryError::UnsupportedMedia);
        }
        let id = capture_id(&path);
        let now = now_rfc3339();
        let kind = if content_type.starts_with("image/") {
            CaptureKind::Screenshot
        } else {
            CaptureKind::Replay
        };
        self.mutate_manifest(|manifest| {
            manifest.captures.insert(
                manifest_key(&path),
                ManifestEntry {
                    id: id.clone(),
                    filename: path.to_string_lossy().into_owned(),
                    title: request.title.trim().to_string(),
                    kind,
                    source: CaptureSource::Display,
                    game_name: request.game_name.clone(),
                    game_icon_url: None,
                    game_guess: None,
                    size_bytes: Some(size_bytes),
                    duration_ms: request.duration_ms.filter(|value| *value > 0),
                    width: request.width,
                    height: request.height,
                    created_at: now.clone(),
                    updated_at: now,
                    uploaded_clip_id: Some(request.clip_id.clone()),
                    ..ManifestEntry::default()
                },
            );
            Ok(())
        })?;
        Ok(id)
    }

    async fn stage_one(&self, source: &Path) -> Result<StagedImport> {
        let source = source.canonicalize()?;
        if !source.is_file() || !is_media(&source) {
            return Err(LibraryError::UnsupportedMedia);
        }
        let metadata = fs::metadata(&source)?;
        let extension = extension(&source).ok_or(LibraryError::UnsupportedMedia)?;
        let id = Uuid::new_v4().to_string();
        let root = &self.inner.config.imports_folder();
        tokio::fs::create_dir_all(root).await?;
        let staged_path = root.join(format!("{id}.{extension}"));
        tokio::fs::copy(&source, &staged_path).await?;
        let meta = probe_file_for_library(self, &source).await.ok();
        let created_at = file_time(&metadata);
        let title = source
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| safe_file_stem(Some(value), "import"))
            .unwrap_or_else(|| title_for_capture(&created_at));
        let internal = StagedInternal {
            id: id.clone(),
            staged_path,
            file_name: source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("import")
                .to_string(),
            extension,
            title: title.clone(),
            size_bytes: metadata.len(),
            duration_ms: meta.as_ref().and_then(|value| value.duration_ms),
            width: meta.as_ref().and_then(|value| value.width),
            height: meta.as_ref().and_then(|value| value.height),
            created_at,
        };
        let value = StagedImport {
            id: internal.id.clone(),
            file_name: internal.file_name.clone(),
            title: internal.title.clone(),
            size_bytes: internal.size_bytes,
            duration_ms: internal.duration_ms,
            width: internal.width,
            height: internal.height,
        };
        self.inner
            .staged
            .lock()
            .expect("staged lock poisoned")
            .insert(id, internal);
        Ok(value)
    }

    async fn cleanup_stale_staged(&self) {
        let root = &self.inner.config.imports_folder();
        let active: std::collections::HashSet<PathBuf> = self
            .inner
            .staged
            .lock()
            .expect("staged lock poisoned")
            .values()
            .map(|value| value.staged_path.clone())
            .collect();
        let Ok(mut entries) = tokio::fs::read_dir(root).await else {
            return;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if active.contains(&path) {
                continue;
            }
            let Ok(metadata) = entry.metadata().await else {
                continue;
            };
            let Ok(modified) = metadata.modified() else {
                continue;
            };
            if SystemTime::now()
                .duration_since(modified)
                .unwrap_or_default()
                > MAX_STAGED_IMPORT_AGE
            {
                let _ = tokio::fs::remove_file(path).await;
            }
        }
    }

    fn mutate_manifest<T>(
        &self,
        mutate: impl FnOnce(&mut CaptureManifest) -> Result<T>,
    ) -> Result<T> {
        let _guard = self
            .inner
            .manifest_lock
            .lock()
            .expect("manifest lock poisoned");
        let mut manifest = read_manifest_file(&self.inner.config.manifest_path());
        let result = mutate(&mut manifest)?;
        write_manifest_file(&self.inner.config.manifest_path(), &manifest)?;
        Ok(result)
    }
}

fn read_manifest_file(path: &Path) -> CaptureManifest {
    let Ok(bytes) = fs::read(path) else {
        return CaptureManifest::default();
    };
    if bytes.len() > MAX_MANIFEST_BYTES {
        return CaptureManifest::default();
    }
    // Entries are decoded one at a time. Resetting the whole manifest would
    // discard titles, trims, and upload links of every other capture because
    // of one bad record, whether it fails to decode or fails validation.
    #[derive(Deserialize)]
    struct RawManifest<'a> {
        version: u8,
        // Borrow each entry's JSON from the input instead of allocating an
        // intermediate tree of every field in the library. Decode entries
        // independently so a malformed record cannot discard healthy ones.
        #[serde(default, borrow)]
        captures: BTreeMap<String, &'a serde_json::value::RawValue>,
    }
    let Ok(raw) = serde_json::from_slice::<RawManifest>(&bytes) else {
        return CaptureManifest::default();
    };
    if raw.version != MANIFEST_VERSION || raw.captures.len() > MAX_MANIFEST_ENTRIES {
        return CaptureManifest::default();
    }
    let mut manifest = CaptureManifest::default();
    for (key, value) in raw.captures {
        match serde_json::from_str::<ManifestEntry>(value.get()) {
            Ok(entry) if validate_manifest_entry(&key, &entry) => {
                manifest.captures.insert(key, entry);
            }
            Ok(_) => log::warn!("dropped invalid manifest entry {key}"),
            Err(error) => log::warn!("dropped undecodable manifest entry {key}: {error}"),
        }
    }
    manifest
}

fn manifest_lock_for(path: &Path) -> Arc<Mutex<()>> {
    let key = path
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .unwrap_or_else(|| path.to_path_buf());
    let locks = MANIFEST_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().expect("manifest lock registry poisoned");
    locks
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn validate_manifest_entry(key: &str, entry: &ManifestEntry) -> bool {
    key.len() <= 32_768
        && is_capture_id(&entry.id)
        && !entry.filename.contains('\0')
        && entry.filename.len() <= 32_768
        && !entry.title.is_empty()
        && entry.title.len() <= MAX_TITLE_LENGTH
        && entry.mentions.len() <= MAX_MENTIONS
        && entry
            .mentions
            .iter()
            .all(|mention| mention.id.len() <= 128 && mention.username.len() <= 256)
        && entry
            .game_guess
            .as_ref()
            .is_none_or(|value| validate_game_guess(value).is_ok())
        && entry
            .description
            .as_deref()
            .is_none_or(|value| value.len() <= MAX_DESCRIPTION_LENGTH)
        && entry
            .tags
            .as_deref()
            .is_none_or(|value| value.len() <= MAX_TAGS_LENGTH)
}

fn write_manifest_file(path: &Path, manifest: &CaptureManifest) -> Result<()> {
    let parent = path.parent().ok_or(LibraryError::InvalidPath)?;
    fs::create_dir_all(parent)?;
    let temp = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(manifest)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp)?;
    file.write_all(&contents)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    drop(file);
    // A rename replaces the previous manifest atomically on Windows and Unix.
    fs::rename(temp, path)?;
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn scan_collection(
    root: &Path,
    kind: CaptureKind,
    manifest: &CaptureManifest,
    output: &mut Vec<LibraryItem>,
) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }
    let root = root.canonicalize()?;
    walk_media_files(&root, &mut |path| {
        let _ = add_item(&root, kind, manifest, path, output);
    })?;
    Ok(())
}

fn walk_media_files(root: &Path, visit: &mut impl FnMut(PathBuf)) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_dir() {
            walk_media_files(&path, visit)?;
        } else if file_type.is_file() && is_media(&path) {
            visit(path);
        }
    }
    Ok(())
}

fn add_item(
    collection_root: &Path,
    kind: CaptureKind,
    manifest: &CaptureManifest,
    path: PathBuf,
    output: &mut Vec<LibraryItem>,
) -> Result<()> {
    let path = ensure_within(collection_root, &path)?;
    let metadata = fs::metadata(&path)?;
    let key = manifest_key(&path);
    let entry = manifest.captures.get(&key);
    let id = entry
        .filter(|value| is_capture_id(&value.id))
        .map(|value| value.id.clone())
        .unwrap_or_else(|| capture_id(&path));
    let relative = path.strip_prefix(collection_root).unwrap_or(path.as_path());
    let group_label = relative
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .filter(|value| !value.is_empty() && *value != ".")
        .unwrap_or("Uncategorized")
        .to_string();
    let uncategorized = group_label.eq_ignore_ascii_case("desktop")
        || group_label.eq_ignore_ascii_case("uncategorized");
    let group_label = if uncategorized {
        "Uncategorized".to_string()
    } else {
        group_label
    };
    let source = entry.map(|value| value.source).unwrap_or(if uncategorized {
        CaptureSource::Display
    } else {
        CaptureSource::Game
    });
    let actual_kind = entry.map(|value| value.kind).unwrap_or(kind);
    let created_at = entry
        .map(|value| value.created_at.clone())
        .unwrap_or_else(|| file_time(&metadata));
    let modified_at = metadata
        .modified()
        .ok()
        .map(system_time_rfc3339)
        .unwrap_or_else(now_rfc3339);
    let (trim_start_ms, trim_end_ms) =
        trim_for_entry(entry, entry.and_then(|value| value.duration_ms));
    // The recorder files game captures under a folder named after the game,
    // so a capture without a manifest entry still gets a real name instead of
    // a placeholder that disagrees with its group.
    let game_name = entry
        .and_then(|value| value.game_name.clone())
        .or_else(|| (source == CaptureSource::Game).then(|| group_label.clone()));
    output.push(LibraryItem {
        id: id.clone(),
        title: entry.map(|value| value.title.clone()).unwrap_or_else(|| {
            if actual_kind == CaptureKind::Screenshot {
                format!("Screenshot {created_at}")
            } else {
                title_for_capture(&created_at)
            }
        }),
        filename: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("capture")
            .to_string(),
        // The host fills both from its loopback file server before the item
        // leaves the process.
        media_url: String::new(),
        thumbnail_url: None,
        thumb_blur_hash: None,
        collection: collection_for(actual_kind).to_string(),
        kind: actual_kind,
        source,
        group_key: group_label.to_ascii_lowercase(),
        group_label,
        game_name,
        game_icon_url: entry.and_then(|value| value.game_icon_url.clone()),
        game_guess: entry.and_then(|value| value.game_guess.clone()),
        size_bytes: entry
            .and_then(|value| value.size_bytes)
            .unwrap_or(metadata.len()),
        duration_ms: entry.and_then(|value| value.duration_ms),
        width: entry.and_then(|value| value.width),
        height: entry.and_then(|value| value.height),
        description: entry.and_then(|value| value.description.clone()),
        tags: entry.and_then(|value| value.tags.clone()),
        mentions: entry
            .map(|value| value.mentions.clone())
            .unwrap_or_default(),
        privacy: entry.and_then(|value| value.privacy.clone()),
        uploaded_clip_id: entry.and_then(|value| value.uploaded_clip_id.clone()),
        uploaded_clip_source_start_ms: entry.and_then(|value| value.uploaded_clip_source_start_ms),
        uploaded_clip_source_duration_ms: entry
            .and_then(|value| value.uploaded_clip_source_duration_ms),
        trim_start_ms,
        trim_end_ms,
        created_at,
        modified_at,
    });
    Ok(())
}

fn group_items(items: &[LibraryItem]) -> Vec<LibraryGroup> {
    let mut groups: BTreeMap<String, LibraryGroup> = BTreeMap::new();
    for item in items {
        let group = groups
            .entry(item.group_key.clone())
            .or_insert_with(|| LibraryGroup {
                key: item.group_key.clone(),
                label: item.group_label.clone(),
                kind: if item.group_label == "Uncategorized" {
                    "desktop"
                } else {
                    "game"
                }
                .to_string(),
                icon_url: item.game_icon_url.clone(),
                total_count: 0,
                clip_count: 0,
                total_size_bytes: 0,
                latest_at: item.created_at.clone(),
                items: Vec::new(),
            });
        group.total_count += 1;
        group.clip_count += usize::from(item.kind == CaptureKind::Replay);
        group.total_size_bytes = group.total_size_bytes.saturating_add(item.size_bytes);
        if item.created_at > group.latest_at {
            group.latest_at = item.created_at.clone();
        }
        if group.icon_url.is_none() {
            group.icon_url = item.game_icon_url.clone();
        }
        group.items.push(item.clone());
    }
    let mut result = groups.into_values().collect::<Vec<_>>();
    result.sort_by(|left, right| right.latest_at.cmp(&left.latest_at));
    result
}

fn manifest_entry_from_item(item: &LibraryItem) -> ManifestEntry {
    ManifestEntry {
        id: item.id.clone(),
        filename: item.filename.clone(),
        title: item.title.clone(),
        kind: item.kind,
        source: item.source,
        game_name: item.game_name.clone(),
        game_icon_url: item.game_icon_url.clone(),
        game_guess: item.game_guess.clone(),
        size_bytes: Some(item.size_bytes),
        duration_ms: item.duration_ms,
        width: item.width,
        height: item.height,
        created_at: item.created_at.clone(),
        updated_at: item.modified_at.clone(),
        description: item.description.clone(),
        tags: item.tags.clone(),
        mentions: item.mentions.clone(),
        privacy: item.privacy.clone(),
        uploaded_clip_id: item.uploaded_clip_id.clone(),
        uploaded_clip_source_start_ms: item.uploaded_clip_source_start_ms,
        uploaded_clip_source_duration_ms: item.uploaded_clip_source_duration_ms,
        trim_start_ms: item.trim_start_ms,
        trim_end_ms: item.trim_end_ms,
    }
}

fn validate_meta_patch(patch: &MetaPatch) -> Result<()> {
    if !is_capture_id(&patch.id) {
        return Err(LibraryError::InvalidMetadata("invalid capture id".into()));
    }
    if let Some(title) = patch.title.as_deref()
        && (title.trim().is_empty() || title.len() > MAX_TITLE_LENGTH)
    {
        return Err(LibraryError::InvalidMetadata("invalid title".into()));
    }
    if let Some(value) = patch.game_name.as_ref().and_then(|value| value.as_deref())
        && value.len() > 256
    {
        return Err(LibraryError::InvalidMetadata("invalid game name".into()));
    }
    if let Some(value) = patch
        .game_icon_url
        .as_ref()
        .and_then(|value| value.as_deref())
    {
        validate_url(value)?;
    }
    if let Some(guess) = patch.game_guess.as_ref().and_then(|value| value.as_ref()) {
        validate_game_guess(guess)?;
    }
    if let Some(value) = patch
        .description
        .as_ref()
        .and_then(|value| value.as_deref())
        && value.len() > MAX_DESCRIPTION_LENGTH
    {
        return Err(LibraryError::InvalidMetadata(
            "description is too long".into(),
        ));
    }
    if let Some(value) = patch.tags.as_ref().and_then(|value| value.as_deref())
        && value.len() > MAX_TAGS_LENGTH
    {
        return Err(LibraryError::InvalidMetadata("tags are too long".into()));
    }
    if let Some(values) = &patch.mentions
        && (values.len() > MAX_MENTIONS
            || values.iter().any(|value| {
                value.id.len() > 128
                    || value.username.len() > 256
                    || value
                        .image
                        .as_deref()
                        .is_some_and(|image| image.len() > 2048)
            }))
    {
        return Err(LibraryError::InvalidMetadata("invalid mentions".into()));
    }
    if let Some(values) = &patch.mentions {
        for mention in values {
            if let Some(image) = mention.image.as_deref() {
                validate_url(image)?;
            }
        }
    }
    if let Some(value) = patch.privacy.as_ref().and_then(|value| value.as_deref())
        && !matches!(value, "public" | "unlisted" | "private")
    {
        return Err(LibraryError::InvalidMetadata("invalid privacy".into()));
    }
    if let Some(value) = patch
        .uploaded_clip_id
        .as_ref()
        .and_then(|value| value.as_deref())
        && !is_safe_server_id(value)
    {
        return Err(LibraryError::InvalidMetadata(
            "invalid uploaded clip id".into(),
        ));
    }
    Ok(())
}

/// The detector fields (`source`, `matchKind`) are enums on the wire, so only
/// the free-form parts still need bounds.
fn validate_game_guess(value: &GameGuess) -> Result<()> {
    if value.name.trim().is_empty()
        || value.name.len() > 256
        || value.aliases.len() > 100
        || value.aliases.iter().any(|alias| alias.len() > 256)
        || value.confidence > 100
    {
        return Err(LibraryError::InvalidMetadata("invalid game guess".into()));
    }
    if let Some(icon_url) = value.icon_url.as_deref() {
        validate_url(icon_url)?;
    }
    Ok(())
}

fn validate_commit(request: &CommitImport) -> Result<()> {
    if !is_uuid(&request.id) {
        return Err(LibraryError::InvalidMetadata(
            "invalid staged import id".into(),
        ));
    }
    if request.title.trim().is_empty() || request.title.len() > MAX_TITLE_LENGTH {
        return Err(LibraryError::InvalidMetadata("invalid title".into()));
    }
    if request
        .game_name
        .as_deref()
        .is_some_and(|value| value.len() > 256)
    {
        return Err(LibraryError::InvalidMetadata("invalid game name".into()));
    }
    if let Some(value) = request.game_icon_url.as_deref() {
        validate_url(value)?;
    }
    Ok(())
}

fn validate_url(value: &str) -> Result<()> {
    let url =
        url::Url::parse(value).map_err(|_| LibraryError::InvalidMetadata("invalid URL".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.username() != "" || url.password().is_some()
    {
        return Err(LibraryError::InvalidMetadata("invalid URL".into()));
    }
    Ok(())
}

fn validate_trim(start: Option<u64>, end: Option<u64>) -> Result<()> {
    match (start, end) {
        (None, None) => Ok(()),
        (Some(start), Some(end)) if end > start => Ok(()),
        _ => Err(LibraryError::InvalidTrim),
    }
}

fn trim_for_entry(
    entry: Option<&ManifestEntry>,
    duration_ms: Option<u64>,
) -> (Option<u64>, Option<u64>) {
    let Some(entry) = entry else {
        return (None, None);
    };
    let (Some(start), Some(end)) = (entry.trim_start_ms, entry.trim_end_ms) else {
        return (None, None);
    };
    if end <= start || duration_ms.is_some_and(|duration| start >= duration) {
        return (None, None);
    }
    (
        Some(start),
        Some(duration_ms.map_or(end, |duration| end.min(duration))),
    )
}

pub(crate) fn ensure_media_in_output(output: &Path, path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = ensure_media_location(output, path)?;
    if !path.is_file() {
        return Err(LibraryError::UnsupportedMedia);
    }
    Ok(path)
}

pub(crate) fn ensure_media_location(output: &Path, path: impl AsRef<Path>) -> Result<PathBuf> {
    let root = output.canonicalize()?;
    let candidate = path.as_ref();
    let path = if candidate.exists() {
        candidate.canonicalize()?
    } else {
        let parent = candidate
            .parent()
            .ok_or(LibraryError::InvalidPath)?
            .canonicalize()?;
        parent.join(candidate.file_name().ok_or(LibraryError::InvalidPath)?)
    };
    let path = ensure_within(&root, &path)?;
    if !is_media(&path) {
        return Err(LibraryError::UnsupportedMedia);
    }
    if !path.starts_with(&root) {
        return Err(LibraryError::InvalidPath);
    }
    Ok(path)
}

async fn move_file(source: &Path, destination: &Path) -> Result<()> {
    match tokio::fs::rename(source, destination).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {
            tokio::fs::copy(source, destination).await?;
            tokio::fs::remove_file(source).await?;
            Ok(())
        }
        Err(error) => Err(LibraryError::Io(error)),
    }
}

fn file_time(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .map(system_time_rfc3339)
        .unwrap_or_else(now_rfc3339)
}

fn system_time_rfc3339(value: SystemTime) -> String {
    let duration = value.duration_since(UNIX_EPOCH).unwrap_or_default();
    time::OffsetDateTime::from_unix_timestamp(duration.as_secs() as i64)
        .ok()
        .and_then(|value| {
            value
                .replace_nanosecond(duration.subsec_nanos())
                .ok()
                .map(|value| {
                    value
                        .format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
                })
        })
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
}

fn is_capture_id(value: &str) -> bool {
    (12..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn is_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok()
}

fn is_safe_server_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validate_download_request(
    request: &crate::capture_library::types::DownloadRequest,
) -> Result<()> {
    if request.clip_id.is_empty()
        || request.clip_id.len() > 128
        || !request
            .clip_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(LibraryError::InvalidMetadata("invalid clip id".into()));
    }
    if request.title.trim().is_empty() || request.title.len() > MAX_TITLE_LENGTH {
        return Err(LibraryError::InvalidMetadata("invalid title".into()));
    }
    if request
        .game_name
        .as_deref()
        .is_some_and(|value| value.len() > 256)
    {
        return Err(LibraryError::InvalidMetadata("invalid game name".into()));
    }
    Ok(())
}

fn display_capture_destination(
    library: &CaptureLibrary,
    source: &Path,
    game_name: Option<&str>,
) -> Result<PathBuf> {
    let source = ensure_media_in_output(library.output_folder(), source)?;
    let collection = source
        .parent()
        .and_then(|parent| parent.parent())
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
        .filter(|value| matches!(*value, "Clips" | "Screenshots"))
        .ok_or(LibraryError::InvalidPath)?;
    let root = library
        .output_folder()
        .join(collection)
        .join(safe_component(game_name, "Uncategorized"));
    fs::create_dir_all(&root)?;
    let root = root.canonicalize()?;
    if source.parent().is_some_and(|parent| parent == root) {
        return Ok(source);
    }
    let stem = source.file_stem().and_then(|value| value.to_str());
    let extension = format!(
        ".{}",
        extension(&source).ok_or(LibraryError::UnsupportedMedia)?
    );
    let destination = unique_path(&root, &safe_file_stem(stem, "capture"), &extension);
    ensure_media_location(library.output_folder(), destination)
}

fn move_media_file_sync(source: &Path, destination: &Path) -> Result<()> {
    fs::rename(source, destination).map_err(LibraryError::Io)
}
