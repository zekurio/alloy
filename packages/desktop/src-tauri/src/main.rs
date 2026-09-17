#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;
mod services;

use std::{
    sync::{
        Arc, Mutex, OnceLock, RwLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use alloy_desktop::{
    login::{BrowserLogin, InjectedCookies, SessionTokens},
    policy::{
        CONNECT_WINDOW_LABEL, SERVER_WINDOW_PREFIX, bridge_initialization_script, is_local_app_url,
        is_same_origin, remote_window_label,
    },
    server::Server,
};
use runtime::DesktopRuntime;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use services::{
    DesktopSavedServer, DesktopServices, DesktopWindowState, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH,
};
use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{Cookie, NewWindowResponse, PageLoadEvent},
    window::Color,
};
use tokio::sync::watch;
use url::Url;

const DESKTOP_SHELL_PERMISSION: &str = "allow-desktop-shell";
const DESKTOP_API_PERMISSION: &str = "allow-desktop-api";
const NO_SAVED_SESSION: &str = "No saved Alloy session was found.";
/// Painted behind every webview until the page renders, so windows never
/// flash white while the app loads. Matches the dark app background
/// (`--background`, `oklch(0.11 0 0)`).
const WINDOW_BACKGROUND: Color = Color(0x04, 0x04, 0x04, 0xff);
/// If the connect screen never reports that it rendered, show it anyway so a
/// broken bundle does not look like the app silently doing nothing.
const CONNECT_SHOW_FALLBACK: Duration = Duration::from_secs(3);
/// How long a server window stays hidden waiting for its page to load before
/// it is shown anyway, so a slow server still surfaces the window.
const REMOTE_SHOW_FALLBACK: Duration = Duration::from_secs(3);
/// How often, and for how long, the host checks whether the server has
/// replaced the injected bootstrap cookies with its own.
const COOKIE_HANDOFF_POLL: Duration = Duration::from_millis(200);
const COOKIE_HANDOFF_TIMEOUT: Duration = Duration::from_secs(10);
/// Window size used until the user has resized a window once.
const DEFAULT_WINDOW_STATE: DesktopWindowState = DesktopWindowState {
    width: 1280,
    height: 800,
    maximized: false,
};
/// How long after the last resize event the window size is persisted, so
/// dragging a window edge does not rewrite the preferences file every frame.
const WINDOW_STATE_SAVE_DELAY: Duration = Duration::from_millis(400);

/// Bumped on every resize so only the last save of a burst runs.
static WINDOW_STATE_REVISION: AtomicU64 = AtomicU64::new(0);

struct Host {
    connecting: tokio::sync::Mutex<()>,
    cancel: Mutex<Option<watch::Sender<bool>>>,
    remote: RwLock<Option<RemoteSession>>,
    next_generation: AtomicU64,
    services: OnceLock<Arc<DesktopServices>>,
    runtime: OnceLock<Arc<DesktopRuntime>>,
    quitting: AtomicBool,
    /// Set while a freshly created connect screen waits to be shown. It stays
    /// hidden until its page has rendered to avoid a blank window.
    connect_pending: AtomicBool,
    /// Set while the connect window is being created, so concurrent requests
    /// to show it do not race to build a second one.
    connect_creating: AtomicBool,
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
            connect_pending: AtomicBool::new(false),
            connect_creating: AtomicBool::new(false),
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
    StartDragging,
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
    let connected = connect_to_server(&app, host.inner(), &url).await?;
    // The connect screen is destroyed rather than hidden: its WebView keeps a
    // whole browser process tree alive, and it is cheap to recreate later.
    let _ = window.destroy();
    Ok(connected)
}

/// Validate, sign in if needed, and open the server window. Both the bundled
/// connect screen and the in-app server settings switch servers through here.
async fn connect_to_server(
    app: &AppHandle,
    host: &Arc<Host>,
    url: &str,
) -> Result<ConnectedServer, String> {
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
        result = prepare_server(url) => result,
        _ = prepare_cancelled.changed() => Err("Sign-in was cancelled.".into()),
    } {
        Ok(server) => server,
        Err(error) => {
            clear_cancel(host);
            return Err(error);
        }
    };
    let runtime = match host.runtime() {
        Ok(runtime) => runtime.clone(),
        Err(error) => {
            clear_cancel(host);
            return Err(error);
        }
    };
    let generation = {
        let _selection = runtime.selection_lock.lock().await;
        install_remote(app, host, &runtime, server.clone(), None, &cancelled, true).await
    };
    let generation = match generation {
        Ok(generation) => generation,
        Err(error) => {
            if error != NO_SAVED_SESSION {
                clear_cancel(host);
                return Err(error);
            }

            let mut login_cancelled = cancelled.clone();
            let login = match tokio::select! {
                result = browser_login(&server) => result,
                _ = login_cancelled.changed() => Err("Sign-in was cancelled.".into()),
            } {
                Ok(tokens) => tokens,
                Err(error) => {
                    clear_cancel(host);
                    return Err(error);
                }
            };
            if let Err(error) = ensure_not_cancelled(&cancelled) {
                clear_cancel(host);
                return Err(error);
            }
            let _selection = runtime.selection_lock.lock().await;
            match install_remote(
                app,
                host,
                &runtime,
                server.clone(),
                Some(&login),
                &cancelled,
                true,
            )
            .await
            {
                Ok(generation) => generation,
                Err(error) => {
                    clear_cancel(host);
                    return Err(error);
                }
            }
        }
    };

    if let Err(error) = ensure_not_cancelled(&cancelled) {
        abandon_remote(app, host, &runtime, generation).await;
        clear_cancel(host);
        return Err(error);
    }

    if let Err(error) = host.services()?.remember_server(
        server.origin.origin().ascii_serialization().as_str(),
        alloy_desktop::server::HTTP_CONTRACT_1,
        alloy_desktop::server::TAURI_BRIDGE_CONTRACT_1,
    ) {
        clear_cancel(host);
        return Err(error);
    }
    clear_cancel(host);

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

/// The connect screen calls this once it has painted, so the window is only
/// shown with content in it. Restoring a saved server keeps it hidden.
#[tauri::command]
fn connect_ready(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
) -> Result<(), String> {
    require_connect_window(&window)?;
    show_pending_connect(&app, host.inner());
    Ok(())
}

fn show_pending_connect(app: &AppHandle, host: &Arc<Host>) {
    if host.connect_pending.swap(false, Ordering::AcqRel) {
        let _ = show_connect(app, host);
    }
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
    forget_saved_server(&app, host.inner(), &url).await
}

async fn forget_saved_server(
    app: &AppHandle,
    host: &Arc<Host>,
    url: &str,
) -> Result<Vec<DesktopSavedServer>, String> {
    let _connecting = host.connecting.lock().await;
    let origin = Server::new(url)?.origin;
    let runtime = host.runtime()?.clone();
    let active = host
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
        clear_remote(host, generation);
        let _ = remote_window.destroy();
    } else {
        clear_inactive_remote_profile(app, &origin, host)?;
    }
    host.services()?
        .forget_server(origin.origin().ascii_serialization().as_str())
}

