//! The host's shared state, and the checks every native command makes
//! against it before acting for a window.

use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock, RwLock,
        atomic::{AtomicBool, AtomicU64},
    },
};

use alloy_desktop::{
    logging::logged,
    policy::{CONNECT_WINDOW_LABEL, SERVER_WINDOW_PREFIX, is_local_app_url, is_same_origin},
};
use tauri::WebviewWindow;
use tokio::sync::watch;
use url::Url;

use crate::{runtime::DesktopRuntime, services::DesktopServices};

pub struct Host {
    pub connecting: tokio::sync::Mutex<()>,
    pub cancel: Mutex<Option<watch::Sender<bool>>>,
    pub remote: RwLock<Option<RemoteSession>>,
    pub next_generation: AtomicU64,
    pub services: OnceLock<Arc<DesktopServices>>,
    pub runtime: OnceLock<Arc<DesktopRuntime>>,
    /// The log folder, or `None` when file logging could not start.
    pub logs: OnceLock<Option<PathBuf>>,
    pub quitting: AtomicBool,
    /// Set while a freshly created connect screen waits to be shown. It stays
    /// hidden until its page has rendered to avoid a blank window.
    pub connect_pending: AtomicBool,
    /// Set while the connect window is being created, so concurrent requests
    /// to show it do not race to build a second one.
    pub connect_creating: AtomicBool,
}

pub struct RemoteSession {
    pub generation: u64,
    pub origin: Url,
    pub window: WebviewWindow,
}

impl Default for Host {
    fn default() -> Self {
        Self {
            connecting: tokio::sync::Mutex::new(()),
            cancel: Mutex::new(None),
            remote: RwLock::new(None),
            next_generation: AtomicU64::new(0),
            services: OnceLock::new(),
            runtime: OnceLock::new(),
            logs: OnceLock::new(),
            quitting: AtomicBool::new(false),
            connect_pending: AtomicBool::new(false),
            connect_creating: AtomicBool::new(false),
        }
    }
}

impl Host {
    pub fn services(&self) -> Result<&Arc<DesktopServices>, String> {
        self.services
            .get()
            .ok_or_else(|| "Desktop services are not ready.".to_string())
    }

    pub fn runtime(&self) -> Result<&Arc<DesktopRuntime>, String> {
        self.runtime
            .get()
            .ok_or_else(|| "Desktop runtime is not ready.".to_string())
    }
}

/// Publishes a connection attempt's cancel sender for `cancel_connect` and
/// withdraws it when the attempt ends, on every return path.
pub struct CancelRegistration<'a> {
    host: &'a Host,
}

impl<'a> CancelRegistration<'a> {
    pub fn new(host: &'a Host, cancel: watch::Sender<bool>) -> Result<Self, String> {
        *host
            .cancel
            .lock()
            .map_err(logged("Login state is unavailable."))? = Some(cancel);
        Ok(Self { host })
    }
}

impl Drop for CancelRegistration<'_> {
    fn drop(&mut self) {
        if let Ok(mut cancel) = self.host.cancel.lock() {
            *cancel = None;
        }
    }
}

pub fn require_connect_window(window: &WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(logged("Could not check the connect window."))?;
    if window.label() == CONNECT_WINDOW_LABEL && is_local_app_url(&url) {
        Ok(())
    } else {
        Err("Only the bundled connect window can call this operation.".into())
    }
}

pub fn require_remote_window(window: &WebviewWindow, host: &Host) -> Result<(u64, Url), String> {
    if !window.label().starts_with(SERVER_WINDOW_PREFIX) {
        return Err("Only the selected server window can call this operation.".into());
    }
    let current_url = window
        .url()
        .map_err(logged("Could not check the server window."))?;
    let remote = host
        .remote
        .read()
        .map_err(logged("Server window state is unavailable."))?;
    let Some(remote) = remote.as_ref() else {
        return Err("The server window is no longer active.".into());
    };
    if remote.window != *window || !is_same_origin(&current_url, &remote.origin) {
        return Err("The server window is not authorized for this server.".into());
    }
    Ok((remote.generation, remote.origin.clone()))
}

pub fn clear_remote(host: &Host, generation: u64) -> bool {
    if let Ok(mut remote) = host.remote.write()
        && remote
            .as_ref()
            .is_some_and(|session| session.generation == generation)
    {
        *remote = None;
        true
    } else {
        false
    }
}

pub fn send_cancel(host: &Host) -> Result<(), String> {
    let cancel = host
        .cancel
        .lock()
        .map_err(logged("Login state is unavailable."))?;
    if let Some(cancel) = cancel.as_ref() {
        let _ = cancel.send(true);
    }
    Ok(())
}

pub fn restore_remote(host: &Host, generation: u64, previous: Option<RemoteSession>) {
    if let Ok(mut remote) = host.remote.write()
        && remote
            .as_ref()
            .is_some_and(|session| session.generation == generation)
    {
        *remote = previous;
    }
}
