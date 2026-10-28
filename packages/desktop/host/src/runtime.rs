//! The capture runtime: the recorder sidecar, the capture library with its
//! loopback media server, and clip downloads. The shell owns the windows and
//! decides which server is selected; it hands this runtime the folders to use
//! and a sink for the events the selected server window receives. Native
//! dialogs, cookies, and the file manager stay in the shell, which passes
//! their results to the methods below.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};
use std::time::{Duration, SystemTime};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::sync::{Mutex, RwLock, watch};
use url::Url;

use crate::capture_library::{
    CaptureHttpServer, CaptureLibrary, CaptureLibraryConfig, collection_for,
    download::DownloadManager,
    media,
    poster::{POSTER_WAIT, wait_for_poster},
};
use crate::global_shortcuts::{
    BindRequest, GlobalShortcuts, ShortcutRequest, ShortcutsState, xdg_trigger,
};
use crate::logging::logged;
use crate::recording_host::{
    PlayNotificationSoundRequest, RecorderHost, RecorderHostOptions, RecordingCapture,
    RecordingCaptureKind, RecordingEvent, RecordingSettings, SaveReplayClipRequest,
};

/// What a hotkey, a global shortcut or `--action` asks the recorder to save.
#[derive(Clone, Copy, Debug)]
pub enum CaptureAction {
    Clip,
    Screenshot,
}

impl CaptureAction {
    /// The value of `--action`.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "clip" => Some(Self::Clip),
            "screenshot" => Some(Self::Screenshot),
            _ => None,
        }
    }
}

/// Folders the shell resolves for this platform and install.
pub struct RuntimeOptions {
    /// Roaming app data: settings, the capture manifest, notification sounds.
    pub data_dir: PathBuf,
    /// Local app data for regenerable files: thumbnails, import staging,
    /// export renders, recorder scratch, and detection caches.
    pub cache_dir: PathBuf,
    /// Disk segments of the replay buffer.
    pub replay_scratch_dir: PathBuf,
    /// The capture folder used until the user picks another one.
    pub default_output_dir: PathBuf,
    /// The staged or packaged `agent/`, `obs-runtime/` and `ffmpeg/` folders.
    pub native_root: PathBuf,
}

/// Receives the events for the selected server window.
pub type EventSink = Arc<dyn Fn(Value) + Send + Sync>;

/// What the desktop shows for each global shortcut, in the user's language.
pub struct ShortcutDescriptions {
    pub clip: String,
    pub screenshot: String,
}

pub struct LibraryRuntime {
    pub library: CaptureLibrary,
    pub files: CaptureHttpServer,
    pub downloads: DownloadManager,
}

pub struct DesktopRuntime {
    recorder: RecorderHost,
    library: RwLock<Arc<LibraryRuntime>>,
    /// Held while the selected server changes and while an operation depends
    /// on it, so a download or a new capture folder never pairs with a
    /// server that is no longer selected.
    selection_lock: Mutex<()>,
    /// The server whose window may use the library. Changes only under
    /// `selection_lock`.
    selected: std::sync::RwLock<Option<Url>>,
    events: EventSink,
    config: CaptureLibraryConfig,
    default_output: PathBuf,
    libraries: Mutex<Vec<Weak<LibraryRuntime>>>,
    finalizing: Mutex<HashSet<String>>,
    sounds: PathBuf,
    startup_error: Mutex<Option<String>>,
    /// Set once `start` has swept what interrupted jobs left beside the
    /// captures. Jobs that write there wait for it, so the sweep never
    /// takes a file one of them has just created.
    output_swept: watch::Sender<bool>,
    /// Taken before the library serves anything. Cache files written before
    /// it belong to an earlier session.
    started_at: SystemTime,
    /// The clip and screenshot shortcuts the desktop binds where the
    /// recorder has no key hook.
    shortcuts: GlobalShortcuts,
}

