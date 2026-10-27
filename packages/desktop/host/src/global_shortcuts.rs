//! The clip and screenshot shortcuts where the recorder has no key hook. On
//! Linux the desktop binds them through its GlobalShortcuts portal: the shell
//! registers its app id with the portal, binds both shortcuts in a session on
//! every start, and saves a capture when the portal reports one pressed. The
//! desktop asks the user only for shortcuts it hasn't seen and owns the keys
//! from then on; the saved hotkeys are just the triggers it suggests.
//! Windows hooks the keys in the recorder instead.

use std::sync::{
    Arc, Mutex, MutexGuard, PoisonError,
    atomic::{AtomicBool, Ordering},
};

use serde::Serialize;

/// The desktop has no GlobalShortcuts portal, or the platform doesn't bind
/// shortcuts through the desktop at all.
const UNAVAILABLE: &str = "Your desktop doesn't offer global shortcuts.";
#[cfg(target_os = "linux")]
const FAILED: &str = "Couldn't set up the shortcuts with your desktop.";
/// The portal knows no app id for us. Registering one only works when a
/// desktop entry of that name is installed, which packages ship and a
/// development run has to add.
#[cfg(target_os = "linux")]
const UNIDENTIFIED: &str = "Your desktop couldn't identify Alloy. It needs Alloy's desktop entry, dev.zekurio.alloy.desktop.";
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
    /// Set by `shutdown` and cleared by `resume`. The server window can still
    /// ask to bind again while the app quits or installs an update, and that
    /// must not open a session for a stopped runtime.
    stopped: AtomicBool,
    #[cfg(target_os = "linux")]
    session: tokio::sync::Mutex<Option<portal::Binding>>,
    /// Bumped by every bind and by shutdown. A bind still waiting on the
    /// desktop's dialog when it changes is stale, and drops its session.
    #[cfg(target_os = "linux")]
    generation: std::sync::atomic::AtomicU64,
    /// Held for a whole bind, so two sessions never listen at once and a
    /// press saves one capture. Shutdown and configure don't take it.
    #[cfg(target_os = "linux")]
    binds: tokio::sync::Mutex<()>,
    /// Wakes a bind waiting on the desktop's dialog once it is superseded.
    #[cfg(target_os = "linux")]
    superseded: tokio::sync::Notify,
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
                stopped: AtomicBool::new(false),
                #[cfg(target_os = "linux")]
                session: tokio::sync::Mutex::new(None),
                #[cfg(target_os = "linux")]
                generation: std::sync::atomic::AtomicU64::new(0),
                #[cfg(target_os = "linux")]
                binds: tokio::sync::Mutex::new(()),
                #[cfg(target_os = "linux")]
                superseded: tokio::sync::Notify::new(),
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
        if self.inner.stopped.load(Ordering::SeqCst) {
            return Ok(self.state());
        }
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
        Err(UNAVAILABLE.into())
    }

    /// Ends the session, so the desktop stops reporting the shortcuts. A
    /// bind still waiting on the desktop's dialog stops waiting and closes
    /// its session.
    pub async fn shutdown(&self) {
        // Before the generation moves, so a bind that starts after this sees
        // it under the bind lock.
        self.inner.stopped.store(true, Ordering::SeqCst);
        #[cfg(target_os = "linux")]
        {
            self.inner.generation.fetch_add(1, Ordering::SeqCst);
            self.inner.superseded.notify_waiters();
            let binding = self.inner.session.lock().await.take();
            if let Some(binding) = binding {
                binding.close().await;
            }
            // Until `resume`, no key is bound.
            self.inner.update(|state| {
                state.binding = false;
                state.shortcuts.clear();
                state.configurable = false;
            });
        }
    }

    /// Binds the shortcuts again after `shutdown`, in the background, for a
    /// runtime that keeps running: an update that failed to install.
    pub fn resume(&self) {
        self.inner.stopped.store(false, Ordering::SeqCst);
        #[cfg(target_os = "linux")]
        if let Some(request) = lock(&self.inner.request).clone() {
            let inner = Arc::clone(&self.inner);
            tokio::spawn(async move { portal::bind(&inner, request).await });
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
    use std::{
        sync::{Arc, atomic::Ordering},
        time::Duration,
    };

    use ashpd::{
        AppID, Error, PortalError,
        desktop::{
            ResponseError, Session,
            global_shortcuts::{ConfigureShortcutsOptions, GlobalShortcuts, NewShortcut, Shortcut},
        },
    };
    use futures_util::StreamExt;
    use tokio::{task::JoinHandle, time::timeout};

    use super::{
        BindRequest, BoundShortcut, CONFIGURE_FAILED, FAILED, Inner, NOT_BOUND, SESSION_ENDED,
        UNAVAILABLE, UNIDENTIFIED,
    };

    /// How long registering, opening a session and listening may take.
    const SETUP_TIMEOUT: Duration = Duration::from_secs(10);
    /// How long closing a session or opening the desktop's settings may
    /// take. Quitting waits on the close, so a stalled portal can't hold it.
    const CALL_TIMEOUT: Duration = Duration::from_secs(3);

    /// A bound session and the tasks following its signals.
    pub(super) struct Binding {
        /// Shared with `configure`, which calls it outside the session lock.
        proxy: Arc<GlobalShortcuts>,
        /// Shared with the task that watches for the session to end.
        session: Arc<Session<GlobalShortcuts>>,
        listeners: Vec<JoinHandle<()>>,
    }

    impl Binding {
        pub(super) async fn close(self) {
            for listener in &self.listeners {
                listener.abort();
            }
            // Best effort: the portal also ends it when the app exits.
            let _ = timeout(CALL_TIMEOUT, self.session.close()).await;
        }
    }

    pub(super) async fn bind(inner: &Arc<Inner>, request: BindRequest) {
        // A newer bind or a shutdown supersedes one still waiting on the
        // desktop's dialog: it stops waiting and closes its session, which
        // closes the dialog too.
        let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        inner.superseded.notify_waiters();
        // One bind at a time, so two sessions never listen at once and a
        // press saves one capture.
        let _bind = inner.binds.lock().await;
        if inner.generation.load(Ordering::SeqCst) != generation
            || inner.stopped.load(Ordering::SeqCst)
        {
            return;
        }
        let previous = inner.session.lock().await.take();
        if let Some(previous) = previous {
            previous.close().await;
        }
        inner.update(|state| {
            state.binding = true;
            state.error = None;
        });

        let binding = match prepare(inner, &request).await {
            Ok(binding) => binding,
            Err(message) => return fail(inner, generation, message),
        };
        // The dialog waits on the user, so it has no timeout.
        let asked = tokio::select! {
            asked = ask(&binding, &request) => asked,
            () = superseded(inner, generation) => {
                binding.close().await;
                return stand_down(inner);
            }
        };
        let shortcuts = match asked {
            Ok(shortcuts) => shortcuts,
            Err(message) => {
                binding.close().await;
                return fail(inner, generation, message);
            }
        };
        let mut session = inner.session.lock().await;
        if inner.generation.load(Ordering::SeqCst) != generation {
            drop(session);
            binding.close().await;
            return stand_down(inner);
        }
        let configurable = binding.proxy.version() >= 2;
        *session = Some(binding);
        // Published under the lock, so a shutdown's reset always comes after.
        inner.update(|state| {
            state.binding = false;
            state.shortcuts = shortcuts;
            state.configurable = configurable;
        });
        drop(session);
    }

    /// Reports why the bind failed, unless a newer bind or a shutdown has
    /// taken over, which this failure says nothing about.
    fn fail(inner: &Inner, generation: u64, message: &str) {
        if inner.generation.load(Ordering::SeqCst) != generation {
            return stand_down(inner);
        }
        inner.update(|state| {
            state.binding = false;
            state.shortcuts.clear();
            state.configurable = false;
            state.error = Some(message.into());
        });
    }

    /// Ends a superseded bind. It only clears `binding`, which it set and a
    /// shutdown may have cleared before it: a newer bind sets it again once
    /// it holds the bind lock, after this.
    fn stand_down(inner: &Inner) {
        inner.update(|state| state.binding = false);
    }

    /// Resolves once a newer bind or a shutdown has started.
    async fn superseded(inner: &Inner, generation: u64) {
        loop {
            let notified = inner.superseded.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if inner.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            notified.await;
        }
    }

    /// Registers the app, opens a session and starts listening: quick calls,
    /// each bounded, so a hung portal fails the bind and a session opened
    /// before the hang is still closed.
    async fn prepare(inner: &Arc<Inner>, request: &BindRequest) -> Result<Binding, &'static str> {
        // Portals scope shortcuts to an app id, and an app started from a
        // terminal has none. Registering fails harmlessly when the app is
        // already identified: by a launcher's scope, by a sandbox, or after a
        // rebind on the same connection. A portal from before the registry
        // rejects it too, and then only a launcher's scope identifies us.
        match AppID::try_from(request.app_id.as_str()) {
            Ok(app_id) => match timeout(SETUP_TIMEOUT, ashpd::register_host_app(app_id)).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => log::info!("global shortcuts: app id not registered: {error}"),
                Err(_) => log::info!("global shortcuts: app id registration timed out"),
            },
            Err(error) => log::warn!("global shortcuts: invalid app id: {error}"),
        }

        let proxy = bounded(GlobalShortcuts::new()).await?;
        let session = Arc::new(bounded(proxy.create_session(Default::default())).await?);
        // Signals are matched to the session by its path. Without it, a
        // press could reach an earlier session's listener too, so fail.
        let Some(own) = session_path(&session) else {
            log::warn!("global shortcuts: could not read the session path");
            let _ = timeout(CALL_TIMEOUT, session.close()).await;
            return Err(FAILED);
        };
        // Listening starts before binding, so no press is missed. Its tasks
        // only start once every subscription is in place.
        let listeners = match bounded(listen(inner, request, &proxy, &session, own)).await {
            Ok(listeners) => listeners,
            Err(message) => {
                let _ = timeout(CALL_TIMEOUT, session.close()).await;
                return Err(message);
            }
        };
        Ok(Binding {
            proxy: Arc::new(proxy),
            session,
            listeners,
        })
    }

    /// A setup call within `SETUP_TIMEOUT`, with its failure as the message
    /// the settings show.
    async fn bounded<T>(
        call: impl std::future::Future<Output = Result<T, Error>>,
    ) -> Result<T, &'static str> {
        match timeout(SETUP_TIMEOUT, call).await {
            Ok(result) => result.map_err(|error| failure(&error)),
            Err(_) => {
                log::warn!("global shortcuts: the portal did not answer");
                Err(FAILED)
            }
        }
    }

    /// Binds the shortcuts in the session. The desktop may show a dialog
    /// first.
    async fn ask(
        binding: &Binding,
        request: &BindRequest,
    ) -> Result<Vec<BoundShortcut>, &'static str> {
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
            Ok(bound) => Ok(bound_shortcuts(bound.shortcuts())),
            // Declined. KDE still keeps them without keys, so the user can
            // assign keys in its settings later.
            Err(Error::Response(ResponseError::Cancelled)) => Ok(Vec::new()),
            Err(error) => Err(failure(&error)),
        }
    }

    async fn listen(
        inner: &Arc<Inner>,
        request: &BindRequest,
        proxy: &GlobalShortcuts,
        session: &Arc<Session<GlobalShortcuts>>,
        own: String,
    ) -> Result<Vec<JoinHandle<()>>, Error> {
        let mut activated = proxy.receive_activated().await?;
        let mut changed = proxy.receive_shortcuts_changed().await?;

        // Signals arrive for every session on the connection, including an
        // earlier one the portal hasn't closed yet; only this one's count.
        let ours = move |path: &str| own == path;
        let on_activated = Arc::clone(&request.on_activated);
        let activations = tokio::spawn({
            let ours = ours.clone();
            async move {
                while let Some(activation) = activated.next().await {
                    if ours(activation.session_handle().as_str()) {
                        on_activated(activation.shortcut_id());
                    }
                }
            }
        });
        let weak = Arc::downgrade(inner);
        let changes = tokio::spawn(async move {
            while let Some(change) = changed.next().await {
                if !ours(change.session_handle().as_str()) {
                    continue;
                }
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
            if closed.next().await.is_none() {
                return;
            }
            let Some(inner) = weak.upgrade() else { return };
            // Only the current session's end counts; an earlier one is closed
            // by the bind that replaced it. The portal has already closed
            // this one, so it is dropped without closing it again.
            let mut current = inner.session.lock().await;
            if !current
                .as_ref()
                .is_some_and(|binding| Arc::ptr_eq(&binding.session, &session))
            {
                return;
            }
            if let Some(binding) = current.take() {
                // Includes this task, which has nothing left to await.
                for listener in &binding.listeners {
                    listener.abort();
                }
            }
            inner.update(|state| {
                state.shortcuts.clear();
                state.configurable = false;
                state.error = Some(SESSION_ENDED.into());
            });
        });
        Ok(vec![activations, changes, ends])
    }

    pub(super) async fn configure(inner: &Arc<Inner>) -> Result<(), String> {
        // The call runs outside the lock, so shutdown and binds don't wait
        // behind it.
        let (proxy, session) = {
            let session = inner.session.lock().await;
            let binding = session.as_ref().ok_or(NOT_BOUND)?;
            (Arc::clone(&binding.proxy), Arc::clone(&binding.session))
        };
        let configured = timeout(
            CALL_TIMEOUT,
            proxy.configure_shortcuts(&session, None, ConfigureShortcutsOptions::default()),
        )
        .await;
        match configured {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                log::warn!("global shortcuts: configure failed: {error}");
                Err(CONFIGURE_FAILED.into())
            }
            Err(_) => {
                log::warn!("global shortcuts: the portal did not open its settings");
                Err(CONFIGURE_FAILED.into())
            }
        }
    }

    /// The session's object path. ashpd keeps the accessor private, but a
    /// session serializes as its path, which is how it reaches the portal.
    fn session_path(session: &Session<GlobalShortcuts>) -> Option<String> {
        serde_json::to_value(session)
            .ok()?
            .as_str()
            .map(str::to_string)
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
