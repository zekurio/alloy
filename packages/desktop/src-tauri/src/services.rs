use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::broadcast;

use alloy_desktop::logging::logged;
use alloy_desktop::server::{
    HTTP_CONTRACT_1, MAX_SAFE_INTEGER, TAURI_BRIDGE_CONTRACT_1, server_origin,
};
use url::Url;

use tauri_plugin_updater::UpdaterExt;

const PREFERENCES_FILE: &str = "preferences.json";
const WINDOW_STATE_KEY: &str = "window";
const MAX_SAVED_SERVERS: usize = 8;
const UPDATE_UNSUPPORTED_ERROR: &str = "Automatic updates are unavailable in this build.";
const CHECK_FAILED: &str = "Couldn't check for updates.";
/// The smallest window the web app can lay out in, matching the builders in
/// `main.rs`.
pub const MIN_WINDOW_WIDTH: u32 = 800;
pub const MIN_WINDOW_HEIGHT: u32 = 600;
/// Upper bound for a persisted size, so a corrupted preferences file cannot
/// ask for an absurd window.
const MAX_WINDOW_DIMENSION: u32 = 16_384;

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The wire shape shared with `DesktopSavedServer` in the renderer contract.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSavedServer {
    pub server_url: String,
    pub last_connected_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    pub http_contract: u64,
    pub bridge_contract: u64,
}

/// Window geometry remembered across restarts. Sizes are logical pixels, so a
/// display scale change keeps the same apparent size.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindowState {
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl DesktopWindowState {
    /// Builds a state that is safe to restore: a window no smaller than the
    /// web app's minimum and no larger than any real display.
    pub fn clamped(width: u32, height: u32, maximized: bool) -> Self {
        Self {
            width: width.clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_DIMENSION),
            height: height.clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_DIMENSION),
            maximized,
        }
    }
}

/// Persistent desktop state lives in a small JSON file. Unknown fields stay in
/// the document when one service changes its settings, so other native
/// services can use the same file without losing theirs.
#[derive(Debug)]
pub struct PreferencesStore {
    path: PathBuf,
    /// Held for each read-modify-write, so a window size save and a server
    /// change cannot each write back a document without the other's edit.
    writes: Mutex<()>,
}

/// What the preferences file holds when it can be read at all.
enum StoredDocument {
    Valid(Map<String, Value>),
    /// The file exists but is not a JSON object.
    Corrupt,
}

impl PreferencesStore {
    pub fn new(state_dir: impl Into<PathBuf>) -> Self {
        Self {
            path: state_dir.into().join(PREFERENCES_FILE),
            writes: Mutex::new(()),
        }
    }

    pub fn get_servers(&self) -> Vec<DesktopSavedServer> {
        normalize_servers(self.read_document().get("servers"))
    }

    pub fn get_current_server(&self) -> Option<String> {
        self.get_servers()
            .first()
            .map(|server| server.server_url.clone())
    }

    /// Moves a server to the top of the list. `origin` and `server_version`
    /// come from a `Server` that passed `Server::check`, which accepts only
    /// the contracts recorded here.
    pub fn remember_server(
        &self,
        origin: &Url,
        server_version: &str,
    ) -> Result<Vec<DesktopSavedServer>, String> {
        let server_url = origin.origin().ascii_serialization();
        self.update_servers(|servers| {
            servers.retain(|server| server.server_url != server_url);
            servers.insert(
                0,
                DesktopSavedServer {
                    server_url,
                    last_connected_at: now_rfc3339(),
                    server_version: Some(server_version.to_owned()),
                    http_contract: HTTP_CONTRACT_1,
                    bridge_contract: TAURI_BRIDGE_CONTRACT_1,
                },
            );
            servers.truncate(MAX_SAVED_SERVERS);
        })
    }

    pub fn forget_server(&self, origin: &Url) -> Result<Vec<DesktopSavedServer>, String> {
        let server_url = origin.origin().ascii_serialization();
        self.update_servers(|servers| servers.retain(|server| server.server_url != server_url))
    }

    pub fn get_window_state(&self) -> Option<DesktopWindowState> {
        normalize_window_state(self.read_document().get(WINDOW_STATE_KEY))
    }

    pub fn remember_window_state(&self, state: DesktopWindowState) -> Result<(), String> {
        let state = serde_json::to_value(state).map_err(|_| "Could not encode the window size.")?;
        self.update("Could not save the window size.", |document| {
            document.insert(WINDOW_STATE_KEY.into(), state);
            Ok(())
        })
    }

