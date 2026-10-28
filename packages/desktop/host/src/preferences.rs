//! Saved servers and window geometry, kept in `preferences.json`.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
};

use crate::server::{BRIDGE_CONTRACT_1, HTTP_CONTRACT_1, MAX_SAFE_INTEGER, server_origin};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use url::Url;

const PREFERENCES_FILE: &str = "preferences.json";
const WINDOW_STATE_KEY: &str = "window";
const MAX_SAVED_SERVERS: usize = 8;
/// The smallest window the web app can lay out in. The shell's windows use
/// the same minimum.
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
    pub server_version: String,
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
                    server_version: server_version.to_owned(),
                    http_contract: HTTP_CONTRACT_1,
                    bridge_contract: BRIDGE_CONTRACT_1,
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
    let last_connected_at = parse_rfc3339(object.get("lastConnectedAt")?.as_str()?)?
        .format(&time::format_description::well_known::Rfc3339)
        .ok()?;
    let server_version = object.get("serverVersion")?.as_str()?.trim();
    if server_version.is_empty() {
        return None;
    }
    let server_version = server_version.to_owned();
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

pub fn now_rfc3339() -> String {
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