impl DesktopRuntime {
    pub async fn new(options: RuntimeOptions, events: EventSink) -> Result<Arc<Self>, String> {
        let RuntimeOptions {
            data_dir: data,
            cache_dir: cache,
            replay_scratch_dir,
            default_output_dir: output,
            native_root,
        } = options;
        let executable = std::env::var_os("ALLOY_RECORDER_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                native_root.join(format!("agent/alloy-agent{}", std::env::consts::EXE_SUFFIX))
            });
        // The recorder loads libobs from this folder. On Linux it falls back
        // to the system's OBS when the folder holds none.
        let obs = std::env::var_os("ALLOY_OBS_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| native_root.join("obs-runtime"));
        let recorder = RecorderHost::new(
            RecorderHostOptions::new(executable, &data)
                .cache_dir(&cache)
                .output_folder(&output)
                .replay_scratch_folder(replay_scratch_dir)
                .obs_runtime_dir(Some(obs)),
        )
        .map_err(error)?;
        let default_output = output.clone();
        let settings = recorder.get_settings().await;
        let output = if settings.output_folder.is_empty() {
            output
        } else {
            PathBuf::from(&settings.output_folder)
        };
        let media_tool = |name: &str| {
            std::env::var_os(format!("ALLOY_{}", name.to_uppercase()))
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    let bundled = native_root
                        .join("ffmpeg")
                        .join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
                    // Windows builds ship FFmpeg. Elsewhere the system's
                    // media tools are used unless a package ships its own.
                    if cfg!(windows) || bundled.is_file() {
                        bundled
                    } else {
                        PathBuf::from(name)
                    }
                })
        };
        let mut config = CaptureLibraryConfig::new(
            output,
            &data,
            &cache,
            media_tool("ffmpeg"),
            media_tool("ffprobe"),
        );
        // An unreachable capture folder (unplugged drive, offline share) must
        // not block startup: the user could not reach the settings UI to change
        // it. Use the default folder for this session and report it once the
        // web app can show the error. The setting itself stays untouched.
        let mut startup_error = None;
        let library = match Self::open_library(config.clone()).await {
            Ok(library) => library,
            Err(cause) => {
                let message = format!(
                    "Capture folder {} is unavailable ({cause}). Using {} until it is reachable again.",
                    config.output_folder.display(),
                    default_output.display()
                );
                log::warn!("{message}");
                startup_error = Some(message);
                config.output_folder = default_output.clone();
                Self::open_library(config.clone()).await?
            }
        };
        // The web app reaches the library only once this returns, so no
        // export is being written into the cache yet.
        let started_at = SystemTime::now();
        library.library.sweep_cache_leftovers();
        let sounds = data.join("notification-sounds");
        std::fs::create_dir_all(&sounds).map_err(error)?;
        for (name, bytes) in [
            (
                "clip_saved.wav",
                include_bytes!("../../assets/clip_saved.wav").as_slice(),
            ),
            (
                "start_recording.wav",
                include_bytes!("../../assets/start_recording.wav").as_slice(),
            ),
        ] {
            let path = sounds.join(name);
            if !path.exists() {
                std::fs::write(path, bytes).map_err(error)?;
            }
        }
        let runtime = Arc::new(Self {
            recorder,
            libraries: Mutex::new(vec![Arc::downgrade(&library)]),
            library: RwLock::new(library),
            finalizing: Mutex::new(HashSet::new()),
            default_output,
            selection_lock: Mutex::new(()),
            selected: std::sync::RwLock::new(None),
            events,
            config,
            sounds,
            startup_error: Mutex::new(startup_error),
            output_swept: watch::Sender::new(false),
            started_at,
            shortcuts: GlobalShortcuts::new(),
        });
        runtime.start_events();
        Ok(runtime)
    }

    async fn open_library(config: CaptureLibraryConfig) -> Result<Arc<LibraryRuntime>, String> {
        let library = CaptureLibrary::new(config).map_err(error)?;
        let files = CaptureHttpServer::start(library.clone())
            .await
            .map_err(error)?;
        let downloads = DownloadManager::new(library.clone()).map_err(error)?;
        Ok(Arc::new(LibraryRuntime {
            library,
            files,
            downloads,
        }))
    }

    fn emit(&self, event: Value) {
        (self.events)(event);
    }

    /// Saves a clip or a screenshot for a hotkey, a global shortcut or a
    /// command-line action.
    pub fn trigger(self: &Arc<Self>, action: CaptureAction) {
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let result = match action {
                CaptureAction::Screenshot => runtime.recorder.save_screenshot().await,
                CaptureAction::Clip => {
                    let settings = runtime.recorder.get_settings().await;
                    runtime
                        .recorder
                        .save_replay_clip(SaveReplayClipRequest {
                            requested_at_unix_ms: unix_ms(),
                            duration_seconds: settings.replay_buffer_seconds,
                        })
                        .await
                }
            };
            if let Err(cause) = result {
                runtime.report_error(cause.to_string()).await;
            }
        });
    }

    /// Asks the desktop to bind the clip and screenshot shortcuts, suggesting
    /// the saved hotkeys. Linux only; Windows hooks them in the recorder.
    pub async fn start_shortcuts(
        self: &Arc<Self>,
        app_id: String,
        descriptions: ShortcutDescriptions,
    ) -> ShortcutsState {
        if !self.shortcuts.state().supported {
            return self.shortcuts.state();
        }
        let hotkeys = self.recorder.get_settings().await.hotkeys.clone();
        let weak = Arc::downgrade(self);
        let on_activated = Arc::new(move |id: &str| {
            if let (Some(runtime), Some(action)) = (weak.upgrade(), CaptureAction::parse(id)) {
                runtime.trigger(action);
            }
        });
        let weak = Arc::downgrade(self);
        let on_state = Arc::new(move |state: &ShortcutsState| {
            if let Some(runtime) = weak.upgrade() {
                runtime.emit(json!({ "type": "shortcuts", "state": state }));
            }
        });
        self.shortcuts
            .bind(BindRequest {
                app_id,
                shortcuts: vec![
                    ShortcutRequest {
                        id: "clip",
                        description: descriptions.clip,
                        preferred_trigger: xdg_trigger(&hotkeys.clip),
                    },
                    ShortcutRequest {
                        id: "screenshot",
                        description: descriptions.screenshot,
                        preferred_trigger: xdg_trigger(&hotkeys.screenshot),
                    },
                ],
                on_activated,
                on_state,
            })
            .await
    }

    fn start_events(self: &Arc<Self>) {
        let mut events = self.recorder.subscribe_events();
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                let event = match events.recv().await {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                };
                let Some(runtime) = weak.upgrade() else { break };
                match event {
                    RecordingEvent::ClipHotkey => runtime.trigger(CaptureAction::Clip),
                    RecordingEvent::ScreenshotHotkey => runtime.trigger(CaptureAction::Screenshot),
                    RecordingEvent::CaptureReady { capture, .. } => {
                        tokio::spawn(async move {
                            if let Err(cause) = runtime.finalize(capture, POSTER_WAIT).await {
                                runtime.report_error(cause).await;
                            }
                        });
                    }
                    event => {
                        if matches!(event, RecordingEvent::ReplayBufferStarted { .. }) {
                            let _ = runtime.preview_sound("replayBufferStarted", false).await;
                        }
                        if let Ok(value) = serde_json::to_value(event) {
                            runtime.emit(value);
                        }
                    }
                }
            }
        });
    }

    pub async fn start(self: &Arc<Self>) {
        // What interrupted jobs left beside the captures goes before any job
        // that writes there starts; `output_swept` holds them back until
        // then. Walking the capture folder can be slow, so it is not done
        // while the app starts.
        let library = self.library.read().await.clone();
        let _ = tokio::task::spawn_blocking(move || {
            library.library.sweep_output_leftovers();
        })
        .await;
        self.output_swept.send_replace(true);
        self.watch_downloads(self.library.read().await.clone());
        if let Some(cause) = self.startup_error.lock().await.take() {
            self.report_error(cause).await;
        }
        // One-time cache validation, off the startup path.
        let library = self.library.read().await.clone();
        let started_at = self.started_at;
        tokio::task::spawn_blocking(move || {
            library.library.sweep_poster_leftovers(started_at);
            library.library.remove_orphans();
        });
        for capture in self.recorder.captures().await {
            // Recovered captures don't hold up the recorder for their posters.
            if let Err(cause) = self.finalize(capture, Duration::ZERO).await {
                self.report_error(cause).await;
            }
        }
        if let Err(cause) = self.recorder.configure().await {
            self.report_error(cause.to_string()).await;
        }
    }

    fn watch_downloads(self: &Arc<Self>, library: Arc<LibraryRuntime>) {
        let mut events = library.downloads.subscribe();
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Ok(download) = events.recv().await {
                let Some(runtime) = weak.upgrade() else { break };
                runtime.emit(json!({ "type": "library-download", "download": download }));
            }
        });
    }

    async fn finalize(
        &self,
        capture: RecordingCapture,
        poster_wait: Duration,
    ) -> Result<(), String> {
        let id = if capture.id.is_empty() {
            capture.filename.clone()
        } else {
            capture.id.clone()
        };
        // Post-processing writes temporary files beside the capture.
        self.output_swept().await;
        if !self.finalizing.lock().await.insert(id.clone()) {
            return Ok(());
        }
        let result = self.finalize_once(capture, poster_wait).await;
        self.finalizing.lock().await.remove(&id);
        result
    }

    async fn finalize_once(
        &self,
        capture: RecordingCapture,
        poster_wait: Duration,
    ) -> Result<(), String> {
        if !media::capture_sources_present(&capture) {
            // The raw file, or a segment it is joined from, was deleted or
            // moved. Retrying on every start would fail forever, so drop it
            // from the recorder's recovery queue with the segments left.
            media::discard_capture_sources(&capture).await;
            let removed = self
                .recorder
                .remove_capture(&capture.id)
                .await
                .map_err(error)?;
            return Err(format!(
                "Capture file is missing{}: {}",
                if removed { " and was dropped" } else { "" },
                capture.filename
            ));
        }
        let library = self.library_for_capture(&capture).await?;
        // The recorder's capture type is the library's record type, so the
        // finalized record goes straight back to the recorder.
        let mut record = capture;
        media::finalize_capture(&library.library, &mut record)
            .await
            .map_err(error)?;
        let id = {
            let record = record.clone();
            library
                .library
                .off_worker(move |library| library.remember_capture(&record))
                .await
                .map_err(error)?
        };
        self.recorder
            .complete_capture(record.clone())
            .await
            .map_err(error)?;
        let _ = self.preview_sound("clipSaved", false).await;
        // Announce the capture once its poster exists, so the library shows it
        // with its thumbnail and BlurHash from the first render.
        wait_for_poster(&library.library, &id, poster_wait).await;
        let status = self.recorder.get_status().await;
        self.emit(json!({ "type": "capture-ready", "capture": record, "status": status }));
        Ok(())
    }

    /// Selects the library that owns a raw recorder path.
    ///
    /// The current output folder can change while a capture is being finalized.
    /// Keep using an existing library when possible. If the old library has
    /// already been dropped, reopen one for the capture's trusted output root.
    async fn library_for_capture(
        &self,
        capture: &RecordingCapture,
    ) -> Result<Arc<LibraryRuntime>, String> {
        let filename = PathBuf::from(&capture.filename);
        let tracked = {
            let libraries = self.libraries.lock().await;
            libraries
                .iter()
                .filter_map(Weak::upgrade)
                .collect::<Vec<_>>()
        };
        for library in tracked {
            if capture_is_in_output(&filename, library.library.output_folder()) {
                return Ok(library);
            }
        }

        let output = infer_capture_output_folder(&filename, capture.kind).ok_or_else(|| {
            "The capture path is outside the configured output folders.".to_string()
        })?;
        let mut config = self.config.clone();
        config.output_folder = output;
        let library = Self::open_library(config).await?;
        self.libraries.lock().await.push(Arc::downgrade(&library));
        Ok(library)
    }

    /// Reopens the current media library and recorder after an update install
    /// fails after the normal shutdown step. `origin` is the server whose
    /// window is still open; `shutdown` cleared the selection.
    pub async fn resume_after_failed_update(
        self: &Arc<Self>,
        origin: Option<Url>,
    ) -> Result<(), String> {
        let _selection = self.selection_lock.lock().await;
        if let Ok(mut selected) = self.selected.write() {
            selected.clone_from(&origin);
        }
        // `shutdown` ended the shortcuts session. The window keeps running
        // even if a step below fails, so the shortcuts come back first.
        self.shortcuts.resume();
        let settings = self.recorder.get_settings().await;
        let output = if settings.output_folder.is_empty() {
            self.default_output.clone()
        } else {
            PathBuf::from(&settings.output_folder)
        };
        let mut config = self.config.clone();
        config.output_folder = output;
        let replacement = Self::open_library(config).await?;
        replacement
            .files
            .set_selected_origin(self.selected_origin())
            .await
            .map_err(error)?;
        self.libraries
            .lock()
            .await
            .push(Arc::downgrade(&replacement));
        *self.library.write().await = replacement.clone();
        self.watch_downloads(replacement);

        self.recorder.restart().await.map_err(error)?;
        self.emit(json!({ "type": "settings", "settings": settings }));
        Ok(())
    }

    async fn report_error(&self, cause: String) {
        log::warn!("recording error: {cause}");
        self.emit(
            json!({ "type": "error", "error": cause, "status": self.recorder.get_status().await }),
        );
    }

    /// Selects the server whose window may use the library, or none. Pending
    /// downloads for the previous server are cancelled, and media URLs handed
    /// to it stop working.
    pub async fn select_server(&self, origin: Option<Url>) -> Result<(), String> {
        let _selection = self.selection_lock.lock().await;
        self.select_server_locked(origin).await
    }

    async fn select_server_locked(&self, origin: Option<Url>) -> Result<(), String> {
        if let Ok(mut selected) = self.selected.write() {
            selected.clone_from(&origin);
        }
        let mut tracked = self.libraries.lock().await;
        tracked.retain(|library| library.strong_count() > 0);
        for library in tracked.iter().filter_map(Weak::upgrade) {
            for job in library.downloads.list() {
                library.downloads.cancel(&job.clip_id);
            }
            library.downloads.clear_selected_server().map_err(error)?;
            library
                .files
                .set_selected_origin(origin.clone())
                .await
                .map_err(error)?;
        }
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        let _selection = self.selection_lock.lock().await;
        // First, so a failed deselect doesn't leave the session listening.
        self.shortcuts.shutdown().await;
        self.select_server_locked(None).await?;
        let stopped = self.recorder.shutdown().await;
        let libraries = self
            .libraries
            .lock()
            .await
            .iter()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for library in libraries {
            // A finished download waits for its poster; cancelled media work
            // ends that wait at once.
            library.library.cancel_media();
            // A cancelled download still removes its partial file, which has
            // to happen before the process exits.
            library.downloads.shutdown().await;
            library.library.shutdown_media().await;
        }
        if !stopped {
            return Err("The recorder did not stop cleanly.".into());
        }
        Ok(())
    }

    /// Saves recording settings. A new capture folder gets its own library
    /// runtime before the recorder starts saving into it.
    async fn apply_settings(
        self: &Arc<Self>,
        settings: RecordingSettings,
    ) -> Result<RecordingSettings, String> {
        // Reject bad input before a new capture folder gets created.
        self.recorder.validate(&settings).map_err(error)?;
        let previous = self.recorder.get_settings().await;
        if previous.output_folder != settings.output_folder {
            let mut config = self.config.clone();
            config.output_folder = if settings.output_folder.is_empty() {
                self.default_output.clone()
            } else {
                PathBuf::from(&settings.output_folder)
            };
            let replacement = Self::open_library(config).await?;
            let _selection = self.selection_lock.lock().await;
            let origin = self.selected_origin().ok_or(NOT_SELECTED)?;
            replacement
                .files
                .set_selected_origin(Some(origin))
                .await
                .map_err(error)?;
            self.recorder
                .set_settings(settings.clone())
                .await
                .map_err(error)?;
            self.libraries
                .lock()
                .await
                .push(Arc::downgrade(&replacement));
            *self.library.write().await = replacement.clone();
            self.watch_downloads(replacement);
        } else {
            self.recorder
                .set_settings(settings.clone())
                .await
                .map_err(error)?;
        }
        // A configured recorder can save replays, whose cross-drive copies
        // land beside the captures.
        self.output_swept().await;
        self.recorder.configure().await.map_err(error)?;
        self.emit(json!({ "type": "settings", "settings": settings }));
        Ok(settings)
    }

    /// Runs a `recording.*` operation of the bridge with the renderer's
    /// arguments. Operations that need a native dialog, the window's cookies,
    /// or the file manager run in the shell, which calls the methods below.
    pub async fn invoke(
        self: &Arc<Self>,
        operation: &str,
        args: &[Value],
    ) -> Result<Value, String> {
        let library = self.library.read().await.clone();
        match operation {
            "recording.getSettings" => to_value(self.recorder.get_settings().await),
            "recording.setSettings" => {
                let settings: RecordingSettings = arg(args, 0)?;
                // Only the folder picker (`set_output_folder`) chooses a new
                // capture folder; the web app may keep the current one or
                // reset it to the default.
                let current = self.recorder.get_settings().await;
                if !settings.output_folder.is_empty()
                    && settings.output_folder != current.output_folder
                {
                    return Err(OUTPUT_FOLDER_PICKER_ONLY.into());
                }
                to_value(self.apply_settings(settings).await?)
            }
            "recording.restartBackend" => {
                self.output_swept().await;
                to_value(self.recorder.restart().await.map_err(error)?)
            }
            "recording.getStatus" => to_value(self.recorder.get_status().await),
            "recording.getShortcuts" => to_value(self.shortcuts.state()),
            "recording.bindShortcuts" => to_value(self.shortcuts.bind_again().await?),
            "recording.configureShortcuts" => {
                self.shortcuts.configure().await?;
                Ok(Value::Null)
            }
            "recording.getStorageInfo" => {
                to_value(self.recorder.storage_info().await.map_err(error)?)
            }
            "recording.getLibrary" => {
                let mut snapshot = library
                    .library
                    .off_worker(|library| library.snapshot())
                    .await
                    .map_err(error)?;
                for item in &mut snapshot.items {
                    set_item_urls(&library, item)?;
                }
                for group in &mut snapshot.groups {
                    for item in &mut group.items {
                        set_item_urls(&library, item)?;
                    }
                }
                to_value(snapshot)
            }
            "recording.exportLibraryCapture" => {
                let mut export = media::export(&library.library, arg(args, 0)?)
                    .await
                    .map_err(error)?;
                let media_url = if export.whole_capture {
                    library.files.media_url(&export.id)
                } else {
                    library.files.export_url(&export.id)
                };
                export.media_url = match media_url {
                    Ok(media_url) => media_url,
                    Err(cause) => {
                        // The renderer never learns this id, so it cannot
                        // give back the lease the render was handed out on.
                        if !export.whole_capture {
                            let _ = library.library.release_export(&export.id).await;
                        }
                        return Err(error(cause));
                    }
                };
                to_value(export)
            }
            "recording.releaseLibraryExport" => {
                library
                    .library
                    .release_export(&arg::<String>(args, 0)?)
                    .await
                    .map_err(error)?;
                Ok(Value::Null)
            }
            "recording.updateLibraryCapture" => {
                let patch = arg(args, 0)?;
                let id = library
                    .library
                    .off_worker(move |library| library.update_metadata(patch))
                    .await
                    .map_err(error)?;
                Ok(json!({ "id": id }))
            }
            "recording.setLibraryCaptureTrim" => {
                let update = arg(args, 0)?;
                let id = library
                    .library
                    .off_worker(move |library| library.set_trim(update))
                    .await
                    .map_err(error)?;
                Ok(json!({ "id": id }))
            }
            "recording.deleteLibraryCapture" => {
                let id: String = arg(args, 0)?;
                library
                    .library
                    .off_worker(move |library| library.delete(&id))
                    .await
                    .map_err(error)?;
                Ok(Value::Null)
            }
            "recording.commitStagedLibraryImport" => {
                self.output_swept().await;
                let id = library
                    .library
                    .commit_staged(arg(args, 0)?)
                    .await
                    .map_err(error)?;
                wait_for_poster(&library.library, &id, POSTER_WAIT).await;
                Ok(json!({ "id": id }))
            }
            "recording.discardStagedLibraryImport" => {
                library
                    .library
                    .discard_staged(&arg::<String>(args, 0)?)
                    .await
                    .map_err(error)?;
                Ok(Value::Null)
            }
            "recording.cancelClipDownload" => {
                library.downloads.cancel(&arg::<String>(args, 0)?);
                Ok(Value::Null)
            }
            "recording.listClipDownloads" => to_value(library.downloads.list()),
            "recording.listGameProcesses" => {
                to_value(self.recorder.list_game_processes().await.map_err(error)?)
            }
            "recording.listDisplays" => {
                to_value(self.recorder.list_displays().await.map_err(error)?)
            }
            "recording.subscribeAudioLevels" => {
                self.recorder
                    .subscribe_audio_levels()
                    .await
                    .map_err(error)?;
                Ok(Value::Null)
            }
            "recording.stopAudioLevels" => {
                self.recorder.stop_audio_levels().await.map_err(error)?;
                Ok(Value::Null)
            }
            "recording.listNotificationSounds" => {
                let mut files = Vec::new();
                for entry in std::fs::read_dir(&self.sounds).map_err(error)?.take(500) {
                    let entry = entry.map_err(error)?;
                    if entry.file_type().map_err(error)?.is_file() && is_sound(&entry.path()) {
                        files.push(json!({ "name": entry.file_name().to_string_lossy(), "path": entry.path().to_string_lossy() }));
                    }
                }
                Ok(json!({ "replayBufferStarted": files, "clipSaved": files }))
            }
            "recording.previewNotificationSound" => {
                self.preview_sound(&arg::<String>(args, 0)?, true).await?;
                Ok(Value::Null)
            }
            _ => Err("Unknown native recording operation.".into()),
        }
    }

    /// The file a capture's "show in folder" action selects.
    pub async fn reveal_path(&self, id: String) -> Result<PathBuf, String> {
        let library = self.library.read().await.clone();
        library
            .library
            .off_worker(move |library| library.reveal_path(&id))
            .await
            .map_err(error)
    }

    /// Stages the media file the user picked for import. A file that cannot
    /// be imported fails with its name and the reason.
    pub async fn stage_import(&self, path: PathBuf) -> Result<Value, String> {
        let library = self.library.read().await.clone();
        let staged = library.library.stage_file(&path).await.map_err(|cause| {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "file".into());
            format!("{name}: {cause}")
        })?;
        to_value(&staged)
    }

    /// Makes the folder the user picked the capture folder and returns it.
    pub async fn set_output_folder(self: &Arc<Self>, folder: PathBuf) -> Result<Value, String> {
        let mut settings = self.recorder.get_settings().await;
        settings.output_folder = folder.to_string_lossy().into_owned();
        let settings = self.apply_settings(settings).await?;
        to_value(&settings.output_folder)
    }

    /// Starts downloading a clip from `origin`, the server the shell has
    /// selected, never one the renderer names. `cookie` is that server's
    /// session cookie header from the selected window's profile.
    pub async fn download_clip(
        &self,
        origin: Url,
        cookie: String,
        request: Value,
    ) -> Result<Value, String> {
        self.output_swept().await;
        let _selection = self.selection_lock.lock().await;
        let selected = self.selected_origin().ok_or(NOT_SELECTED)?;
        if selected.origin() != origin.origin() {
            return Err(NOT_SELECTED.into());
        }
        let library = self.library.read().await.clone();
        library
            .downloads
            .set_selected_server(selected, Some(cookie))
            .map_err(error)?;
        let request = serde_json::from_value(request).map_err(|_| INVALID_ARGUMENT)?;
        to_value(library.downloads.start(request).map_err(error)?)
    }

    /// The shared notification sounds folder, for the event's settings row.
    pub fn notification_sounds_folder(&self, event: &str) -> Result<PathBuf, String> {
        sound_file(event)?;
        Ok(self.sounds.clone())
    }

    /// Waits until `start` has swept the capture folder.
    async fn output_swept(&self) {
        let _ = self.output_swept.subscribe().wait_for(|swept| *swept).await;
    }

    fn selected_origin(&self) -> Option<Url> {
        self.selected.read().ok()?.clone()
    }

    async fn preview_sound(&self, event: &str, preview: bool) -> Result<(), String> {
        let default_file = sound_file(event)?;
        let settings = self.recorder.get_settings().await;
        let sound = if event == "clipSaved" {
            settings.notification_sounds.clip_saved
        } else {
            settings.notification_sounds.replay_buffer_started
        };
        if !preview && !sound.enabled {
            return Ok(());
        }
        let path = if sound.path.is_empty() {
            self.sounds.join(default_file)
        } else {
            PathBuf::from(sound.path)
        };
        let path = path.canonicalize().map_err(error)?;
        if !path.starts_with(self.sounds.canonicalize().map_err(error)?) || !is_sound(&path) {
            return Err("Select a sound from the notification sounds folder.".into());
        }
        self.recorder
            .play_notification_sound(PlayNotificationSoundRequest {
                path: path.to_string_lossy().into_owned(),
                volume: sound.volume as f32 / 100.0,
            })
            .await
            .map_err(error)
    }
}

