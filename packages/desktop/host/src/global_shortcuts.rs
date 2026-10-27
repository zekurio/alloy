//! The clip and screenshot shortcuts where the recorder has no key hook. On
//! Linux the desktop binds them through its GlobalShortcuts portal: the shell
//! registers its app id with the portal, binds both shortcuts in a session on
//! every start, and saves a capture when the portal reports one pressed. The
//! desktop asks the user only for shortcuts it hasn't seen and owns the keys
//! from then on; the saved hotkeys are just the triggers it suggests.
//! Windows hooks the keys in the recorder instead.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;

/// The desktop has no GlobalShortcuts portal.
#[cfg(target_os = "linux")]
const UNAVAILABLE: &str = "Your desktop doesn't offer global shortcuts.";
#[cfg(target_os = "linux")]
const FAILED: &str = "Couldn't set up the shortcuts with your desktop.";
/// The portal knows no app id for us: no launcher scope, and no registry.
#[cfg(target_os = "linux")]
const UNIDENTIFIED: &str =
    "Your desktop couldn't tell which app is asking. Start Alloy from its launcher.";
#[cfg(target_os = "linux")]
const SESSION_ENDED: &str = "Your desktop stopped the shortcuts. Set them up again.";
#[cfg(target_os = "linux")]
const CONFIGURE_FAILED: &str = "Couldn't open your desktop's shortcut settings.";
const NOT_BOUND: &str = "Set up the shortcuts first.";

/// One shortcut the shell asks the desktop to bind.
#[derive(Clone)]
pub struct ShortcutRequest {
    /// Stable across starts: the desktop keeps the user's keys by this id.
    pub id: &'static str,
    /// Shown in the desktop's dialog and settings.
    pub description: String,
    /// In the XDG shortcuts format; see [`xdg_trigger`].
    pub preferred_trigger: Option<String>,
}

/// Called with the id of a shortcut the user pressed.
pub type ActivationHandler = Arc<dyn Fn(&str) + Send + Sync>;
/// Called whenever [`ShortcutsState`] changes.
pub type StateHandler = Arc<dyn Fn(&ShortcutsState) + Send + Sync>;

/// What to bind, kept so the shortcuts can be bound again.
#[derive(Clone)]
pub struct BindRequest {
    pub app_id: String,
    pub shortcuts: Vec<ShortcutRequest>,
    pub on_activated: ActivationHandler,
    pub on_state: StateHandler,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsState {
    /// Whether this platform binds the shortcuts through the desktop.
    pub supported: bool,
    /// Set while the portal is asked, including while its dialog is open.
    pub binding: bool,
    /// The shortcuts the desktop bound, with how it says to trigger them.
    pub shortcuts: Vec<BoundShortcut>,
    /// Whether the desktop can show its own settings for the shortcuts.
    pub configurable: bool,
    /// Why the shortcuts couldn't be set up.
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundShortcut {
    pub id: String,
    /// The desktop's description of the keys; empty while none are assigned.
    pub trigger: String,
}

pub struct GlobalShortcuts {
    inner: Arc<Inner>,
}

struct Inner {
    state: Mutex<ShortcutsState>,
    request: Mutex<Option<BindRequest>>,
    #[cfg(target_os = "linux")]
    session: tokio::sync::Mutex<Option<portal::Binding>>,
}

impl Default for GlobalShortcuts {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobalShortcuts {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                state: Mutex::new(ShortcutsState {
                    supported: cfg!(target_os = "linux"),
                    ..ShortcutsState::default()
                }),
                request: Mutex::new(None),
                #[cfg(target_os = "linux")]
                session: tokio::sync::Mutex::new(None),
            }),
        }
    }

    pub fn state(&self) -> ShortcutsState {
        lock(&self.inner.state).clone()
    }

    /// Binds the shortcuts, replacing an earlier session. Waits for the
    /// desktop's dialog when it shows one.
    pub async fn bind(&self, request: BindRequest) -> ShortcutsState {
        *lock(&self.inner.request) = Some(request);
        self.rebind().await.unwrap_or_else(|_| self.state())
    }

    /// Binds the last requested shortcuts again in a new session.
    pub async fn rebind(&self) -> Result<ShortcutsState, String> {
        let request = lock(&self.inner.request).clone().ok_or(NOT_BOUND)?;
        #[cfg(target_os = "linux")]
        portal::bind(&self.inner, request).await;
        #[cfg(not(target_os = "linux"))]
        drop(request);
        Ok(self.state())
    }

    /// Opens the desktop's settings for the shortcuts.
    pub async fn configure(&self) -> Result<(), String> {
        #[cfg(target_os = "linux")]
        return portal::configure(&self.inner).await;
        #[cfg(not(target_os = "linux"))]
        Err(NOT_BOUND.into())
    }

    /// Ends the session, so the desktop stops reporting the shortcuts.
    pub async fn shutdown(&self) {
        #[cfg(target_os = "linux")]
        if let Some(binding) = self.inner.session.lock().await.take() {
            binding.close().await;
        }
    }
}