#[tauri::command]
async fn desktop_api(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
    operation: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let (_, origin) = require_remote_window(&window, host.inner())?;
    let runtime = host.inner().runtime()?.clone();
    let services = host.inner().services()?.clone();
    let result = match operation.as_str() {
        operation if operation.starts_with("recording.") => {
            runtime.invoke(&window, operation, &args).await
        }
        "servers.list" => runtime_value(services.get_servers()),
        "servers.current" => runtime_value(origin.origin().ascii_serialization()),
        "servers.forget" => {
            let url: String = runtime_arg(&args, 0)?;
            if is_same_origin(&Server::new(&url)?.origin, &origin) {
                return Err("Switch to another server before forgetting this one.".into());
            }
            runtime_value(forget_saved_server(&app, host.inner(), &url).await?)
        }
        "servers.switchTo" => {
            let url: String = runtime_arg(&args, 0)?;
            // A successful switch replaces the calling window, so return
            // without re-checking it.
            return runtime_value(connect_to_server(&app, host.inner(), &url).await?);
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
    let (_, origin) = require_remote_window(&window, host.inner())?;
    match operation {
        DesktopShellOperation::StartDragging => window
            .start_dragging()
            .map_err(|_| "Could not move the server window.".into()),
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
        // Closing the server window keeps the session, recorder, and media
        // work alive in the tray. Quit from the tray menu ends the app.
        DesktopShellOperation::CloseWindow => window
            .hide()
            .map_err(|_| "Could not hide the server window.".into()),
        DesktopShellOperation::OpenConnect => {
            if window
                .url()
                .map_err(|_| "Could not check the server window.")?
                .path()
                == "/login"
            {
                clear_session_cookies(&window, &origin)?;
            }
            // Switching servers returns to the connect screen. The server
            // window stays alive so closing the connect screen restores it.
            window
                .hide()
                .map_err(|_| "Could not hide the server window.")?;
            show_connect(&app, host.inner())
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

/// Hands a link the shell will not open itself to the user's browser. Only
/// `http` and `https` are forwarded, so a page cannot launch another handler.
fn open_external(url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = open::that_detached(url.as_str());
    }
}

/// The size a new window opens with: the last saved size, clamped to the
/// primary monitor so a window saved on a larger display still opens fully
/// on screen.
fn restored_window_state(app: &AppHandle, services: &DesktopServices) -> DesktopWindowState {
    let saved = services.get_window_state().unwrap_or(DEFAULT_WINDOW_STATE);
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return saved;
    };
    let available = monitor.size().to_logical::<f64>(monitor.scale_factor());
    DesktopWindowState::clamped(
        saved.width.min(available.width.round() as u32),
        saved.height.min(available.height.round() as u32),
        saved.maximized,
    )
}

/// Writes a window's current geometry to the preferences file. A maximized
/// window reports the screen size, so its last normal size is kept for when
/// it is restored unmaximized.
fn save_window_state(window: &WebviewWindow, services: &DesktopServices) {
    // A minimized window reports a zero size, and its maximized flag is
    // cleared, so skip it: minimizing must not change the remembered size.
    let Ok(minimized) = window.is_minimized() else {
        return;
    };
    if minimized {
        return;
    }
    let previous = services.get_window_state().unwrap_or(DEFAULT_WINDOW_STATE);
    let Ok(maximized) = window.is_maximized() else {
        return;
    };
    let (width, height) = if maximized {
        (previous.width, previous.height)
    } else {
        let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
            return;
        };
        if size.width == 0 || size.height == 0 {
            return;
        }
        let logical = size.to_logical::<f64>(scale);
        (logical.width.round() as u32, logical.height.round() as u32)
    };
    let state = DesktopWindowState::clamped(width, height, maximized);
    if state == previous {
        return;
    }
    if let Err(error) = services.remember_window_state(state) {
        log::warn!("Could not save the window size: {error}");
    }
}

/// Saves the geometry of every window still alive, so quitting right after a
/// resize does not lose it.
fn flush_window_state(app: &AppHandle, host: &Host) {
    let Ok(services) = host.services() else {
        return;
    };
    if let Some(window) = app.get_webview_window(CONNECT_WINDOW_LABEL) {
        save_window_state(&window, services);
    }
    if let Some(window) = host
        .remote
        .read()
        .ok()
        .and_then(|remote| remote.as_ref().map(|session| session.window.clone()))
    {
        save_window_state(&window, services);
    }
}

/// Coalesces a burst of resize events into one write after the user stops
/// dragging.
fn queue_window_state_save(window: WebviewWindow, services: Arc<DesktopServices>) {
    let revision = WINDOW_STATE_REVISION.fetch_add(1, Ordering::Relaxed) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WINDOW_STATE_SAVE_DELAY).await;
        if WINDOW_STATE_REVISION.load(Ordering::Relaxed) != revision {
            return;
        }
        save_window_state(&window, &services);
    });
}

