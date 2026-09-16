use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::broadcast;

use alloy_desktop::server::server_origin;

use tauri_plugin_updater::UpdaterExt;

const PREFERENCES_FILE: &str = "preferences.json";
const WINDOW_STATE_KEY: &str = "window";
const MAX_SAVED_SERVERS: usize = 8;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const UPDATE_UNSUPPORTED_ERROR: &str = "Automatic updates are unavailable in this build.";
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
#[derive(Clone, Debug)]
pub struct PreferencesStore {
    path: PathBuf,
}

impl PreferencesStore {
    pub fn new(state_dir: impl Into<PathBuf>) -> Self {
        Self {
            path: state_dir.into().join(PREFERENCES_FILE),
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

    pub fn remember_server(
        &self,
        server_url: &str,
        http_contract: u64,
        bridge_contract: u64,
    ) -> Result<Vec<DesktopSavedServer>, String> {
        validate_contract_id(http_contract)?;
        validate_contract_id(bridge_contract)?;
        let server_url = canonical_server_url(server_url)?;
        let mut servers = self.get_servers();
        servers.retain(|server| server.server_url != server_url);
        servers.insert(
            0,
            DesktopSavedServer {
                server_url,
                last_connected_at: now_rfc3339(),
                http_contract,
                bridge_contract,
            },
        );
        servers.truncate(MAX_SAVED_SERVERS);
        self.write_servers(&servers)?;
        Ok(servers)
    }

    pub fn forget_server(&self, server_url: &str) -> Result<Vec<DesktopSavedServer>, String> {
        let server_url = canonical_server_url(server_url)?;
        let mut servers = self.get_servers();
        servers.retain(|server| server.server_url != server_url);
        self.write_servers(&servers)?;
        Ok(servers)
    }

    pub fn get_window_state(&self) -> Option<DesktopWindowState> {
        normalize_window_state(self.read_document().get(WINDOW_STATE_KEY))
    }

    pub fn remember_window_state(&self, state: DesktopWindowState) -> Result<(), String> {
        let mut document = self.read_document();
        document.insert(
            WINDOW_STATE_KEY.into(),
            serde_json::to_value(state).map_err(|_| "Could not encode the window size.")?,
        );
        self.write_document(document)
            .map_err(|_| "Could not save the window size.".into())
    }

    fn read_document(&self) -> Map<String, Value> {
        let Ok(raw) = fs::read_to_string(&self.path) else {
            return Map::new();
        };
        match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(document)) => document,
            _ => Map::new(),
        }
    }

    fn write_servers(&self, servers: &[DesktopSavedServer]) -> Result<(), String> {
        let mut document = self.read_document();
        document.insert(
            "servers".into(),
            serde_json::to_value(servers).map_err(|_| "Could not encode saved server settings.")?,
        );
        self.write_document(document)
            .map_err(|_| "Could not save server settings.".into())
    }

    fn write_document(&self, document: Map<String, Value>) -> io::Result<()> {
        let data = serde_json::to_vec_pretty(&Value::Object(document)).map_err(io::Error::other)?;
        atomic_write(&self.path, &data)
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
    Some(DesktopSavedServer {
        server_url,
        last_connected_at,
        http_contract,
        bridge_contract,
    })
}

fn safe_integer(value: &Value) -> Option<u64> {
    let number = value.as_u64()?;
    (number > 0 && number <= MAX_SAFE_INTEGER).then_some(number)
}

fn validate_contract_id(value: u64) -> Result<(), String> {
    if value == 0 || value > MAX_SAFE_INTEGER {
        Err("The desktop contract ID is invalid.".into())
    } else {
        Ok(())
    }
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

/// Native services used by the Tauri command handlers.
pub struct DesktopServices {
    app: AppHandle,
    preferences: PreferencesStore,
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

    pub fn get_servers(&self) -> Vec<DesktopSavedServer> {
        self.preferences.get_servers()
    }

    pub fn get_current_server(&self) -> Option<String> {
        self.preferences.get_current_server()
    }

    pub fn remember_server(
        &self,
        server_url: &str,
        http_contract: u64,
        bridge_contract: u64,
    ) -> Result<Vec<DesktopSavedServer>, String> {
        self.preferences
            .remember_server(server_url, http_contract, bridge_contract)
    }

    pub fn forget_server(&self, server_url: &str) -> Result<Vec<DesktopSavedServer>, String> {
        self.preferences.forget_server(server_url)
    }

    pub fn get_window_state(&self) -> Option<DesktopWindowState> {
        self.preferences.get_window_state()
    }

    pub fn remember_window_state(&self, state: DesktopWindowState) -> Result<(), String> {
        self.preferences.remember_window_state(state)
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
                return Err(error.to_string());
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
                Err(error.to_string())
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
                Err(error.to_string())
            }
        }
    }