const NOT_SELECTED: &str = "The server window is no longer active.";
const INVALID_ARGUMENT: &str = "Invalid native argument.";
const OUTPUT_FOLDER_PICKER_ONLY: &str = "Choose a new capture folder with the folder picker.";

fn set_item_urls(
    library: &LibraryRuntime,
    item: &mut crate::capture_library::LibraryItem,
) -> Result<(), String> {
    item.media_url = library.files.media_url(&item.id).map_err(error)?;
    item.thumbnail_url = Some(library.files.thumbnail_url(&item.id).map_err(error)?);
    Ok(())
}

fn arg<T: DeserializeOwned>(args: &[Value], index: usize) -> Result<T, String> {
    serde_json::from_value(args.get(index).cloned().ok_or("Missing native argument.")?)
        .map_err(|_| INVALID_ARGUMENT.into())
}

fn to_value(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(logged("Could not encode the native result."))
}

fn error(cause: impl std::fmt::Display) -> String {
    cause.to_string()
}

fn sound_file(event: &str) -> Result<&'static str, String> {
    match event {
        "clipSaved" => Ok("clip_saved.wav"),
        "replayBufferStarted" => Ok("start_recording.wav"),
        _ => Err("Unknown notification sound.".into()),
    }
}

fn is_sound(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            ["wav", "mp3", "ogg", "m4a", "aac", "flac"].contains(&ext.to_ascii_lowercase().as_str())
        })
}

/// Whether a capture path lies below an output folder. The capture may not
/// exist yet: a disk replay is joined into its destination only when it is
/// finalized, so its folder stands in for it.
fn capture_is_in_output(filename: &Path, output: &Path) -> bool {
    let Ok(output) = output.canonicalize() else {
        return false;
    };
    let Ok(folder) = filename
        .parent()
        .ok_or(())
        .and_then(|parent| parent.canonicalize().map_err(|_| ()))
    else {
        return false;
    };
    folder.starts_with(output)
}

fn infer_capture_output_folder(filename: &Path, kind: RecordingCaptureKind) -> Option<PathBuf> {
    if !filename.is_absolute() {
        return None;
    }
    let collection = collection_for(kind);
    filename.ancestors().find_map(|ancestor| {
        (ancestor.file_name().and_then(|name| name.to_str()) == Some(collection))
            .then(|| ancestor.parent().map(Path::to_path_buf))
            .flatten()
    })
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}