fn track_window_state(window: &WebviewWindow, services: Arc<DesktopServices>) {
    let tracked = window.clone();
    window.clone().on_window_event(move |event| {
        if matches!(event, WindowEvent::Resized(_)) {
            queue_window_state_save(tracked.clone(), Arc::clone(&services));
        }
    });
}

/// `show` is false when the app was started as a login item: the saved server
/// is restored so the recorder warms up, but its window stays hidden until the
/// user opens it from the tray.
async fn install_remote(
    app: &AppHandle,
    host: &Arc<Host>,
    runtime: &Arc<DesktopRuntime>,
    server: Server,
    tokens: Option<&SessionTokens>,
    cancelled: &watch::Receiver<bool>,
    show: bool,
) -> Result<u64, String> {
    ensure_not_cancelled(cancelled)?;
    let services = Arc::clone(host.services()?);
    let state = restored_window_state(app, &services);
    let generation = host.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let label = remote_window_label(generation);
    add_remote_capability(app, &label, &server.origin)?;

    let origin = server.origin.clone();
    let navigation_origin = origin.clone();
    let load_origin = origin.clone();
    let (loaded_sender, mut loaded) = watch::channel(false);
    let event_host = Arc::clone(host);
    let event_app = app.clone();
    let event_runtime = Arc::clone(runtime);
    let blank = Url::parse("about:blank").map_err(|_| "Could not open the Alloy server window.")?;
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank))
        .title("Alloy")
        .inner_size(f64::from(state.width), f64::from(state.height))
        .min_inner_size(f64::from(MIN_WINDOW_WIDTH), f64::from(MIN_WINDOW_HEIGHT))
        .maximized(state.maximized)
        .visible(false)
        .background_color(WINDOW_BACKGROUND)
        // The web app renders its own title bar and window controls.
        .decorations(false)
        .incognito(false)
        .initialization_script(bridge_initialization_script(&origin));
    // Overlay scrollbars keep the layout stable. Setting extra arguments
    // replaces Tauri's defaults, so restate them.
    let builder = builder.additional_browser_args(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=OverlayScrollbar",
    );
    let builder = builder.data_directory(remote_profile_path(app, &origin)?);
    let window = builder
        .on_navigation(move |url| {
            if url.as_str() == "about:blank" || is_same_origin(url, &navigation_origin) {
                return true;
            }
            // A link that leaves the server belongs in the user's browser
            // rather than in a window holding the native bridge.
            open_external(url);
            false
        })
        .on_new_window(|url, _| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Finished
                && is_same_origin(payload.url(), &load_origin)
            {
                loaded_sender.send_replace(true);
            }
        })
        .build()
        .map_err(|_| "Could not open the Alloy server window.")?;
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        // Alt+F4 and the like behave like the title bar close button: hide
        // to the tray and keep the server selected.
        WindowEvent::CloseRequested { api, .. } if !event_host.quitting.load(Ordering::Acquire) => {
            api.prevent_close();
            let _ = event_window.hide();
        }
        WindowEvent::Destroyed if clear_remote(&event_host, generation) => {
            let app = event_app.clone();
            let host = Arc::clone(&event_host);
            let runtime = Arc::clone(&event_runtime);
            tauri::async_runtime::spawn(async move {
                let _ = runtime.select_server(None).await;
                let _ = show_connect(&app, &host);
            });
        }
        _ => {}
    });
    track_window_state(&window, services);

    if let Err(error) = ensure_not_cancelled(cancelled) {
        let _ = window.destroy();
        return Err(error);
    }
    let injected = tokens.map(SessionTokens::injected_cookies);
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
    // Stay hidden until the page has loaded, so the web app's boot splash is
    // the first thing on screen rather than an empty frameless window.
    if show {
        let mut cancel_wait = cancelled.clone();
        tokio::select! {
            _ = loaded.wait_for(|done| *done) => {}
            // The restore flow drops its cancel sender, which is not a cancel.
            Ok(_) = cancel_wait.wait_for(|cancel| *cancel) => {}
            () = tokio::time::sleep(REMOTE_SHOW_FALLBACK) => {}
        }
    }
    if let Err(error) = ensure_not_cancelled(cancelled) {
        restore_remote(host, generation, previous);
        let _ = runtime.select_server(previous_origin).await;
        let _ = window.destroy();
        return Err(error);
    }
    let shown = if show {
        window
            .show()
            .map_err(|_| "Could not show the Alloy server window.".to_string())
            .and_then(|()| {
                window
                    .set_focus()
                    .map_err(|_| "Could not focus the Alloy server window.".to_string())
            })
    } else {
        Ok(())
    };
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
    if let Some(injected) = injected {
        tauri::async_runtime::spawn(replace_injected_cookies(window, origin, injected, loaded));
    }
    Ok(generation)
}