impl Inner {
    #[cfg(target_os = "linux")]
    fn update(&self, change: impl FnOnce(&mut ShortcutsState)) {
        let state = {
            let mut state = lock(&self.state);
            change(&mut state);
            state.clone()
        };
        if let Some(request) = lock(&self.request).as_ref() {
            (request.on_state)(&state);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A saved hotkey, such as `Ctrl+Shift+F8`, in the XDG shortcuts format the
/// portal takes, such as `CTRL+SHIFT+F8`: xkbcommon's modifier and keysym
/// names. `None` when the key has no plain keysym, so the desktop picks one.
pub fn xdg_trigger(hotkey: &str) -> Option<String> {
    let trimmed = hotkey.trim();
    let (modifiers, key) = match trimmed.strip_suffix('+') {
        // `Ctrl++` is Ctrl and the plus key.
        Some(rest) if rest.is_empty() || rest.ends_with('+') => (rest.trim_end_matches('+'), "+"),
        _ => trimmed.rsplit_once('+').unwrap_or(("", trimmed)),
    };
    let mut parts = Vec::new();
    for modifier in modifiers
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        parts.push(match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "CTRL",
            "alt" | "option" => "ALT",
            "shift" => "SHIFT",
            "meta" | "super" | "cmd" | "command" => "LOGO",
            _ => return None,
        });
    }
    let key = keysym(key.trim())?;
    Some(
        parts
            .into_iter()
            .chain([key.as_str()])
            .collect::<Vec<_>>()
            .join("+"),
    )
}

/// The xkbcommon keysym name for a key as the settings store it, the
/// browser's `KeyboardEvent.key`.
fn keysym(key: &str) -> Option<String> {
    let mut chars = key.chars();
    if let (Some(single), None) = (chars.next(), chars.next()) {
        if single.is_ascii_alphanumeric() {
            return Some(single.to_ascii_lowercase().to_string());
        }
        return Some(
            match single {
                '+' => "plus",
                '-' => "minus",
                '=' => "equal",
                ',' => "comma",
                '.' => "period",
                '/' => "slash",
                ';' => "semicolon",
                '\'' => "apostrophe",
                '[' => "bracketleft",
                ']' => "bracketright",
                '\\' => "backslash",
                '`' => "grave",
                _ => return None,
            }
            .to_string(),
        );
    }
    if let Some(number) = key
        .strip_prefix(['F', 'f'])
        .and_then(|number| number.parse::<u8>().ok())
        .filter(|number| (1..=24).contains(number))
    {
        return Some(format!("F{number}"));
    }
    Some(
        match key.to_ascii_lowercase().as_str() {
            "space" => "space",
            "enter" | "return" => "Return",
            "escape" | "esc" => "Escape",
            "tab" => "Tab",
            "backspace" => "BackSpace",
            "delete" => "Delete",
            "insert" => "Insert",
            "home" => "Home",
            "end" => "End",
            "pageup" => "Prior",
            "pagedown" => "Next",
            "arrowup" | "up" => "Up",
            "arrowdown" | "down" => "Down",
            "arrowleft" | "left" => "Left",
            "arrowright" | "right" => "Right",
            "printscreen" => "Print",
            "pause" => "Pause",
            _ => return None,
        }
        .to_string(),
    )
}

#[cfg(target_os = "linux")]
mod portal {
    use std::sync::Arc;