    pub async fn restart_to_install<F, Fut>(&self, shutdown: F) -> Result<(), String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<(), String>>,
    {
        self.require_updater()?;
        let (update, bytes) = {
            let mut updates = self.lock_updates()?;
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
            let mut updates = self.lock_updates()?;
            updates.install_in_flight = false;
            return Err(error);
        }
        if let Err(error) = update.install(bytes.as_ref()) {
            let mut updates = self.lock_updates()?;
            updates.install_in_flight = false;
            updates.state.status = DesktopUpdateStatus::Downloaded;
            self.publish_locked(&updates);
            return Err(error.to_string());
        }
        {
            let mut updates = self.lock_updates()?;
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
        if enabled {
            manager.enable().map_err(|error| error.to_string())?;
        } else {
            manager.disable().map_err(|error| error.to_string())?;
        }
        Ok(self.get_autostart_state())
    }

    /// The public key and endpoints come from `plugins.updater` in the Tauri
    /// config, which the release build fills in at bundle time.
    fn updater(&self) -> Result<tauri_plugin_updater::Updater, String> {
        if !has_update_public_key(&self.app) {
            return Err(UPDATE_UNSUPPORTED_ERROR.into());
        }
        self.app.updater().map_err(|error| error.to_string())
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

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::{DesktopSavedServer, DesktopWindowState, PreferencesStore};

    fn temp_store() -> (PreferencesStore, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "alloy-services-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        (PreferencesStore::new(&path), path)
    }

    #[test]
    fn remembers_normalized_servers_and_moves_latest_to_front() {
        let (store, path) = temp_store();
        let first = store
            .remember_server("https://alloy.example/api/", 1, 1)
            .unwrap();
        assert_eq!(first[0].server_url, "https://alloy.example");
        let second = store
            .remember_server("http://localhost:2552/", 1, 1)
            .unwrap();
        assert_eq!(second[0].server_url, "http://localhost:2552");
        assert_eq!(second.len(), 2);
        let again = store
            .remember_server("https://alloy.example", 1, 1)
            .unwrap();
        assert_eq!(again[0].server_url, "https://alloy.example");
        assert_eq!(again.len(), 2);
        assert_eq!(
            store.get_current_server().as_deref(),
            Some("https://alloy.example")
        );
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn rejects_unsafe_server_urls_and_contract_ids() {
        let (store, path) = temp_store();
        assert!(store.remember_server("http://alloy.example", 1, 1).is_err());
        assert!(
            store
                .remember_server("https://alloy.example", 0, 1)
                .is_err()
        );
        assert!(
            store
                .remember_server("https://alloy.example", 1, 9_007_199_254_740_992)
                .is_err()
        );
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn ignores_invalid_persisted_entries() {
        let (store, path) = temp_store();
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("preferences.json"),
            r#"{"version":2,"servers":[{"serverUrl":"https://alloy.example/path","httpContract":1,"bridgeContract":1},{"serverUrl":"http://evil.example/","httpContract":1,"bridgeContract":1},{"serverUrl":"https://alloy.example","httpContract":1,"bridgeContract":1}]}"#,
        )
        .unwrap();
        let servers: Vec<DesktopSavedServer> = store.get_servers();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].server_url, "https://alloy.example");
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn window_state_survives_server_list_writes() {
        let (store, path) = temp_store();
        assert_eq!(store.get_window_state(), None);
        let state = DesktopWindowState::clamped(1440, 900, true);
        store.remember_window_state(state).unwrap();
        store
            .remember_server("https://alloy.example", 1, 1)
            .unwrap();
        assert_eq!(store.get_window_state(), Some(state));
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn ignores_invalid_persisted_window_states() {
        let (store, path) = temp_store();
        fs::create_dir_all(&path).unwrap();
        for window in [
            r#"{"width":100,"height":600,"maximized":false}"#,
            r#"{"width":1920,"height":100,"maximized":false}"#,
            r#"{"width":1920}"#,
            r#""maximized""#,
        ] {
            fs::write(
                path.join("preferences.json"),
                format!(r#"{{"window":{window}}}"#),
            )
            .unwrap();
            assert_eq!(store.get_window_state(), None, "accepted {window}");
        }
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn clamps_window_state_to_restorable_bounds() {
        assert_eq!(
            DesktopWindowState::clamped(100, 100, false),
            DesktopWindowState {
                width: 800,
                height: 600,
                maximized: false,
            }
        );
    }
}