/// Swaps the cookies the host injected for the ones the server sets itself.
///
/// The injected pair must carry a `Domain` (see `session_cookie` in
/// `login.rs`), so on a registrable domain it is stored as a domain cookie
/// while the server's is host-only. Both would then be sent for every request
/// and hono keeps the first, so a rotated refresh token would stay shadowed by
/// the stale injected one until the server revoked the session family. Asking
/// the signed-in page to refresh once makes the webview receive the server's
/// own `Set-Cookie`; the injected copies are then deleted, leaving one copy of
/// each name. Only runs after a fresh sign-in — a restored session never
/// injected anything.
async fn replace_injected_cookies(
    window: WebviewWindow,
    origin: Url,
    injected: InjectedCookies,
    mut loaded: watch::Receiver<bool>,
) {
    // An error here means the window is gone, and with it the cookies.
    if loaded.wait_for(|done| *done).await.is_err() {
        return;
    }
    // Same-origin `fetch` from the page itself, so the browser attaches the
    // cookies and the `Sec-Fetch-Site: same-origin` the server's CSRF check
    // wants. The endpoint takes no body and no extra headers.
    if window
        .eval("fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).catch(() => {})")
        .is_err()
    {
        return;
    }
    let deadline = tokio::time::Instant::now() + COOKIE_HANDOFF_TIMEOUT;
    loop {
        let Ok(cookies) = window.cookies_for_url(origin.clone()) else {
            return;
        };
        // A refresh cookie the host did not inject is the server's own.
        if cookies.iter().any(|cookie| {
            cookie.name() == "alloy_refresh"
                && !injected.is_injected_cookie(cookie.name(), cookie.value())
        }) {
            for cookie in cookies
                .into_iter()
                .filter(|cookie| injected.is_injected_cookie(cookie.name(), cookie.value()))
            {
                let _ = window.delete_cookie(cookie);
            }
            return;
        }
        if tokio::time::Instant::now() >= deadline {
            log::warn!(
                "The server did not replace the injected session cookies. Sign in again if the session drops."
            );
            return;
        }
        tokio::time::sleep(COOKIE_HANDOFF_POLL).await;
    }
}