    fn update_servers(
        &self,
        change: impl FnOnce(&mut Vec<DesktopSavedServer>),
    ) -> Result<Vec<DesktopSavedServer>, String> {
        self.update("Could not save server settings.", |document| {
            let mut servers = normalize_servers(document.get("servers"));
            change(&mut servers);
            document.insert(
                "servers".into(),
                serde_json::to_value(&servers)
                    .map_err(|_| "Could not encode saved server settings.")?,
            );
            Ok(servers)
        })
    }

    /// The document for reading. An unreadable or corrupt file reads as
    /// empty; only `update` decides what happens to it.
    fn read_document(&self) -> Map<String, Value> {
        match self.read_stored() {
            Ok(StoredDocument::Valid(document)) => document,
            Ok(StoredDocument::Corrupt) => {
                log::warn!("{} is not a valid preferences file.", self.path.display());
                Map::new()
            }
            Err(error) => {
                log::warn!("Could not read {}: {error}", self.path.display());
                Map::new()
            }
        }
    }

    fn read_stored(&self) -> io::Result<StoredDocument> {
        let raw = match fs::read(&self.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(StoredDocument::Valid(Map::new()));
            }
            Err(error) => return Err(error),
        };
        Ok(match serde_json::from_slice::<Value>(&raw) {
            Ok(Value::Object(document)) => StoredDocument::Valid(document),
            _ => StoredDocument::Corrupt,
        })
    }

    /// Applies `change` to the stored document and writes it back, one caller
    /// at a time. A file that cannot be read is left alone and the change
    /// fails with `failure`: writing over it would drop every other setting.
    /// A corrupt file is moved to `preferences.json.bak` first, so the saved
    /// servers in it can still be recovered by hand.
    fn update<T>(
        &self,
        failure: &str,
        change: impl FnOnce(&mut Map<String, Value>) -> Result<T, String>,
    ) -> Result<T, String> {
        let _writes = self.writes.lock().unwrap_or_else(PoisonError::into_inner);
        let mut document = match self.read_stored() {
            Ok(StoredDocument::Valid(document)) => document,
            Ok(StoredDocument::Corrupt) => {
                let backup = self.path.with_extension("json.bak");
                if let Err(error) = fs::rename(&self.path, &backup) {
                    log::warn!(
                        "Could not move the corrupt {} aside: {error}",
                        self.path.display()
                    );
                    return Err(failure.into());
                }
                log::warn!(
                    "{} was not a valid preferences file. Moved it to {} and started a new one.",
                    self.path.display(),
                    backup.display()
                );
                Map::new()
            }
            Err(error) => {
                log::warn!("Could not read {}: {error}", self.path.display());
                return Err(failure.into());
            }
        };
        let result = change(&mut document)?;
        let data =
            serde_json::to_vec_pretty(&Value::Object(document)).map_err(|_| failure.to_string())?;
        atomic_write(&self.path, &data).map_err(|error| {
            log::warn!("Could not write {}: {error}", self.path.display());
            failure.to_string()
        })?;
        Ok(result)
    }
}

fn normalize_window_state(value: Option<&Value>) -> Option<DesktopWindowState> {
    let object = value?.as_object()?;
    let width = object.get("width")?.as_u64()?;
    let height = object.get("height")?.as_u64()?;
    if !(u64::from(MIN_WINDOW_WIDTH)..=u64::from(MAX_WINDOW_DIMENSION)).contains(&width)
        || !(u64::from(MIN_WINDOW_HEIGHT)..=u64::from(MAX_WINDOW_DIMENSION)).contains(&height)
    {
        return None;
    }
    Some(DesktopWindowState {
        width: width as u32,
        height: height as u32,
        maximized: object
            .get("maximized")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn normalize_servers(value: Option<&Value>) -> Vec<DesktopSavedServer> {
    let Some(Value::Array(values)) = value else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    values
        .iter()
        .filter_map(normalize_server)
        .filter(|server| seen.insert(server.server_url.clone()))
        .take(MAX_SAVED_SERVERS)
        .collect()
}

fn normalize_server(value: &Value) -> Option<DesktopSavedServer> {
    let object = value.as_object()?;
    let server_url = canonical_server_url(object.get("serverUrl")?.as_str()?).ok()?;
    let http_contract = safe_integer(object.get("httpContract")?)?;
    let bridge_contract = safe_integer(object.get("bridgeContract")?)?;
    if http_contract == 0 || bridge_contract == 0 {
        return None;
    }
    let last_connected_at = object
        .get("lastConnectedAt")
        .and_then(Value::as_str)
        .and_then(parse_rfc3339)
        .map(|value| {
            value
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| epoch_rfc3339().to_string())
        })
        .unwrap_or_else(|| epoch_rfc3339().to_string());
    let server_version = object
        .get("serverVersion")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    Some(DesktopSavedServer {
        server_url,
        last_connected_at,
        server_version,
        http_contract,
        bridge_contract,
    })
}

fn safe_integer(value: &Value) -> Option<u64> {
    let number = value.as_u64()?;
    (number > 0 && number <= MAX_SAFE_INTEGER).then_some(number)
}

fn canonical_server_url(value: &str) -> Result<String, String> {
    let origin = server_origin(value)?;
    Ok(origin.origin().ascii_serialization())
}

fn parse_rfc3339(value: &str) -> Option<time::OffsetDateTime> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| epoch_rfc3339().to_string())
}

