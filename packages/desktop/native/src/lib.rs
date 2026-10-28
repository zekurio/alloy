//! Node-API bindings for the Electron main process. Each export wraps one
//! piece of `alloy-desktop`; the shell in `src/main/` owns windows, cookies,
//! and dialogs, and declares the matching TypeScript types in `native.ts`.
//!
//! Errors reject with the same fixed, translatable messages the Rust code
//! returns. Values the renderer supplied arrive as JSON text, so they are
//! validated by the same serde types as before; results are plain JSON values.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use alloy_desktop::login::BrowserLogin;
use alloy_desktop::preferences::{DesktopWindowState, PreferencesStore};
use alloy_desktop::runtime::{CaptureAction, DesktopRuntime, RuntimeOptions, ShortcutDescriptions};
use alloy_desktop::server::{Server, server_origin};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue,
};
use napi_derive::napi;
use serde_json::Value;
use tokio::sync::watch;

const SIGN_IN_CANCELLED: &str = "Sign-in was cancelled.";

fn reject(message: impl Into<String>) -> Error {
    Error::from_reason(message.into())
}

fn origin(input: &str) -> Result<url::Url> {
    server_origin(input).map_err(reject)
}

fn parse_json(input: &str) -> Result<Value> {
    serde_json::from_str(input).map_err(|_| reject("Invalid native argument."))
}

/// Starts the host log in `directory`. Every later `log` call, and the native
/// code's own diagnostics, land in `alloy-desktop.log` there.
#[napi]
pub fn init_logging(directory: String) -> Result<()> {
    alloy_desktop::logging::init(&PathBuf::from(directory))
        .map_err(|error| reject(error.to_string()))
}

/// Writes one line from the shell to the host log.
#[napi]
pub fn log(level: String, message: String) {
    let level = match level.as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        _ => log::Level::Info,
    };
    log::log!(target: "alloy_shell", level, "{message}");
}

#[napi]
pub fn flush_log() {
    log::logger().flush();
}

/// The canonical origin of a server URL the user entered, or a rejection
/// with the reason it is not acceptable.
#[napi]
pub fn normalize_server_origin(input: String) -> Result<String> {
    Ok(origin(&input)?.origin().ascii_serialization())
}

#[napi(object)]
pub struct PreparedServer {
    pub origin: String,
    pub version: String,
}

/// Validates a server URL and checks that the server speaks HTTP contract 1
/// and bridge contract 1 and supports desktop sign-in.
#[napi]
pub async fn prepare_server(input: String) -> Result<PreparedServer> {
    let server = Server::new(&input).map_err(reject)?;
    let version = server.check().await.map_err(reject)?;
    Ok(PreparedServer {
        origin: server.origin.origin().ascii_serialization(),
        version,
    })
}

#[napi(object)]
pub struct DownloadedUpdate {
    /// The installer electron-updater downloaded.
    pub path: String,
    /// The version the release feed offers.
    pub version: String,
    /// The running app's version.
    pub current_version: String,
}

/// Checks a downloaded update against its release signature with the
/// trusted updater public keys. Resolves to false when the signature does not
/// verify or is not for this file and a newer version; rejects with "Could
/// not read the downloaded update." when the file cannot be read.
#[napi]
pub async fn verify_update_signature(
    public_keys: String,
    signature: String,
    update: DownloadedUpdate,
) -> Result<bool> {
    use alloy_desktop::update_signature::{ExpectedUpdate, UpdateSignatureError, verify_file};

    let verified = napi::bindgen_prelude::spawn_blocking(move || {
        let expected = ExpectedUpdate {
            version: &update.version,
            current_version: &update.current_version,
        };
        verify_file(
            &public_keys,
            &signature,
            &PathBuf::from(update.path),
            &expected,
        )
    })
    .await
    .map_err(|error| reject(error.to_string()))?;
    match verified {
        Ok(()) => Ok(true),
        Err(UpdateSignatureError::Invalid) => Ok(false),
        Err(error @ UpdateSignatureError::Unreadable) => Err(reject(error.to_string())),
    }
}

#[napi(object)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// Saved servers and window geometry in `preferences.json`.
#[napi]
pub struct Preferences {
    store: PreferencesStore,
}

#[napi]
impl Preferences {
    #[napi(constructor)]
    pub fn new(state_directory: String) -> Self {
        Self {
            store: PreferencesStore::new(state_directory),
        }
    }

    #[napi]
    pub fn servers(&self) -> Result<Value> {
        serde_json::to_value(self.store.get_servers()).map_err(|error| reject(error.to_string()))
    }

    #[napi]
    pub fn current_server(&self) -> Option<String> {
        self.store.get_current_server()
    }