async fn abandon_remote(
    app: &AppHandle,
    host: &Arc<Host>,
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
    let _ = show_connect(app, host);
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

fn remote_profile_path(app: &AppHandle, origin: &Url) -> Result<std::path::PathBuf, String> {
    let path = remote_profile_directory(app, origin)?;
    std::fs::create_dir_all(&path)
        .map_err(|_| "Could not create the Alloy server profile folder.")?;
    Ok(path)
}

fn remote_profile_directory(app: &AppHandle, origin: &Url) -> Result<std::path::PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
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
    let builder = builder.data_directory(remote_profile_path(app, origin)?);
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

/// Grants the selected server's window the shell and `desktop_api` bridge
/// permissions, which include listing, switching, and forgetting saved servers
/// from that server's web UI.
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

/// Show the connect screen, creating it when it does not exist. The window
/// only lives while it is needed: a WebView in its own profile costs a full
/// browser process tree, so it is destroyed once a server window takes over.
fn show_connect(app: &AppHandle, host: &Arc<Host>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(CONNECT_WINDOW_LABEL) {
        // A freshly created window is shown by `connect_ready` once painted.
        if host.connect_pending.load(Ordering::Acquire) {
            return Ok(());
        }
        window
            .show()
            .map_err(|_| "Could not show the connect window.")?;
        return window
            .set_focus()
            .map_err(|_| "Could not focus the connect window.".to_string());
    }
    if host
        .connect_creating
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        // Another caller is building it; that window will be shown once
        // it reports it has rendered.
        return Ok(());
    }
    host.connect_pending.store(true, Ordering::Release);
    let created = create_connect_window(app, host);
    host.connect_creating.store(false, Ordering::Release);
    if let Err(error) = created {
        host.connect_pending.store(false, Ordering::Release);
        return Err(error);
    }
    let fallback_app = app.clone();
    let fallback_host = Arc::clone(host);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CONNECT_SHOW_FALLBACK).await;
        show_pending_connect(&fallback_app, &fallback_host);
    });
    Ok(())
}

