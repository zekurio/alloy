#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;
#[path = "services.rs"]
mod services;

use std::sync::{
    Arc, Mutex, OnceLock, RwLock,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

use alloy_desktop_tauri::{
    login::{BrowserLogin, SessionTokens},
    policy::{
        CONNECT_WINDOW_LABEL, SERVER_WINDOW_PREFIX, bridge_initialization_script, is_local_app_url,
        is_same_origin, remote_window_label,
    },
    server::Server,
};
use runtime::DesktopRuntime;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use services::{DesktopSavedServer, DesktopServices};
use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    webview::{Cookie, NewWindowResponse},
};
use tokio::sync::watch;
use url::Url;

const DESKTOP_SHELL_PERMISSION: &str = "allow-desktop-shell";
const DESKTOP_API_PERMISSION: &str = "allow-desktop-api";
const NO_SAVED_SESSION: &str = "No saved Alloy session was found.";

struct Host {
    connecting: tokio::sync::Mutex<()>,
    cancel: Mutex<Option<watch::Sender<bool>>>,
    remote: RwLock<Option<RemoteSession>>,
    next_generation: AtomicU64,
    services: OnceLock<Arc<DesktopServices>>,
    runtime: OnceLock<Arc<DesktopRuntime>>,
    quitting: AtomicBool,
}

struct RemoteSession {
    generation: u64,
    origin: Url,
    window: WebviewWindow,
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
            quitting: AtomicBool::new(false),
        }
    }
}

impl Host {
    fn services(&self) -> Result<&Arc<DesktopServices>, String> {
        self.services
            .get()
            .ok_or_else(|| "Desktop services are not ready.".to_string())
    }