    /// Moves a server that passed `prepareServer` to the top of the list.
    #[napi]
    pub fn remember_server(&self, server: String, version: String) -> Result<Value> {
        let servers = self
            .store
            .remember_server(&origin(&server)?, &version)
            .map_err(reject)?;
        serde_json::to_value(servers).map_err(|error| reject(error.to_string()))
    }

    #[napi]
    pub fn forget_server(&self, server: String) -> Result<Value> {
        let servers = self
            .store
            .forget_server(&origin(&server)?)
            .map_err(reject)?;
        serde_json::to_value(servers).map_err(|error| reject(error.to_string()))
    }

    #[napi]
    pub fn window_state(&self) -> Option<WindowState> {
        self.store.get_window_state().map(|state| WindowState {
            width: state.width,
            height: state.height,
            maximized: state.maximized,
        })
    }

    /// Saves a window size, clamped to what the web app can lay out in. Returns
    /// the state as stored.
    #[napi]
    pub fn remember_window_state(&self, state: WindowState) -> Result<WindowState> {
        let state = DesktopWindowState::clamped(state.width, state.height, state.maximized);
        self.store.remember_window_state(state).map_err(reject)?;
        Ok(WindowState {
            width: state.width,
            height: state.height,
            maximized: state.maximized,
        })
    }

    /// Clamps a size the same way `rememberWindowState` does.
    #[napi]
    pub fn clamp_window_state(&self, state: WindowState) -> WindowState {
        let state = DesktopWindowState::clamped(state.width, state.height, state.maximized);
        WindowState {
            width: state.width,
            height: state.height,
            maximized: state.maximized,
        }
    }
}

#[napi(object)]
pub struct SessionToken {
    /// The `alloy_session` cookie value. It stays in the main process.
    pub token: String,
    /// Cookie expiry in seconds since the Unix epoch.
    pub expires_at: i64,
}

/// A browser sign-in waiting for the server to redirect to its loopback
/// callback. `finish` resolves with the session token; `cancel` makes it
/// reject with "Sign-in was cancelled." and frees the callback port.
#[napi]
pub struct BrowserSignIn {
    authorize_url: String,
    server: Server,
    login: Mutex<Option<BrowserLogin>>,
    cancel: watch::Sender<bool>,
}

/// Opens the loopback callback listener for a sign-in to `server`.
#[napi]
pub async fn start_browser_sign_in(server: String) -> Result<BrowserSignIn> {
    let server = Server::new(&server).map_err(reject)?;
    let login = BrowserLogin::prepare(&server).await.map_err(reject)?;
    Ok(BrowserSignIn {
        authorize_url: login.authorize_url.to_string(),
        server,
        login: Mutex::new(Some(login)),
        cancel: watch::Sender::new(false),
    })
}

#[napi]
impl BrowserSignIn {
    #[napi(getter)]
    pub fn authorize_url(&self) -> String {
        self.authorize_url.clone()
    }

    #[napi]
    pub async fn finish(&self) -> Result<SessionToken> {
        let login = self
            .login
            .lock()
            .ok()
            .and_then(|mut login| login.take())
            .ok_or_else(|| reject(SIGN_IN_CANCELLED))?;
        let mut cancelled = self.cancel.subscribe();
        let token = tokio::select! {
            result = login.finish(&self.server) => result.map_err(reject)?,
            _ = cancelled.wait_for(|cancelled| *cancelled) => return Err(reject(SIGN_IN_CANCELLED)),
        };
        Ok(SessionToken {
            token: token.token().to_owned(),
            expires_at: token.cookie_expires_at(),
        })
    }

    #[napi]
    pub fn cancel(&self) {
        self.cancel.send_replace(true);
        if let Ok(mut login) = self.login.lock() {
            login.take();
        }
    }
}

#[napi(object)]
pub struct RuntimeFolders {
    pub data_dir: String,
    pub cache_dir: String,
    pub replay_scratch_dir: String,
    pub default_output_dir: String,
    pub native_root: String,
}

type EventCallback = ThreadsafeFunction<Value, UnknownReturnValue, Value, Status, false, true>;

/// The recorder, the capture library, and downloads. See
/// `alloy_desktop::runtime`.
#[napi]
pub struct Runtime {
    inner: Arc<DesktopRuntime>,
}