fn create_connect_window(app: &AppHandle, host: &Arc<Host>) -> Result<(), String> {
    let services = Arc::clone(host.services()?);
    let state = restored_window_state(app, &services);
    let window = WebviewWindowBuilder::new(
        app,
        CONNECT_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Alloy")
    .inner_size(f64::from(state.width), f64::from(state.height))
    .min_inner_size(f64::from(MIN_WINDOW_WIDTH), f64::from(MIN_WINDOW_HEIGHT))
    .maximized(state.maximized)
    .visible(false)
    .background_color(WINDOW_BACKGROUND)
    .on_navigation(is_local_app_url)
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .build()
    .map_err(|_| "Could not open the connect window.")?;
    track_window_state(&window, services);
    let event_host = Arc::clone(host);
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { .. } = event {
            let _ = send_cancel(&event_host);
            // Closing the connect screen returns to the server that was open
            // before a server switch, if any. Without one the app stays in
            // the tray; the window itself is destroyed either way.
            if !event_host.quitting.load(Ordering::Acquire) {
                let _ = focus_remote(&event_host);
            }
        }
    });
    Ok(())
}

/// Show and focus the active server window, if any.
fn focus_remote(host: &Host) -> Result<bool, String> {
    let remote = host
        .remote
        .read()
        .map_err(|_| "Server window state is unavailable.")?
        .as_ref()
        .map(|session| session.window.clone());
    let Some(window) = remote else {
        return Ok(false);
    };
    window
        .show()
        .map_err(|_| "Could not show the Alloy server window.")?;
    window
        .set_focus()
        .map_err(|_| "Could not focus the Alloy server window.")?;
    Ok(true)
}

/// Show the active server window, if any, and drop the connect screen.
fn show_remote(app: &AppHandle, host: &Arc<Host>) -> Result<bool, String> {
    if !focus_remote(host)? {
        return Ok(false);
    }
    destroy_connect(app);
    Ok(true)
}

fn destroy_connect(app: &AppHandle) {
    if let Some(connect) = app.get_webview_window(CONNECT_WINDOW_LABEL) {
        let _ = connect.destroy();
    }
}

fn show_active(app: &AppHandle, host: &Arc<Host>) -> Result<(), String> {
    if show_remote(app, host)? {
        Ok(())
    } else {
        show_connect(app, host)
    }
}

fn show_settings(app: &AppHandle, host: &Arc<Host>) -> Result<(), String> {
    let remote = host
        .remote
        .read()
        .map_err(|_| "Server window state is unavailable.")?
        .as_ref()
        .map(|session| session.window.clone());
    let Some(window) = remote else {
        return show_connect(app, host);
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
            log::warn!("Could not stop Alloy before exit: {error}");
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
        // Left click shows the app, right click shows the menu. With the
        // default, a left click popped the menu and then immediately closed
        // it when the window took focus.
        .show_menu_on_left_click(false)
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
            let left_click = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            );
            if left_click {
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

/// How long the shell waits after launch before its first release check, so
/// restoring the saved server and starting the recorder are not competing with
/// it.
const UPDATE_CHECK_STARTUP_DELAY: Duration = Duration::from_secs(5 * 60);
/// How often the shell re-checks the release feed while it keeps running.
/// Releases ship a few times a week at most, so an hourly poll keeps every
/// install quiet without a noticeable delay before an update is offered.
const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Polls the release feed in the background. Results land in the shared
/// update state, so the web app picks them up through `alloy:updates` or on
/// its next `updates.getState` call, even if no server window was open when
/// the release appeared. Failures are logged and retried at the next tick.
fn spawn_update_checks(services: Arc<DesktopServices>) {
    if !services.updates_supported() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(UPDATE_CHECK_STARTUP_DELAY).await;
        loop {
            if let Err(error) = services.check_for_updates().await {
                log::warn!("Background update check failed: {error}");
            }
            tokio::time::sleep(UPDATE_CHECK_INTERVAL).await;
        }
    });
}

/// Whether the app was started as a login item. The autostart registration
/// passes `--autostart`, and such a start stays in the tray with no window.
fn launched_at_login() -> bool {
    std::env::args().any(|argument| argument == "--autostart")
}