    fn runtime(&self) -> Result<&Arc<DesktopRuntime>, String> {
        self.runtime
            .get()
            .ok_or_else(|| "Desktop runtime is not ready.".to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectedServer {
    server_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum DesktopShellOperation {
    MinimizeWindow,
    ToggleMaximizeWindow,
    CloseWindow,
    OpenConnect,
    OpenSettings,
    ReloadApp,
}

fn require_connect_window(window: &WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "Could not check the connect window.")?;
    if window.label() == CONNECT_WINDOW_LABEL && is_local_app_url(&url) {
        Ok(())
    } else {
        Err("Only the bundled connect window can call this operation.".into())
    }
}

fn require_remote_window(window: &WebviewWindow, host: &Host) -> Result<(u64, Url), String> {
    if !window.label().starts_with(SERVER_WINDOW_PREFIX) {
        return Err("Only the selected server window can call this operation.".into());
    }
    let current_url = window
        .url()
        .map_err(|_| "Could not check the server window.")?;
    let remote = host
        .remote
        .read()
        .map_err(|_| "Server window state is unavailable.")?;
    let Some(remote) = remote.as_ref() else {
        return Err("The server window is no longer active.".into());
    };
    if remote.window != *window || !is_same_origin(&current_url, &remote.origin) {
        return Err("The server window is not authorized for this server.".into());
    }
    Ok((remote.generation, remote.origin.clone()))
}

#[tauri::command]
async fn connect_server(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
    url: String,
) -> Result<ConnectedServer, String> {
    require_connect_window(&window)?;
    let _guard = host
        .connecting
        .try_lock()
        .map_err(|_| "A server connection is already in progress.")?;
    let (cancel, cancelled) = watch::channel(false);
    *host
        .cancel
        .lock()
        .map_err(|_| "Login state is unavailable.")? = Some(cancel);

    let mut prepare_cancelled = cancelled.clone();
    let server = match tokio::select! {
        result = prepare_server(&url) => result,
        _ = prepare_cancelled.changed() => Err("Sign-in was cancelled.".into()),
    } {
        Ok(server) => server,
        Err(error) => {
            clear_cancel(host.inner());
            return Err(error);
        }
    };
    let runtime = match host.inner().runtime() {
        Ok(runtime) => runtime.clone(),
        Err(error) => {
            clear_cancel(host.inner());
            return Err(error);
        }
    };
    let generation = {
        let _selection = runtime.selection_lock.lock().await;
        install_remote(
            &app,
            host.inner(),
            &runtime,
            server.clone(),
            None,
            &cancelled,
        )
        .await
    };
    let generation = match generation {
        Ok(generation) => generation,
        Err(error) => {
            if error != NO_SAVED_SESSION {
                clear_cancel(host.inner());
                return Err(error);
            }

            let mut login_cancelled = cancelled.clone();
            let login = match tokio::select! {
                result = browser_login(&server) => result,
                _ = login_cancelled.changed() => Err("Sign-in was cancelled.".into()),
            } {
                Ok(tokens) => tokens,
                Err(error) => {
                    clear_cancel(host.inner());
                    return Err(error);
                }
            };
            if let Err(error) = ensure_not_cancelled(&cancelled) {
                clear_cancel(host.inner());
                return Err(error);
            }
            let _selection = runtime.selection_lock.lock().await;
            match install_remote(
                &app,
                host.inner(),
                &runtime,
                server.clone(),
                Some(&login),
                &cancelled,
            )
            .await
            {
                Ok(generation) => generation,
                Err(error) => {
                    clear_cancel(host.inner());
                    return Err(error);
                }
            }
        }
    };

    if let Err(error) = ensure_not_cancelled(&cancelled) {
        abandon_remote(&app, host.inner(), &runtime, generation).await;
        clear_cancel(host.inner());
        return Err(error);
    }

    if let Err(error) = host.services()?.remember_server(
        server.origin.origin().ascii_serialization().as_str(),
        alloy_desktop_tauri::server::HTTP_CONTRACT_1,
        alloy_desktop_tauri::server::TAURI_BRIDGE_CONTRACT_1,
    ) {
        clear_cancel(host.inner());
        return Err(error);
    }
    clear_cancel(host.inner());
    window
        .hide()
        .map_err(|_| "Could not hide the connect window.")?;

    Ok(ConnectedServer {
        server_url: server.origin.origin().ascii_serialization(),
    })
}

async fn prepare_server(url: &str) -> Result<Server, String> {
    let server = Server::new(url)?;
    server.check().await?;
    Ok(server)
}

async fn browser_login(server: &Server) -> Result<SessionTokens, String> {
    let login = BrowserLogin::prepare(server).await?;
    open::that(login.authorize_url.as_str())
        .map_err(|_| "Could not open the sign-in page in your browser.")?;
    login.finish(server).await
}

#[tauri::command]
fn cancel_connect(window: WebviewWindow, host: State<'_, Arc<Host>>) -> Result<(), String> {
    require_connect_window(&window)?;
    send_cancel(host.inner())?;
    Ok(())
}

#[tauri::command]
fn saved_servers(
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
) -> Result<Vec<DesktopSavedServer>, String> {
    require_connect_window(&window)?;
    Ok(host.inner().services()?.get_servers())
}

#[tauri::command]
async fn forget_server(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
    url: String,
) -> Result<Vec<DesktopSavedServer>, String> {
    require_connect_window(&window)?;
    let _connecting = host.inner().connecting.lock().await;
    let origin = Server::new(&url)?.origin;
    let runtime = host.inner().runtime()?.clone();
    let active = host
        .inner()
        .remote
        .read()
        .map_err(|_| "Server window state is unavailable.")?
        .as_ref()
        .filter(|session| is_same_origin(&session.origin, &origin))
        .map(|session| (session.generation, session.window.clone()));

    if let Some((generation, remote_window)) = active {
        let _selection = runtime.selection_lock.lock().await;
        clear_session_cookies(&remote_window, &origin)?;
        remote_window
            .clear_all_browsing_data()
            .map_err(|_| "Could not clear the Alloy server profile.")?;
        runtime.select_server(None).await?;
        clear_remote(host.inner(), generation);
        let _ = remote_window.destroy();
    } else {
        clear_inactive_remote_profile(&app, &origin, host.inner())?;
    }
    host.inner()
        .services()?
        .forget_server(origin.origin().ascii_serialization().as_str())
}

#[tauri::command]
async fn desktop_api(
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
    operation: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    require_remote_window(&window, host.inner())?;
    let runtime = host.inner().runtime()?.clone();
    let services = host.inner().services()?.clone();
    let result = match operation.as_str() {
        operation if operation.starts_with("recording.") => {
            runtime.invoke(&window, operation, &args).await
        }
        "updates.getState" => runtime_value(services.get_update_state()),
        "updates.checkForUpdates" => runtime_value(services.check_for_updates().await?),
        "updates.downloadUpdate" => runtime_value(services.download_update().await?),
        "updates.restartToInstall" => {
            let recorder = runtime.clone();
            let shutdown_started = Arc::new(AtomicBool::new(false));
            let shutdown_marker = Arc::clone(&shutdown_started);
            let result = services
                .restart_to_install(|| async move {
                    shutdown_marker.store(true, Ordering::Release);
                    recorder.shutdown().await
                })
                .await;
            match result {
                Ok(()) => Ok(Value::Null),
                Err(error) => {
                    let error = if shutdown_started.load(Ordering::Acquire) {
                        match runtime.resume_after_failed_update().await {
                            Ok(()) => error,
                            Err(resume_error) => format!(
                                "{error} Could not resume Alloy after the failed update: {resume_error}"
                            ),
                        }
                    } else {
                        error
                    };
                    Err(error)
                }
            }
        }
        "autostart.getState" => runtime_value(services.get_autostart_state()),
        "autostart.setEnabled" => {
            let enabled: bool = runtime_arg(&args, 0)?;
            runtime_value(services.set_autostart_enabled(enabled)?)
        }
        _ => Err("Unknown native desktop operation.".into()),
    };
    require_remote_window(&window, host.inner())?;
    result
}

fn runtime_arg<T: DeserializeOwned>(args: &[Value], index: usize) -> Result<T, String> {
    serde_json::from_value(args.get(index).cloned().ok_or("Missing native argument.")?)
        .map_err(|_| "Invalid native argument.".into())
}

fn runtime_value(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|_| "Could not encode the native result.".into())
}

#[tauri::command]
async fn desktop_shell(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
    operation: DesktopShellOperation,
) -> Result<(), String> {
    let (generation, origin) = require_remote_window(&window, host.inner())?;
    match operation {
        DesktopShellOperation::MinimizeWindow => window
            .minimize()
            .map_err(|_| "Could not minimize the server window.".into()),
        DesktopShellOperation::ToggleMaximizeWindow => {
            let maximized = window
                .is_maximized()
                .map_err(|_| "Could not check the server window state.")?;
            if maximized {
                window
                    .unmaximize()
                    .map_err(|_| "Could not restore the server window.".into())
            } else {
                window
                    .maximize()
                    .map_err(|_| "Could not maximize the server window.".into())
            }
        }
        DesktopShellOperation::CloseWindow => {
            let runtime = host.inner().runtime()?.clone();
            let _selection = runtime.selection_lock.lock().await;
            require_remote_window(&window, host.inner())?;
            runtime.select_server(None).await?;
            clear_remote(host.inner(), generation);
            window
                .close()
                .map_err(|_| "Could not close the server window.".to_string())?;
            show_connect(&app)
        }
        DesktopShellOperation::OpenConnect => {
            if window
                .url()
                .map_err(|_| "Could not check the server window.")?
                .path()
                == "/login"
            {
                clear_session_cookies(&window, &origin)?;
            }
            show_connect(&app)
        }
        DesktopShellOperation::OpenSettings => open_settings(&window),
        DesktopShellOperation::ReloadApp => window
            .reload()
            .map_err(|_| "Could not reload the server window.".into()),
    }
}

fn open_settings(window: &WebviewWindow) -> Result<(), String> {
    window
        .eval(
            "(() => { const url = new URL(window.location.href); url.pathname = '/'; url.search = '?settings=desktop'; window.location.assign(url.href); })()",
        )
        .map_err(|_| "Could not open Alloy settings.".to_string())
}

async fn install_remote(
    app: &AppHandle,
    host: &Arc<Host>,
    runtime: &Arc<DesktopRuntime>,
    server: Server,
    tokens: Option<&SessionTokens>,
    cancelled: &watch::Receiver<bool>,
) -> Result<u64, String> {
    ensure_not_cancelled(cancelled)?;
    let generation = host.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let label = remote_window_label(generation);
    add_remote_capability(app, &label, &server.origin)?;

    let origin = server.origin.clone();
    let navigation_origin = origin.clone();
    let event_host = Arc::clone(host);
    let event_app = app.clone();
    let event_runtime = Arc::clone(runtime);
    let blank = Url::parse("about:blank").map_err(|_| "Could not open the Alloy server window.")?;
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank))
        .title("Alloy")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .visible(false)
        .incognito(false)
        .initialization_script(bridge_initialization_script(&origin));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(remote_profile_path(app, &origin)?);
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(remote_profile_identifier(&origin));
    let window = builder
        .on_navigation(move |url| {
            url.as_str() == "about:blank" || is_same_origin(url, &navigation_origin)
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()
        .map_err(|_| "Could not open the Alloy server window.")?;
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            if clear_remote(&event_host, generation) =>
        {
            let app = event_app.clone();
            let runtime = Arc::clone(&event_runtime);
            tauri::async_runtime::spawn(async move {
                let _ = runtime.select_server(None).await;
                let _ = show_connect(&app);
            });
        }
        _ => {}
    });

