use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, COOKIE, HeaderValue, LOCATION};
use reqwest::{Client, StatusCode};
use tokio::io::AsyncWriteExt;
use tokio::sync::broadcast;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::capture_library::error::{LibraryError, Result};
use crate::capture_library::paths::{extension_for_content_type, safe_component};
use crate::capture_library::store::CaptureLibrary;
use crate::capture_library::types::{DownloadRequest, DownloadState, DownloadStatus};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);
const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_TITLE_LENGTH: usize = 256;
const MAX_NAME_ATTEMPTS: u32 = 10_000;

#[derive(Clone)]
pub struct DownloadManager {
    library: CaptureLibrary,
    client: Client,
    server: Arc<RwLock<Option<SelectedServer>>>,
    jobs: Arc<Mutex<HashMap<String, DownloadJob>>>,
    events: broadcast::Sender<DownloadState>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SelectedServer {
    origin: Url,
    cookie_header: Option<String>,
}

struct DownloadJob {
    state: DownloadState,
    cancel: CancellationToken,
}

impl DownloadManager {
    pub fn new(library: CaptureLibrary) -> Result<Self> {
        crate::server::install_crypto_provider();
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| LibraryError::Download(error.to_string()))?;
        Ok(Self::with_client(library, client))
    }

    fn with_client(library: CaptureLibrary, client: Client) -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
            library,
            client,
            server: Arc::new(RwLock::new(None)),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }

    /// Updates the selected server and its native cookie snapshot. The URL is
    /// used only to construct the fixed clip download route below.
    pub fn set_selected_server(&self, origin: Url, cookie_header: Option<String>) -> Result<()> {
        let origin = normalize_origin(origin)?;
        if let Some(cookie) = cookie_header.as_deref() {
            HeaderValue::from_str(cookie)
                .map_err(|_| LibraryError::InvalidMetadata("invalid cookie snapshot".into()))?;
        }
        let selected = SelectedServer {
            origin,
            cookie_header,
        };
        if self
            .server
            .read()
            .map_err(|_| LibraryError::Download("server state is unavailable".into()))?
            .as_ref()
            == Some(&selected)
        {
            return Ok(());
        }
        self.cancel_all();
        let mut server = self
            .server
            .write()
            .map_err(|_| LibraryError::Download("server state is unavailable".into()))?;
        *server = Some(selected);
        Ok(())
    }

    pub fn clear_selected_server(&self) -> Result<()> {
        self.cancel_all();
        let mut server = self
            .server
            .write()
            .map_err(|_| LibraryError::Download("server state is unavailable".into()))?;
        *server = None;
        Ok(())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DownloadState> {
        self.events.subscribe()
    }

    pub fn list(&self) -> Vec<DownloadState> {
        self.jobs
            .lock()
            .expect("download lock poisoned")
            .values()
            .map(|job| job.state.clone())
            .collect()
    }

    pub fn start(&self, request: DownloadRequest) -> Result<DownloadState> {
        validate_request(&request)?;
        if request
            .size_bytes
            .is_some_and(|size| size > self.library.config().max_download_bytes)
        {
            return Err(LibraryError::Download("clip exceeds download limit".into()));
        }
        let mut jobs = self.jobs.lock().expect("download lock poisoned");
        if let Some(existing) = jobs.get(&request.clip_id)
            && matches!(existing.state.status, DownloadStatus::Downloading)
        {
            return Ok(existing.state.clone());
        }
        let state = DownloadState {
            clip_id: request.clip_id.clone(),
            title: request.title.clone(),
            status: DownloadStatus::Downloading,
            received_bytes: 0,
            total_bytes: request.size_bytes,
            error: None,
            library_item_id: None,
            started_at: crate::capture_library::paths::now_rfc3339(),
        };
        let token = CancellationToken::new();
        jobs.insert(
            request.clip_id.clone(),
            DownloadJob {
                state: state.clone(),
                cancel: token.clone(),
            },
        );
        drop(jobs);
        self.emit(state.clone());
        let manager = self.clone();
        tokio::spawn(async move {
            manager.run(request, token).await;
        });
        Ok(state)
    }

    pub fn cancel(&self, clip_id: &str) {
        let job = self
            .jobs
            .lock()
            .expect("download lock poisoned")
            .remove(clip_id);
        if let Some(job) = job {
            job.cancel.cancel();
        }
    }

    /// Cancels and forgets every active or finished job. Shells call this
    /// before replacing the selected server or dropping the library runtime.
    pub fn cancel_all(&self) {
        let jobs = self
            .jobs
            .lock()
            .expect("download lock poisoned")
            .drain()
            .map(|(_, job)| job)
            .collect::<Vec<_>>();
        for job in jobs {
            job.cancel.cancel();
        }
    }

    async fn run(&self, request: DownloadRequest, cancel: CancellationToken) {
        let result = self.run_download(&request, &cancel).await;
        match result {
            Ok(id) => {
                if let Some(state) = self.update(&request.clip_id, |state| {
                    state.status = DownloadStatus::Completed;
                    state.library_item_id = Some(id);
                }) {
                    self.emit(state);
                }
            }
            Err(LibraryError::DownloadCancelled) => {}
            Err(error) => {
                if let Some(state) = self.update(&request.clip_id, |state| {
                    state.status = DownloadStatus::Failed;
                    state.error = Some(error.to_string());
                }) {
                    self.emit(state);
                }
            }
        }
    }

    async fn run_download(
        &self,
        request: &DownloadRequest,
        cancel: &CancellationToken,
    ) -> Result<String> {
        let server = self
            .server
            .read()
            .map_err(|_| LibraryError::Download("server state is unavailable".into()))?
            .clone()
            .ok_or_else(|| LibraryError::Download("no server is selected".into()))?;
        let url = server
            .origin
            .join(&format!("api/clips/{}/download", request.clip_id))?;
        let mut builder = self.client.get(url.clone());
        if let Some(cookie) = server.cookie_header {
            builder = builder.header(COOKIE, cookie);
        }
        let response = tokio::select! {
            _ = cancel.cancelled() => return Err(LibraryError::DownloadCancelled),
            result = builder.send() => result.map_err(|error| LibraryError::Download(error.to_string()))?,
        };
        if response.status().is_redirection() || response.headers().contains_key(LOCATION) {
            return Err(LibraryError::Download(
                "server redirected the clip download".into(),
            ));
        }
        if response.status() != StatusCode::OK {
            return Err(LibraryError::Download(format!(
                "server answered {}",
                response.status()
            )));
        }
        let response_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        let extension = format!(
            ".{}",
            extension_for_content_type(&response_type).ok_or_else(|| LibraryError::Download(
                "server returned unsupported media".into()
            ))?
        );
        let response_length = response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok());
        let max_bytes = self.library.config().max_download_bytes;
        if response_length.is_some_and(|size| size > max_bytes) {
            return Err(LibraryError::Download("clip exceeds download limit".into()));
        }
        if let Some(size) = response_length {
            self.set_total(&request.clip_id, size);
        }

        let collection = if response_type.starts_with("image/") {
            "Screenshots"
        } else {
            "Clips"
        };
        let group = safe_component(request.game_name.as_deref(), "Uncategorized");
        let root = self.library.output_folder().join(collection).join(group);
        tokio::fs::create_dir_all(&root).await?;
        let base = safe_component(Some(request.title.as_str()), "clip");
        let (destination, partial) = reserve_destination(&root, &base, &extension)?;
        let received = match self
            .write_response(
                &request.clip_id,
                response,
                &partial,
                response_length,
                max_bytes,
                cancel,
            )
            .await
        {
            Ok(received) => received,
            Err(error) => {
                let _ = tokio::fs::remove_file(&partial).await;
                return Err(error);
            }
        };
        if cancel.is_cancelled() {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(LibraryError::DownloadCancelled);
        }
        if received == 0 {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(LibraryError::Download(
                "server returned an empty file".into(),
            ));
        }
        if response_length.is_some_and(|size| size != received) {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(LibraryError::Download(
                "server sent an incomplete file".into(),
            ));
        }
        if let Err(error) = tokio::fs::rename(&partial, &destination).await {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(error.into());
        }
        if cancel.is_cancelled() {
            let _ = tokio::fs::remove_file(&destination).await;
            return Err(LibraryError::DownloadCancelled);
        }
        match self
            .library
            .register_download(request, &destination, &response_type, received)
        {
            Ok(id) => Ok(id),
            Err(error) => {
                let _ = tokio::fs::remove_file(&destination).await;
                Err(error)
            }
        }
    }

    async fn write_response(
        &self,
        clip_id: &str,
        response: reqwest::Response,
        partial: &Path,
        response_length: Option<u64>,
        max_bytes: u64,
        cancel: &CancellationToken,
    ) -> Result<u64> {
        // The partial file was reserved by `reserve_destination`; opening it
        // for writing without `create` keeps that reservation meaningful.
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(partial)
            .await?;
        let mut stream = response.bytes_stream();
        let mut received = 0_u64;
        let mut last_emit = Instant::now() - PROGRESS_INTERVAL;
        loop {
            let next = timeout(DOWNLOAD_IDLE_TIMEOUT, stream.next());
            let chunk = tokio::select! {
                _ = cancel.cancelled() => return Err(LibraryError::DownloadCancelled),
                result = next => result.map_err(|_| LibraryError::Download("download timed out".into()))?,
            };
            let Some(chunk) = chunk else { break };
            let chunk = chunk.map_err(|error| LibraryError::Download(error.to_string()))?;
            received = received.saturating_add(chunk.len() as u64);
            if received > max_bytes {
                return Err(LibraryError::Download("clip exceeds download limit".into()));
            }
            if response_length.is_some_and(|size| received > size) {
                return Err(LibraryError::Download("server sent too many bytes".into()));
            }
            file.write_all(&chunk).await?;
            if last_emit.elapsed() >= PROGRESS_INTERVAL {
                last_emit = Instant::now();
                if let Some(state) = self.update(clip_id, |state| {
                    state.received_bytes = received;
                }) {
                    self.emit(state);
                }
            }
        }
        file.sync_all().await?;
        Ok(received)
    }

    fn update(
        &self,
        clip_id: &str,
        update: impl FnOnce(&mut DownloadState),
    ) -> Option<DownloadState> {
        let mut jobs = self.jobs.lock().expect("download lock poisoned");
        let job = jobs.get_mut(clip_id)?;
        update(&mut job.state);
        Some(job.state.clone())
    }

    fn set_total(&self, clip_id: &str, total: u64) {
        if let Some(state) = self.update(clip_id, |state| state.total_bytes = Some(total)) {
            self.emit(state);
        }
    }

    fn emit(&self, state: DownloadState) {
        let _ = self.events.send(state);
    }
}