    use ashpd::{
        AppID, Error, PortalError,
        desktop::{
            ResponseError, Session,
            global_shortcuts::{ConfigureShortcutsOptions, GlobalShortcuts, NewShortcut, Shortcut},
        },
    };
    use futures_util::StreamExt;
    use tokio::task::JoinHandle;

    use super::{
        BindRequest, BoundShortcut, CONFIGURE_FAILED, FAILED, Inner, NOT_BOUND, SESSION_ENDED,
        UNAVAILABLE, UNIDENTIFIED,
    };

    /// A bound session and the tasks following its signals.
    pub(super) struct Binding {
        proxy: GlobalShortcuts,
        /// Shared with the task that watches for the session to end.
        session: Arc<Session<GlobalShortcuts>>,
        listeners: Vec<JoinHandle<()>>,
    }

    impl Binding {
        pub(super) async fn close(self) {
            for listener in &self.listeners {
                listener.abort();
            }
            let _ = self.session.close().await;
        }
    }

    pub(super) async fn bind(inner: &Arc<Inner>, request: BindRequest) {
        // One session at a time, so a pressed key saves one capture.
        let mut session = inner.session.lock().await;
        if let Some(previous) = session.take() {
            previous.close().await;
        }
        inner.update(|state| {
            state.binding = true;
            state.error = None;
        });
        match open(inner, &request).await {
            Ok((binding, shortcuts)) => {
                let configurable = binding.proxy.version() >= 2;
                *session = Some(binding);
                inner.update(|state| {
                    state.binding = false;
                    state.shortcuts = shortcuts;
                    state.configurable = configurable;
                });
            }
            Err(error) => {
                inner.update(|state| {
                    state.binding = false;
                    state.shortcuts.clear();
                    state.configurable = false;
                    state.error = Some(error.into());
                });
            }
        }
    }

    async fn open(
        inner: &Arc<Inner>,
        request: &BindRequest,
    ) -> Result<(Binding, Vec<BoundShortcut>), &'static str> {
        // Portals scope shortcuts to an app id, and an app started from a
        // terminal has none. Registering fails harmlessly when the app is
        // already identified: by a launcher's scope, by a sandbox, or after a
        // rebind on the same connection. A portal from before the registry
        // rejects it too, and then only a launcher's scope identifies us.
        match AppID::try_from(request.app_id.as_str()) {
            Ok(app_id) => {
                if let Err(error) = ashpd::register_host_app(app_id).await {
                    log::info!("global shortcuts: app id not registered: {error}");
                }
            }
            Err(error) => log::warn!("global shortcuts: invalid app id: {error}"),
        }

        let proxy = GlobalShortcuts::new()
            .await
            .map_err(|error| failure(&error))?;
        let session = Arc::new(
            proxy
                .create_session(Default::default())
                .await
                .map_err(|error| failure(&error))?,
        );
        // Listening starts before binding, so no press is missed.
        let listeners = listen(inner, request, &proxy, &session)
            .await
            .map_err(|error| failure(&error))?;
        let binding = Binding {
            proxy,
            session,
            listeners,
        };