    if let Err(error) = ensure_not_cancelled(cancelled) {
        let _ = window.destroy();
        return Err(error);
    }
    let cookie_result = (|| {
        if let Some(tokens) = tokens {
            for header in tokens.cookie_headers(&server.origin)? {
                let cookie = Cookie::parse(header)
                    .map_err(|_| "Could not create the Alloy session cookie.")?
                    .into_owned();
                window
                    .set_cookie(cookie)
                    .map_err(|_| "Could not store the Alloy session cookie.")?;
            }
        } else {
            let cookies = window
                .cookies_for_url(server.origin.clone())
                .map_err(|_| "Could not read the saved Alloy session.")?;
            if !has_session_cookie(&cookies) {
                return Err(NO_SAVED_SESSION.into());
            }
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = cookie_result {
        let _ = window.destroy();
        return Err(error);
    }
    if let Err(error) = ensure_not_cancelled(cancelled) {
        let _ = window.destroy();
        return Err(error);
    }
    let previous = {
        let mut remote = host
            .remote
            .write()
            .map_err(|_| "Server window state is unavailable.")?;
        remote.replace(RemoteSession {
            generation,
            origin: origin.clone(),
            window: window.clone(),
        })
    };
    if let Err(error) = ensure_not_cancelled(cancelled) {
        restore_remote(host, generation, previous);
        let _ = window.destroy();
        return Err(error);
    }

    let previous_origin = previous.as_ref().map(|session| session.origin.clone());
    if let Err(error) = runtime.select_server(Some(origin.clone())).await {
        restore_remote(host, generation, previous);
        let _ = runtime.select_server(previous_origin).await;
        let _ = window.destroy();
        return Err(error);
    }

    if let Err(error) = window
        .navigate(origin.clone())
        .map_err(|_| "Could not load the Alloy server window.".to_string())
    {
        restore_remote(host, generation, previous);
        let _ = runtime.select_server(previous_origin).await;
        let _ = window.destroy();
        return Err(error);
    }
    if let Err(error) = ensure_not_cancelled(cancelled) {
        restore_remote(host, generation, previous);
        let _ = runtime.select_server(previous_origin).await;
        let _ = window.destroy();
        return Err(error);
    }
    let shown = window
        .show()
        .map_err(|_| "Could not show the Alloy server window.".to_string())
        .and_then(|()| {
            window
                .set_focus()
                .map_err(|_| "Could not focus the Alloy server window.".to_string())
        });
    if let Err(error) = shown {
        restore_remote(host, generation, previous);
        let _ = runtime.select_server(previous_origin).await;
        let _ = window.destroy();
        return Err(error);
    }
    if let Err(error) = ensure_not_cancelled(cancelled) {
        restore_remote(host, generation, previous);
        let _ = runtime.select_server(previous_origin).await;
        let _ = window.destroy();
        return Err(error);
    }
    if let Some(previous) = previous {
        let _ = previous.window.destroy();
    }
    Ok(generation)
}

async fn abandon_remote(
    app: &AppHandle,
    host: &Host,
    runtime: &Arc<DesktopRuntime>,
    generation: u64,
) {
    let _selection = runtime.selection_lock.lock().await;
    let window = host.remote.read().ok().and_then(|remote| {
        remote
            .as_ref()
            .filter(|session| session.generation == generation)
            .map(|session| session.window.clone())
    });
    if window.is_none() {
        return;
    }
    clear_remote(host, generation);
    let _ = runtime.select_server(None).await;
    if let Some(window) = window {
        let _ = window.destroy();
    }
    let _ = show_connect(app);
}

fn has_session_cookie(cookies: &[Cookie<'static>]) -> bool {
    let now = time::OffsetDateTime::now_utc();
    cookies.iter().any(|cookie| {
        cookie.name() == "alloy_refresh"
            && !cookie.value().is_empty()
            && cookie
                .expires_datetime()
                .is_none_or(|expires| expires > now)
    })
}

fn clear_session_cookies(window: &WebviewWindow, origin: &Url) -> Result<(), String> {
    let cookies = window
        .cookies_for_url(origin.clone())
        .map_err(|_| "Could not read the Alloy session cookies.")?;
    for cookie in cookies
        .into_iter()
        .filter(|cookie| matches!(cookie.name(), "alloy_access" | "alloy_refresh"))
    {
        window
            .delete_cookie(cookie)
            .map_err(|_| "Could not clear the Alloy session cookies.")?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn remote_profile_path(app: &AppHandle, origin: &Url) -> Result<std::path::PathBuf, String> {
    let path = remote_profile_directory(app, origin)?;
    std::fs::create_dir_all(&path)
        .map_err(|_| "Could not create the Alloy server profile folder.")?;
    Ok(path)
}

#[cfg(not(target_os = "macos"))]
fn remote_profile_directory(app: &AppHandle, origin: &Url) -> Result<std::path::PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not determine the Alloy data folder.")?;
    let hash = Sha256::digest(origin.origin().ascii_serialization().as_bytes());
    let name = hash
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(root.join("webviews").join("servers").join(name))
}

fn clear_inactive_remote_profile(app: &AppHandle, origin: &Url, host: &Host) -> Result<(), String> {
    let generation = host.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let label = format!("forget-server-{generation}");
    let blank =
        Url::parse("about:blank").map_err(|_| "Could not clear the Alloy server profile.")?;
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank))
        .visible(false)
        .incognito(false);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(remote_profile_path(app, origin)?);
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(remote_profile_identifier(origin));
    let window = builder
        .build()
        .map_err(|_| "Could not open the Alloy server profile.")?;
    let result = clear_session_cookies(&window, origin).and_then(|()| {
        window
            .clear_all_browsing_data()
            .map_err(|_| "Could not clear the Alloy server profile.".to_string())
            .and_then(|()| {
                window
                    .destroy()
                    .map_err(|_| "Could not close the Alloy server profile.".to_string())
            })
    });
    if result.is_err() {
        let _ = window.destroy();
    }
    result
}

#[cfg(target_os = "macos")]
fn remote_profile_identifier(origin: &Url) -> [u8; 16] {
    let hash = Sha256::digest(origin.origin().ascii_serialization().as_bytes());
    let mut identifier = [0_u8; 16];
    identifier.copy_from_slice(&hash[..16]);
    identifier
}

fn add_remote_capability(app: &AppHandle, label: &str, origin: &Url) -> Result<(), String> {
    let capability = tauri::ipc::CapabilityBuilder::new(format!("{label}-shell"))
        .window(label.to_string())
        .remote(format!("{}/*", origin.origin().ascii_serialization()))
        .local(false)
        .permission(DESKTOP_SHELL_PERMISSION)
        .permission(DESKTOP_API_PERMISSION)
        .permission("core:event:allow-listen")
        .permission("core:event:allow-unlisten");
    app.add_capability(capability)
        .map_err(|_| "Could not authorize the Alloy server window.".to_string())
}

fn clear_remote(host: &Host, generation: u64) -> bool {
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

fn clear_cancel(host: &Host) {
    if let Ok(mut cancel) = host.cancel.lock() {
        *cancel = None;
    }
}

fn send_cancel(host: &Host) -> Result<(), String> {
    let cancel = host
        .cancel
        .lock()
        .map_err(|_| "Login state is unavailable.")?;
    if let Some(cancel) = cancel.as_ref() {
        let _ = cancel.send(true);
    }
    Ok(())
}

fn restore_remote(host: &Host, generation: u64, previous: Option<RemoteSession>) {
    if let Ok(mut remote) = host.remote.write()
        && remote
            .as_ref()
            .is_some_and(|session| session.generation == generation)
    {
        *remote = previous;
    }
}

fn ensure_not_cancelled(cancelled: &watch::Receiver<bool>) -> Result<(), String> {
    if *cancelled.borrow() {
        Err("Sign-in was cancelled.".into())
    } else {
        Ok(())
    }
}

fn show_connect(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(CONNECT_WINDOW_LABEL)
        .ok_or_else(|| "The connect window is unavailable.".to_string())?;
    window
        .show()
        .map_err(|_| "Could not show the connect window.")?;
    window
        .set_focus()
        .map_err(|_| "Could not focus the connect window.".to_string())
}

fn show_active(app: &AppHandle, host: &Host) -> Result<(), String> {
    let remote = host
        .remote
        .read()
        .map_err(|_| "Server window state is unavailable.")?
        .as_ref()
        .map(|session| session.window.clone());
    if let Some(window) = remote {
        window
            .show()
            .map_err(|_| "Could not show the Alloy server window.")?;
        Ok(window
            .set_focus()
            .map_err(|_| "Could not focus the Alloy server window.")?)
    } else {
        show_connect(app)
    }
}

fn show_settings(app: &AppHandle, host: &Host) -> Result<(), String> {
    let remote = host
        .remote
        .read()
        .map_err(|_| "Server window state is unavailable.")?
        .as_ref()
        .map(|session| session.window.clone());
    let Some(window) = remote else {
        return show_connect(app);
    };
    window
        .show()
        .map_err(|_| "Could not show the Alloy server window.")?;
    window
        .set_focus()
        .map_err(|_| "Could not focus the Alloy server window.")?;
    open_settings(&window)
}

fn request_quit(app: &AppHandle, host: &Arc<Host>) {
    if host.quitting.swap(true, Ordering::AcqRel) {
        return;
    }
    let _ = send_cancel(host);
    let app = app.clone();
    let host = Arc::clone(host);
    tauri::async_runtime::spawn(async move {
        let result = match host.runtime() {
            Ok(runtime) => runtime.shutdown().await,
            Err(_) => Ok(()),
        };
        if let Err(error) = result {
            eprintln!("Could not stop Alloy before exit: {error}");
        }
        app.exit(0);
    });
}

fn setup_tray(app: &AppHandle, host: &Arc<Host>) -> Result<(), String> {
    let show = MenuItem::with_id(app, "show", "Show Alloy", true, None::<&str>)
        .map_err(|_| "Could not create the Alloy tray menu.")?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)
        .map_err(|_| "Could not create the Alloy tray menu.")?;
    let quit = MenuItem::with_id(app, "quit", "Quit Alloy", true, None::<&str>)
        .map_err(|_| "Could not create the Alloy tray menu.")?;
    let menu = Menu::with_items(app, &[&show, &settings, &quit])
        .map_err(|_| "Could not create the Alloy tray menu.")?;
    let menu_host = Arc::clone(host);
    let click_host = Arc::clone(host);
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Alloy")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                let _ = show_active(app, &menu_host);
            }
            "settings" => {
                let _ = show_settings(app, &menu_host);
            }
            "quit" => request_quit(app, &menu_host),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click { .. } | TrayIconEvent::DoubleClick { .. }
            ) {
                let _ = show_active(tray.app_handle(), &click_host);
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)
        .map_err(|_| "Could not create the Alloy tray icon.")?;
    Ok(())
}

fn spawn_update_events(
    app: AppHandle,
    host: &Arc<Host>,
    mut events: tokio::sync::broadcast::Receiver<services::DesktopUpdateState>,
) {
    let host = Arc::downgrade(host);
    tauri::async_runtime::spawn(async move {
        loop {
            let state = match events.recv().await {
                Ok(state) => state,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };
            let Some(host) = host.upgrade() else {
                break;
            };
            let remote = host.remote.read().ok().and_then(|remote| {
                remote
                    .as_ref()
                    .map(|session| session.window.label().to_string())
            });
            if let Some(label) = remote {
                let _ = app.emit_to(label, "alloy:updates", state);
            }
        }
    });
}

fn spawn_restore_saved_server(app: &AppHandle, host: &Arc<Host>) {
    let app = app.clone();
    let host = Arc::clone(host);
    tauri::async_runtime::spawn(async move {
        let _connecting = host.connecting.lock().await;
        let url = match host
            .services()
            .ok()
            .and_then(|services| services.get_current_server())
        {
            Some(url) => url,
            None => return,
        };
        let server = match prepare_server(&url).await {
            Ok(server) => server,
            Err(error) => {
                eprintln!("Could not restore the saved Alloy server: {error}");
                return;
            }
        };
        let runtime = match host.runtime() {
            Ok(runtime) => runtime.clone(),
            Err(error) => {
                eprintln!("Could not restore the saved Alloy server: {error}");
                return;
            }
        };
        let (_, cancelled) = watch::channel(false);
        let _selection = runtime.selection_lock.lock().await;
        match install_remote(&app, &host, &runtime, server, None, &cancelled).await {
            Ok(_) => {
                if let Some(connect) = app.get_webview_window(CONNECT_WINDOW_LABEL) {
                    let _ = connect.hide();
                }
            }
            Err(error) if error == NO_SAVED_SESSION => {}
            Err(error) => eprintln!("Could not restore the saved Alloy server: {error}"),
        }
    });
}

fn handle_run_event(app: &AppHandle, event: RunEvent, host: &Arc<Host>) {
    let RunEvent::ExitRequested { api, code, .. } = event else {
        return;
    };
    if code == Some(tauri::RESTART_EXIT_CODE) || host.quitting.load(Ordering::Acquire) {
        return;
    }
    api.prevent_exit();
    request_quit(app, host);
}

fn main() {
    let host = Arc::new(Host::default());
    let setup_host = Arc::clone(&host);
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(host) = app.try_state::<Arc<Host>>() {
                let _ = show_active(app, host.inner());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Alloy")
                .build(),
        )
        .manage(host.clone())
        .invoke_handler(tauri::generate_handler![
            connect_server,
            cancel_connect,
            saved_servers,
            forget_server,
            desktop_shell,
            desktop_api,
        ])
        .setup(move |app| {
            let state_dir = app.path().app_data_dir()?;
            let services = Arc::new(DesktopServices::new(app.handle().clone(), state_dir));
            setup_host
                .services
                .set(services.clone())
                .map_err(|_| std::io::Error::other("Desktop services were initialized twice."))?;
            let runtime = tauri::async_runtime::block_on(DesktopRuntime::new(
                app.handle(),
                Arc::downgrade(&setup_host),
            ))
            .map_err(std::io::Error::other)?;
            setup_host
                .runtime
                .set(runtime.clone())
                .map_err(|_| std::io::Error::other("Desktop runtime was initialized twice."))?;
            tauri::async_runtime::spawn(async move {
                runtime.start().await;
            });

            let window = WebviewWindowBuilder::new(
                app,
                CONNECT_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("Alloy")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .on_navigation(is_local_app_url)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .build()?;
            let event_host = Arc::clone(&setup_host);
            let event_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let _ = send_cancel(&event_host);
                    if !event_host.quitting.load(Ordering::Acquire) {
                        api.prevent_close();
                        let _ = event_window.hide();
                    }
                }
            });
            setup_tray(app.handle(), &setup_host).map_err(std::io::Error::other)?;
            spawn_update_events(
                app.handle().clone(),
                &setup_host,
                services.subscribe_update_state(),
            );
            spawn_restore_saved_server(app.handle(), &setup_host);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not build Alloy")
        .run(move |app, event| handle_run_event(app, event, &host));
}