fn validate_request(request: &DownloadRequest) -> Result<()> {
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

fn normalize_origin(origin: Url) -> Result<Url> {
    if !matches!(origin.scheme(), "http" | "https")
        || origin.username() != ""
        || origin.password().is_some()
        || !origin.path().is_empty() && origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err(LibraryError::InvalidMetadata(
            "invalid server origin".into(),
        ));
    }
    Ok(origin)
}

/// Claims a free destination name by creating its `.part` file exclusively.
/// Two downloads whose titles sanitize to the same name would otherwise pick
/// the same partial file and overwrite each other's bytes.
fn reserve_destination(root: &Path, base: &str, extension: &str) -> Result<(PathBuf, PathBuf)> {
    for counter in 1..=MAX_NAME_ATTEMPTS {
        let destination = root.join(if counter == 1 {
            format!("{base}{extension}")
        } else {
            format!("{base}-{counter}{extension}")
        });
        if destination.exists() {
            continue;
        }
        let partial = partial_path(&destination);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
        {
            Ok(_) => return Ok((destination, partial)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(LibraryError::Download(
        "could not reserve a file name".into(),
    ))
}

fn partial_path(destination: &Path) -> PathBuf {
    destination.with_extension(format!(
        "{}part",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!("{value}."))
            .unwrap_or_default()
    ))
}
