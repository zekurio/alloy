use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::broadcast;

use alloy_desktop::logging::logged;

use tauri_plugin_updater::UpdaterExt;

use crate::preferences::{PreferencesStore, now_rfc3339};

const UPDATE_UNSUPPORTED_ERROR: &str = "Automatic updates are unavailable in this build.";
const CHECK_FAILED: &str = "Couldn't check for updates.";

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