        let shortcuts: Vec<NewShortcut> = request
            .shortcuts
            .iter()
            .map(|shortcut| {
                NewShortcut::new(shortcut.id, shortcut.description.as_str())
                    .preferred_trigger(shortcut.preferred_trigger.as_deref())
            })
            .collect();
        let response = binding
            .proxy
            .bind_shortcuts(&binding.session, &shortcuts, None, Default::default())
            .await
            .and_then(|request| request.response());
        match response {
            Ok(bound) => Ok((binding, bound_shortcuts(bound.shortcuts()))),
            // Declined. KDE still keeps them without keys, so the user can
            // assign keys in its settings later.
            Err(Error::Response(ResponseError::Cancelled)) => Ok((binding, Vec::new())),
            Err(error) => {
                let message = failure(&error);
                binding.close().await;
                Err(message)
            }
        }
    }

    async fn listen(
        inner: &Arc<Inner>,
        request: &BindRequest,
        proxy: &GlobalShortcuts,
        session: &Arc<Session<GlobalShortcuts>>,
    ) -> Result<Vec<JoinHandle<()>>, Error> {
        let mut activated = proxy.receive_activated().await?;
        let mut changed = proxy.receive_shortcuts_changed().await?;

        let on_activated = Arc::clone(&request.on_activated);
        let activations = tokio::spawn(async move {
            while let Some(activation) = activated.next().await {
                on_activated(activation.shortcut_id());
            }
        });
        let weak = Arc::downgrade(inner);
        let changes = tokio::spawn(async move {
            while let Some(change) = changed.next().await {
                let Some(inner) = weak.upgrade() else { return };
                let shortcuts = bound_shortcuts(change.shortcuts());
                inner.update(|state| state.shortcuts = shortcuts);
            }
        });
        // The portal ends the session when it restarts or the desktop
        // revokes it. Binding again needs the user, through the settings.
        // The stream borrows the session, so the task holds it too.
        let weak = Arc::downgrade(inner);
        let session = Arc::clone(session);
        let ends = tokio::spawn(async move {
            let Ok(mut closed) = session.receive_closed().await else {
                return;
            };
            if closed.next().await.is_some()
                && let Some(inner) = weak.upgrade()
            {
                inner.update(|state| {
                    state.shortcuts.clear();
                    state.configurable = false;
                    state.error = Some(SESSION_ENDED.into());
                });
            }
        });
        Ok(vec![activations, changes, ends])
    }

    pub(super) async fn configure(inner: &Arc<Inner>) -> Result<(), String> {
        let session = inner.session.lock().await;
        let binding = session.as_ref().ok_or(NOT_BOUND)?;
        binding
            .proxy
            .configure_shortcuts(&binding.session, None, ConfigureShortcutsOptions::default())
            .await
            .map_err(|error| {
                log::warn!("global shortcuts: configure failed: {error}");
                CONFIGURE_FAILED.to_string()
            })
    }

    fn bound_shortcuts(shortcuts: &[Shortcut]) -> Vec<BoundShortcut> {
        shortcuts
            .iter()
            .map(|shortcut| BoundShortcut {
                id: shortcut.id().to_string(),
                trigger: shortcut.trigger_description().to_string(),
            })
            .collect()
    }

    fn failure(error: &Error) -> &'static str {
        log::warn!("global shortcuts: {error}");
        match error {
            Error::PortalNotFound(_) => UNAVAILABLE,
            Error::Portal(PortalError::NotAllowed(_)) => UNIDENTIFIED,
            Error::Portal(PortalError::ZBus(error)) | Error::Zbus(error) if missing(error) => {
                UNAVAILABLE
            }
            _ => FAILED,
        }
    }

    /// No portal service, or one without a GlobalShortcuts backend.
    fn missing(error: &ashpd::zbus::Error) -> bool {
        matches!(
            error,
            ashpd::zbus::Error::MethodError(name, ..) if matches!(
                name.as_str(),
                "org.freedesktop.DBus.Error.ServiceUnknown"
                    | "org.freedesktop.DBus.Error.UnknownInterface"
                    | "org.freedesktop.DBus.Error.UnknownMethod"
                    | "org.freedesktop.DBus.Error.UnknownObject"
            )
        )
    }
}