fn epoch_rfc3339() -> &'static str {
    "1970-01-01T00:00:00Z"
}

fn atomic_write(path: &Path, data: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("state"),
        std::process::id(),
        counter
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopUpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Downloaded,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateState {
    pub status: DesktopUpdateStatus,
    pub current_version: Option<String>,
    pub version: Option<String>,
    pub supported: bool,
    /// RFC 3339 time of the last completed update check, background or manual.
    pub last_checked_at: Option<String>,
}

struct UpdateRuntime {
    state: DesktopUpdateState,
    pending: Option<tauri_plugin_updater::Update>,
    downloaded: Option<Arc<[u8]>>,
    check_in_flight: bool,
    download_in_flight: bool,
    install_in_flight: bool,
}

/// Why `restart_to_install` returned instead of restarting.
pub enum RestartError {
    /// Nothing was stopped, so Alloy keeps running as before.
    BeforeShutdown(String),
    /// The shutdown step ran, so the recorder and library must be resumed.
    AfterShutdown(String),
}

/// Native services used by the Tauri command handlers.
pub struct DesktopServices {
    app: AppHandle,
    pub preferences: PreferencesStore,
    updates: Mutex<UpdateRuntime>,
    update_events: broadcast::Sender<DesktopUpdateState>,
}

impl DesktopServices {
    pub fn new(app: AppHandle, state_dir: impl Into<PathBuf>) -> Self {
        let supported = updater_supported(&app);
        let current_version = Some(app.package_info().version.to_string());
        let (update_events, _) = broadcast::channel(16);
        Self {
            app,
            preferences: PreferencesStore::new(state_dir),
            updates: Mutex::new(UpdateRuntime {
                state: DesktopUpdateState {
                    status: DesktopUpdateStatus::Idle,
                    current_version,
                    version: None,
                    supported,
                    last_checked_at: None,
                },
                pending: None,
                downloaded: None,
                check_in_flight: false,
                download_in_flight: false,
                install_in_flight: false,
            }),
            update_events,
        }
    }

    pub fn get_update_state(&self) -> DesktopUpdateState {
        self.updates
            .lock()
            .map(|updates| updates.state.clone())
            .unwrap_or_else(|_| {
                unsupported_update_state(self.app.package_info().version.to_string())
            })
    }

    pub fn subscribe_update_state(&self) -> broadcast::Receiver<DesktopUpdateState> {
        self.update_events.subscribe()
    }

    /// Whether this build can check for updates at all. Background checks
    /// skip themselves entirely when this is false.
    pub fn updates_supported(&self) -> bool {
        updater_supported(&self.app)
    }

    /// Checks the release feed. A check runs from `Idle` or `Available`, so a
    /// later release replaces a pending update the user has not downloaded
    /// yet. While `Available`, the status stays put during the check so the
    /// "update available" UI does not flicker on every background poll.
    pub async fn check_for_updates(&self) -> Result<DesktopUpdateState, String> {
        self.require_updater()?;
        {
            let mut updates = self.lock_updates()?;
            if updates.check_in_flight
                || !matches!(
                    updates.state.status,
                    DesktopUpdateStatus::Idle | DesktopUpdateStatus::Available
                )
            {
                return Ok(updates.state.clone());
            }
            updates.check_in_flight = true;
            if matches!(updates.state.status, DesktopUpdateStatus::Idle) {
                updates.state.status = DesktopUpdateStatus::Checking;
                self.publish_locked(&updates);
            }
        }

        let updater = match self.updater() {
            Ok(updater) => updater,
            Err(error) => {
                let mut updates = self.lock_updates()?;
                updates.check_in_flight = false;
                self.finish_check_locked(&mut updates);
                return Err(error);
            }
        };
        let result = updater.check().await;
        let mut updates = self.lock_updates()?;
        updates.check_in_flight = false;
        // A download that started while the check was in flight owns the
        // pending update, so record only that the check happened and leave
        // the pending update, its bytes, and the status alone.
        if updates.download_in_flight
            || matches!(
                updates.state.status,
                DesktopUpdateStatus::Downloading | DesktopUpdateStatus::Downloaded
            )
        {
            if let Err(error) = result {
                return Err(logged(CHECK_FAILED)(error));
            }
            updates.state.last_checked_at = Some(now_rfc3339());
            self.publish_locked(&updates);
            return Ok(updates.state.clone());
        }
        match result {
            Ok(Some(update)) => {
                let version = update.version.clone();
                if updates.state.version.as_deref() != Some(version.as_str()) {
                    updates.pending = Some(update);
                    updates.downloaded = None;
                }
                updates.state.status = DesktopUpdateStatus::Available;
                updates.state.version = Some(version);
                updates.state.last_checked_at = Some(now_rfc3339());
                self.publish_locked(&updates);
                Ok(updates.state.clone())
            }
            Ok(None) => {
                updates.pending = None;
                updates.downloaded = None;
                updates.state.status = DesktopUpdateStatus::Idle;
                updates.state.version = None;
                updates.state.last_checked_at = Some(now_rfc3339());
                self.publish_locked(&updates);
                Ok(updates.state.clone())
            }
            Err(error) => {
                self.finish_check_locked(&mut updates);
                Err(logged(CHECK_FAILED)(error))
            }
        }
    }

    /// Leaves a failed check where it started: `Checking` returns to `Idle`,
    /// and a still-pending update stays `Available`.
    fn finish_check_locked(&self, updates: &mut UpdateRuntime) {
        if matches!(updates.state.status, DesktopUpdateStatus::Checking) {
            updates.state.status = DesktopUpdateStatus::Idle;
            updates.state.version = None;
            self.publish_locked(updates);
        }
    }

    pub async fn download_update(&self) -> Result<DesktopUpdateState, String> {
        self.require_updater()?;
        let update = {
            let mut updates = self.lock_updates()?;
            if updates.download_in_flight
                || matches!(updates.state.status, DesktopUpdateStatus::Downloaded)
            {
                return Ok(updates.state.clone());
            }
            let Some(update) = updates.pending.clone() else {
                return Ok(updates.state.clone());
            };
            updates.download_in_flight = true;
            updates.state.status = DesktopUpdateStatus::Downloading;
            self.publish_locked(&updates);
            update
        };

        let result = update.download(|_, _| {}, || {}).await;
        let mut updates = self.lock_updates()?;
        updates.download_in_flight = false;
        match result {
            Ok(bytes) => {
                updates.downloaded = Some(Arc::<[u8]>::from(bytes));
                updates.state.status = DesktopUpdateStatus::Downloaded;
                self.publish_locked(&updates);
                Ok(updates.state.clone())
            }
            Err(error) => {
                updates.state.status = DesktopUpdateStatus::Available;
                self.publish_locked(&updates);
                Err(logged("Couldn't download the update.")(error))
            }
        }
    }

    /// Runs `shutdown`, installs the downloaded update, and restarts. Any
    /// error after `shutdown` has started is `RestartError::AfterShutdown`.
    pub async fn restart_to_install<F, Fut>(&self, shutdown: F) -> Result<(), RestartError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<(), String>>,
    {
        self.require_updater()
            .map_err(RestartError::BeforeShutdown)?;
        let (update, bytes) = {
            let mut updates = self.lock_updates().map_err(RestartError::BeforeShutdown)?;
            if updates.install_in_flight {
                return Ok(());
            }
            let (Some(update), Some(bytes)) = (updates.pending.clone(), updates.downloaded.clone())
            else {
                return Ok(());
            };
            updates.install_in_flight = true;
            (update, bytes)
        };

        if let Err(error) = shutdown().await {
            let mut updates = self.lock_updates().map_err(RestartError::AfterShutdown)?;
            updates.install_in_flight = false;
            return Err(RestartError::AfterShutdown(error));
        }
        if let Err(error) = update.install(bytes.as_ref()) {
            let mut updates = self.lock_updates().map_err(RestartError::AfterShutdown)?;
            updates.install_in_flight = false;
            updates.state.status = DesktopUpdateStatus::Downloaded;
            self.publish_locked(&updates);
            return Err(RestartError::AfterShutdown(logged(
                "Couldn't restart to update.",
            )(error)));
        }
        {
            let mut updates = self.lock_updates().map_err(RestartError::AfterShutdown)?;
            updates.install_in_flight = false;
            updates.pending = None;
            updates.downloaded = None;
            updates.state.status = DesktopUpdateStatus::Idle;
            updates.state.version = None;
            self.publish_locked(&updates);
        }
        self.app.restart()
    }

    pub fn get_autostart_state(&self) -> DesktopAutostartState {
        if !autostart_supported() {
            return DesktopAutostartState {
                supported: false,
                enabled: false,
            };
        }
        let Some(manager) = self
            .app
            .try_state::<tauri_plugin_autostart::AutoLaunchManager>()
        else {
            return DesktopAutostartState {
                supported: false,
                enabled: false,
            };
        };
        DesktopAutostartState {
            supported: true,
            enabled: manager.is_enabled().unwrap_or(false),
        }
    }

    pub fn set_autostart_enabled(&self, enabled: bool) -> Result<DesktopAutostartState, String> {
        if !autostart_supported() {
            return Ok(DesktopAutostartState {
                supported: false,
                enabled: false,
            });
        }
        let manager = self
            .app
            .try_state::<tauri_plugin_autostart::AutoLaunchManager>()
            .ok_or_else(|| "Autostart is unavailable in this build.".to_string())?;
        let changed = if enabled {
            manager.enable()
        } else {
            manager.disable()
        };
        changed.map_err(logged("Couldn't update the startup setting."))?;
        Ok(self.get_autostart_state())
    }

    /// The public key and endpoints come from `plugins.updater` in the Tauri
    /// config, which the release build fills in at bundle time.
    fn updater(&self) -> Result<tauri_plugin_updater::Updater, String> {
        if !has_update_public_key(&self.app) {
            return Err(UPDATE_UNSUPPORTED_ERROR.into());
        }
        self.app.updater().map_err(logged(CHECK_FAILED))
    }

    fn require_updater(&self) -> Result<(), String> {
        if updater_supported(&self.app) {
            Ok(())
        } else {
            Err(UPDATE_UNSUPPORTED_ERROR.into())
        }
    }

    fn lock_updates(&self) -> Result<std::sync::MutexGuard<'_, UpdateRuntime>, String> {
        self.updates
            .lock()
            .map_err(|_| "Updater state is unavailable.".to_string())
    }

    fn publish_locked(&self, updates: &UpdateRuntime) {
        let _ = self.update_events.send(updates.state.clone());
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAutostartState {
    pub supported: bool,
    pub enabled: bool,
}

/// The `plugins.updater` section of the Tauri config. Development builds ship
/// an empty public key, so automatic updates stay off until a release build
/// merges the real key in.
#[derive(Debug, Default, Deserialize)]
struct UpdaterConfig {
    #[serde(default)]
    pubkey: String,
    #[serde(default)]
    endpoints: Vec<String>,
}

fn updater_config(app: &AppHandle) -> UpdaterConfig {
    app.config()
        .plugins
        .0
        .get("updater")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

fn updater_supported(app: &AppHandle) -> bool {
    let config = updater_config(app);
    !tauri::is_dev()
        && !config.pubkey.trim().is_empty()
        && !config.endpoints.is_empty()
        && tauri::utils::platform::bundle_type().is_some()
        && tauri_plugin_updater::target().is_some()
}

fn has_update_public_key(app: &AppHandle) -> bool {
    !updater_config(app).pubkey.trim().is_empty()
}

fn unsupported_update_state(current_version: String) -> DesktopUpdateState {
    DesktopUpdateState {
        status: DesktopUpdateStatus::Idle,
        current_version: Some(current_version),
        version: None,
        supported: false,
        last_checked_at: None,
    }
}

/// Dev builds would register the bare debug binary as a login item.
fn autostart_supported() -> bool {
    !tauri::is_dev() && tauri::utils::platform::bundle_type().is_some()
}