fn spawn_restore_saved_server(app: &AppHandle, host: &Arc<Host>) {
    let app = app.clone();
    let host = Arc::clone(host);
    let show = !launched_at_login();
    tauri::async_runtime::spawn(async move {
        let _connecting = host.connecting.lock().await;
        // A login-item start shows nothing: the tray opens the connect screen
        // or the restored server window when the user asks for it.
        let fall_back_to_connect = |app: &AppHandle, host: &Arc<Host>| {
            if show {
                let _ = show_connect(app, host);
            }
        };
        let url = match host
            .services()
            .ok()
            .and_then(|services| services.get_current_server())
        {
            Some(url) => url,
            None => {
                fall_back_to_connect(&app, &host);
                return;
            }
        };
        let server = match prepare_server(&url).await {
            Ok(server) => server,
            Err(error) => {
                log::warn!("Could not restore the saved Alloy server: {error}");
                fall_back_to_connect(&app, &host);
                return;
            }
        };
        let runtime = match host.runtime() {
            Ok(runtime) => runtime.clone(),
            Err(error) => {
                log::warn!("Could not restore the saved Alloy server: {error}");
                fall_back_to_connect(&app, &host);
                return;
            }
        };
        let (_, cancelled) = watch::channel(false);
        let _selection = runtime.selection_lock.lock().await;
        match install_remote(&app, &host, &runtime, server, None, &cancelled, show).await {
            // The connect screen only exists here if it was opened from the
            // tray while the server was still being restored.
            Ok(_) => destroy_connect(&app),
            Err(error) => {
                if error != NO_SAVED_SESSION {
                    log::warn!("Could not restore the saved Alloy server: {error}");
                }
                fall_back_to_connect(&app, &host);
            }
        }
    });
}

fn handle_run_event(app: &AppHandle, event: RunEvent, host: &Arc<Host>) {
    let RunEvent::ExitRequested { api, code, .. } = event else {
        return;
    };
    // The last resize may still be waiting on the debounce, and the windows
    // are still alive here, so capture the current geometry before saying yes.
    flush_window_state(app, host);
    if code == Some(tauri::RESTART_EXIT_CODE) || host.quitting.load(Ordering::Acquire) {
        return;
    }
    api.prevent_exit();
    // Closing the last window (the connect screen with no server selected)
    // keeps capture and media work alive in the tray, like closing the
    // server window does. Quit from the tray menu ends the app.
}

fn main() {
    let host = Arc::new(Host::default());
    let setup_host = Arc::clone(&host);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(host) = app.try_state::<Arc<Host>>() {
                let _ = show_active(app, host.inner());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Alloy")
                // `launched_at_login` reads this back to keep a login start
                // in the tray instead of opening a window.
                .args(["--autostart"])
                .build(),
        )
        .manage(host.clone())
        .invoke_handler(tauri::generate_handler![
            connect_server,
            connect_ready,
            cancel_connect,
            saved_servers,
            forget_server,
            desktop_shell,
            desktop_api,
        ])
        .setup(move |app| {
            if let Err(error) = alloy_desktop::logging::init(&app.path().app_log_dir()?) {
                eprintln!("Could not open the Alloy log file: {error}");
            }
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

            // With a saved server the app restores its window directly and
            // only opens the connect screen if that fails. Otherwise the
            // connect screen is created now and shown once it has rendered.
            // A login-item start opens no window at all.
            if services.get_current_server().is_none() && !launched_at_login() {
                show_connect(app.handle(), &setup_host).map_err(std::io::Error::other)?;
            }
            setup_tray(app.handle(), &setup_host).map_err(std::io::Error::other)?;
            spawn_update_events(
                app.handle().clone(),
                &setup_host,
                services.subscribe_update_state(),
            );
            spawn_update_checks(services.clone());
            spawn_restore_saved_server(app.handle(), &setup_host);
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        // Release builds have no console, so a panic here would look like
        // the app silently doing nothing.
        Err(error) => fail_startup(&error.to_string()),
    };
    app.run(move |app, event| handle_run_event(app, event, &host));
}

fn fail_startup(message: &str) -> ! {
    eprintln!("Could not start Alloy: {message}");
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Alloy could not start")
        .set_description(message)
        .show();
    std::process::exit(1)
}
