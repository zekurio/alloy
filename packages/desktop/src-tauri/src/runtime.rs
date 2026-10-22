use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};
use std::time::Duration;

use alloy_desktop::capture_library::{
    CaptureHttpServer, CaptureLibrary, CaptureLibraryConfig, collection_for,
    download::DownloadManager,
    media,
    poster::{POSTER_WAIT, wait_for_poster},
};
use alloy_desktop::login::{LEGACY_ACCESS_COOKIE, SESSION_COOKIE};
use alloy_desktop::recording_host::{
    PlayNotificationSoundRequest, RecorderHost, RecorderHostOptions, RecordingCapture,
    RecordingCaptureKind, RecordingEvent, RecordingSettings, SaveReplayClipRequest,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::sync::{Mutex, RwLock, watch};
use url::Url;

use crate::{Host, require_remote_window};

pub struct LibraryRuntime {
    pub library: CaptureLibrary,
    pub files: CaptureHttpServer,
    pub downloads: DownloadManager,
}

pub struct DesktopRuntime {
    pub recorder: RecorderHost,
    pub library: RwLock<Arc<LibraryRuntime>>,
    pub selection_lock: Mutex<()>,
    app: AppHandle,
    host: Weak<Host>,
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
}

impl DesktopRuntime {
    pub async fn new(app: &AppHandle, host: Weak<Host>) -> Result<Arc<Self>, String> {
        // Settings, the saved-server list and the library manifest live in the
        // roaming app data folder. Regenerable data (thumbnails, import staging,
        // export renders, recorder scratch, detection caches) lives in the
        // local one so it never syncs with a roaming profile.
        let data = app.path().app_data_dir().map_err(error)?;
        let cache = app.path().app_local_data_dir().map_err(error)?;
        let output = app.path().video_dir().map_err(error)?.join("Alloy");
        let resources = app.path().resource_dir().map_err(error)?;
        let package = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        // Debug builds read the agent, the OBS runtime and the media tools from
        // the staging folder the build scripts fill; bundles read them from the
        // packaged resource directory.
        let native_root = if cfg!(debug_assertions) {
            package.join("resources")
        } else {
            resources
        };
        let executable = std::env::var_os("ALLOY_RECORDER_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| native_root.join("agent/alloy-agent.exe"));
        let obs = std::env::var_os("ALLOY_OBS_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| native_root.join("obs-runtime"));
        let recorder = RecorderHost::new(
            RecorderHostOptions::new(executable, &data)
                .cache_dir(&cache)
                .output_folder(&output)
                .replay_scratch_folder(app.path().temp_dir().map_err(error)?.join("Alloy/replay"))
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
                .unwrap_or_else(|| native_root.join("ffmpeg").join(format!("{name}.exe")))
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
        // export or poster is being written into the cache yet.
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
            app: app.clone(),
            host,
            config,
            sounds,
            startup_error: Mutex::new(startup_error),
            output_swept: watch::Sender::new(false),
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

    pub fn emit(&self, event: Value) {
        if let Some(host) = self.host.upgrade()
            && let Ok(remote) = host.remote.read()
            && let Some(remote) = remote.as_ref()
        {
            let _ = self
                .app
                .emit_to(remote.window.label(), "alloy:recording", event);
        }
    }

    fn start_events(self: &Arc<Self>) {
        let mut events = self.recorder.subscribe_events();
        let weak = Arc::downgrade(self);
        tauri::async_runtime::spawn(async move {
            loop {
                let event = match events.recv().await {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                };
                let Some(runtime) = weak.upgrade() else { break };
                match event {
                    RecordingEvent::ClipHotkey | RecordingEvent::ScreenshotHotkey => {
                        let screenshot = matches!(event, RecordingEvent::ScreenshotHotkey);
                        tauri::async_runtime::spawn(async move {
                            let result = if screenshot {
                                runtime.recorder.save_screenshot().await
                            } else {
                                let settings = runtime.recorder.get_settings().await;
                                runtime
                                    .recorder
                                    .save_replay_clip(SaveReplayClipRequest {
                                        requested_at_unix_ms: unix_ms(),
                                        duration_seconds: settings.replay_buffer_seconds,
                                    })
                                    .await
                            };
                            if let Err(cause) = result {
                                runtime.report_error(cause.to_string()).await;
                            }
                        });
                    }
                    RecordingEvent::CaptureReady { capture, .. } => {
                        tauri::async_runtime::spawn(async move {
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
        let _ = tauri::async_runtime::spawn_blocking(move || {
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
        tauri::async_runtime::spawn_blocking(move || library.library.remove_orphans());
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
        tauri::async_runtime::spawn(async move {
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
    /// fails after the normal shutdown step.
    pub async fn resume_after_failed_update(self: &Arc<Self>) -> Result<(), String> {
        let _selection = self.selection_lock.lock().await;
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
            .set_selected_origin(self.current_origin())
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

    pub async fn select_server(&self, origin: Option<Url>) -> Result<(), String> {
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
        self.select_server(None).await?;
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
        window: &WebviewWindow,
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
            let origin = self.selected(window)?;
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

    pub async fn invoke(
        self: &Arc<Self>,
        window: &WebviewWindow,
        operation: &str,
        args: &[Value],
    ) -> Result<Value, String> {
        let library = self.library.read().await.clone();
        match operation {
            "recording.getSettings" => to_value(self.recorder.get_settings().await),
            "recording.setSettings" => to_value(self.apply_settings(window, arg(args, 0)?).await?),
            "recording.restartBackend" => {
                self.output_swept().await;
                to_value(self.recorder.restart().await.map_err(error)?)
            }
            "recording.getStatus" => to_value(self.recorder.get_status().await),
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
                export.media_url = if export.whole_capture {
                    library.files.media_url(&export.id)
                } else {
                    library.files.export_url(&export.id)
                }
                .map_err(error)?;
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
            "recording.revealLibraryCapture" => {
                let id: String = arg(args, 0)?;
                let path = library
                    .library
                    .off_worker(move |library| library.reveal_path(&id))
                    .await
                    .map_err(error)?;
                reveal(&path)?;
                Ok(Value::Null)
            }
            "recording.importLibraryFiles" => {
                // The web app imports one file per pick; the result keeps its
                // list shape for older web builds.
                let picked = rfd::AsyncFileDialog::new()
                    .add_filter(
                        "Videos and images",
                        &["mp4", "mkv", "mov", "webm", "png", "jpg", "jpeg", "webp"],
                    )
                    .pick_file()
                    .await;
                self.selected(window)?;
                let Some(picked) = picked else {
                    return Ok(json!({ "staged": [], "failed": [], "canceled": true }));
                };
                let paths = vec![picked.path().to_path_buf()];
                to_value(library.library.stage_files(&paths).await)
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
            "recording.downloadClip" => {
                self.output_swept().await;
                let _selection = self.selection_lock.lock().await;
                let origin = self.selected(window)?;
                let cookies = window.cookies_for_url(origin.clone()).map_err(error)?;
                self.selected(window)?;
                // Never the legacy refresh cookie: a server from before
                // sessions stopped rotating would spend it on this request
                // and the webview would keep the spent token.
                let cookie = cookies
                    .iter()
                    .filter(|cookie| {
                        [SESSION_COOKIE, LEGACY_ACCESS_COOKIE].contains(&cookie.name())
                    })
                    .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
                    .collect::<Vec<_>>()
                    .join("; ");
                library
                    .downloads
                    .set_selected_server(origin, Some(cookie))
                    .map_err(error)?;
                to_value(library.downloads.start(arg(args, 0)?).map_err(error)?)
            }
            "recording.cancelClipDownload" => {
                library.downloads.cancel(&arg::<String>(args, 0)?);
                Ok(Value::Null)
            }
            "recording.listClipDownloads" => to_value(library.downloads.list()),
            "recording.selectOutputFolder" => {
                let folder = rfd::AsyncFileDialog::new().pick_folder().await;
                self.selected(window)?;
                let Some(folder) = folder else {
                    return Ok(Value::Null);
                };
                // Picking the folder applies it. Web builds before this only
                // reload the settings after the picker returns; newer ones
                // save the folder themselves when the settings lack it.
                let mut settings = self.recorder.get_settings().await;
                settings.output_folder = folder.path().to_string_lossy().into_owned();
                let settings = self.apply_settings(window, settings).await?;
                to_value(&settings.output_folder)
            }
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
            "recording.openNotificationSoundsFolder" => {
                sound_file(&arg::<String>(args, 0)?)?;
                open::that(&self.sounds).map_err(error)?;
                Ok(Value::Null)
            }
            "recording.previewNotificationSound" => {
                self.preview_sound(&arg::<String>(args, 0)?, true).await?;
                Ok(Value::Null)
            }
            _ => Err("Unknown native recording operation.".into()),
        }
    }

    /// Waits until `start` has swept the capture folder.
    async fn output_swept(&self) {
        let _ = self.output_swept.subscribe().wait_for(|swept| *swept).await;
    }

    fn selected(&self, window: &WebviewWindow) -> Result<Url, String> {
        let host = self.host.upgrade().ok_or("The desktop host has stopped.")?;
        require_remote_window(window, &host).map(|(_, origin)| origin)
    }

    fn current_origin(&self) -> Option<Url> {
        let host = self.host.upgrade()?;
        let remote = host.remote.read().ok()?;
        remote.as_ref().map(|session| session.origin.clone())
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

fn set_item_urls(
    library: &LibraryRuntime,
    item: &mut alloy_desktop::capture_library::LibraryItem,
) -> Result<(), String> {
    item.media_url = library.files.media_url(&item.id).map_err(error)?;
    item.thumbnail_url = Some(library.files.thumbnail_url(&item.id).map_err(error)?);
    Ok(())
}

pub fn arg<T: DeserializeOwned>(args: &[Value], index: usize) -> Result<T, String> {
    serde_json::from_value(args.get(index).cloned().ok_or("Missing native argument.")?)
        .map_err(|_| "Invalid native argument.".into())
}

pub fn to_value(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(error)
}
pub fn error(cause: impl std::fmt::Display) -> String {
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

fn reveal(path: &Path) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map_err(error)?;
    Ok(())
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}