/// Opens the capture runtime. `onEvent` receives every event for the
/// selected server window, already shaped as a bridge `RecordingEvent`.
#[napi(ts_args_type = "folders: RuntimeFolders, onEvent: (event: unknown) => void")]
pub async fn create_runtime(folders: RuntimeFolders, on_event: EventCallback) -> Result<Runtime> {
    let on_event = Arc::new(on_event);
    let sink = Arc::new(move |event: Value| {
        on_event.call(event, ThreadsafeFunctionCallMode::NonBlocking);
    });
    let inner = DesktopRuntime::new(
        RuntimeOptions {
            data_dir: folders.data_dir.into(),
            cache_dir: folders.cache_dir.into(),
            replay_scratch_dir: folders.replay_scratch_dir.into(),
            default_output_dir: folders.default_output_dir.into(),
            native_root: folders.native_root.into(),
        },
        sink,
    )
    .await
    .map_err(reject)?;
    Ok(Runtime { inner })
}

#[napi]
impl Runtime {
    /// Sweeps leftovers, finalizes recovered captures, and starts the
    /// recorder, in the background.
    #[napi]
    pub fn start(&self) {
        let inner = Arc::clone(&self.inner);
        napi::bindgen_prelude::spawn(async move { inner.start().await });
    }

    /// Runs a `recording.*` bridge operation with the renderer's arguments.
    #[napi(ts_return_type = "Promise<unknown>")]
    pub async fn invoke(&self, operation: String, args_json: String) -> Result<Value> {
        let args = match parse_json(&args_json)? {
            Value::Array(args) => args,
            _ => return Err(reject("Invalid native argument.")),
        };
        self.inner.invoke(&operation, &args).await.map_err(reject)
    }

    #[napi]
    pub async fn select_server(&self, server: Option<String>) -> Result<()> {
        let server = server.as_deref().map(origin).transpose()?;
        self.inner.select_server(server).await.map_err(reject)
    }

    #[napi]
    pub async fn reveal_path(&self, id: String) -> Result<String> {
        let path = self.inner.reveal_path(id).await.map_err(reject)?;
        Ok(path.to_string_lossy().into_owned())
    }

    #[napi(ts_return_type = "Promise<unknown>")]
    pub async fn stage_import(&self, path: String) -> Result<Value> {
        self.inner.stage_import(path.into()).await.map_err(reject)
    }

    #[napi(ts_return_type = "Promise<unknown>")]
    pub async fn set_output_folder(&self, folder: String) -> Result<Value> {
        self.inner
            .set_output_folder(folder.into())
            .await
            .map_err(reject)
    }

    #[napi(ts_return_type = "Promise<unknown>")]
    pub async fn download_clip(
        &self,
        server: String,
        cookie: String,
        request_json: String,
    ) -> Result<Value> {
        let server = origin(&server)?;
        let request = parse_json(&request_json)?;
        self.inner
            .download_clip(server, cookie, request)
            .await
            .map_err(reject)
    }

    #[napi]
    pub fn notification_sounds_folder(&self, event: String) -> Result<String> {
        let folder = self
            .inner
            .notification_sounds_folder(&event)
            .map_err(reject)?;
        Ok(folder.to_string_lossy().into_owned())
    }

    /// Saves a clip (`"clip"`) or a screenshot (`"screenshot"`). Failures
    /// reach the server window as recording error events.
    #[napi]
    pub fn trigger(&self, action: String) -> Result<()> {
        let action =
            CaptureAction::parse(&action).ok_or_else(|| reject("Unknown capture action."))?;
        let inner = Arc::clone(&self.inner);
        napi::bindgen_prelude::within_runtime_if_available(move || inner.trigger(action));
        Ok(())
    }

    /// Asks the desktop to bind the clip and screenshot shortcuts, in the
    /// background: the desktop may show a dialog first. `app_id` names the
    /// app to the portal; the descriptions are shown in its dialog. Does
    /// nothing where the recorder hooks the keys itself.
    #[napi]
    pub fn start_shortcuts(&self, app_id: String, clip: String, screenshot: String) {
        let inner = Arc::clone(&self.inner);
        napi::bindgen_prelude::spawn(async move {
            inner
                .start_shortcuts(app_id, ShortcutDescriptions { clip, screenshot })
                .await;
        });
    }

    /// Stops the recorder and media work. Rejects if the recorder did not
    /// stop cleanly; the media work is stopped either way.
    #[napi]
    pub async fn shutdown(&self) -> Result<()> {
        self.inner.shutdown().await.map_err(reject)
    }

    /// Reopens the library and restarts the recorder after an update install
    /// failed once `shutdown` had run, selecting `server` again.
    #[napi]
    pub async fn resume_after_failed_update(&self, server: Option<String>) -> Result<()> {
        let server = server.as_deref().map(origin).transpose()?;
        self.inner
            .resume_after_failed_update(server)
            .await
            .map_err(reject)
    }
}
