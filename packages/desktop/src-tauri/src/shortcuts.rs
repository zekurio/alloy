//! Global shortcuts on Linux. Wayland gives no application the keys meant for
//! another, so the desktop environment delivers the clip and screenshot
//! shortcuts through the GlobalShortcuts portal. The hotkeys from the settings
//! are only suggested: the desktop environment owns the binding, and the user
//! changes it in the system settings. `alloy-desktop --action clip` and
//! `--action screenshot` trigger the same actions in the running app where the
//! portal is missing; with the app closed, they start it in the tray.

use std::sync::Arc;

use ashpd::{
    AppID,
    desktop::{
        CreateSessionOptions,
        global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut},
    },
    register_host_app,
};
use futures_util::StreamExt;

use crate::runtime::{CaptureAction, DesktopRuntime};

/// Binds the clip and screenshot shortcuts and triggers their actions. The
/// app's portal registration must be the first portal call on the session
/// bus connection, so this runs during setup, before any window can reveal a
/// file.
pub fn spawn(app_id: String, runtime: Arc<DesktopRuntime>) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = listen(&app_id, &runtime).await {
            log::warn!(
                "Global shortcuts are unavailable ({error}). Bind `alloy-desktop --action clip` \
                 and `alloy-desktop --action screenshot` in the desktop's shortcut settings instead."
            );
        }
    });
}

async fn listen(app_id: &str, runtime: &Arc<DesktopRuntime>) -> Result<(), String> {
    let app_id = AppID::try_from(app_id).map_err(|error| error.to_string())?;
    // The portal needs the app ID to bind shortcuts. Portals older than the
    // registry (xdg-desktop-portal 1.19) read it from the systemd scope the
    // desktop entry launched the app in, so the shortcuts may still work.
    if let Err(error) = register_host_app(app_id).await {
        log::warn!("Could not register with the desktop portals: {error}");
    }
    let portal = GlobalShortcuts::new()
        .await
        .map_err(|error| error.to_string())?;
    let session = portal
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(|error| error.to_string())?;
    let settings = runtime.recorder.get_settings().await;
    let clip = preferred_trigger(&settings.hotkeys.clip);
    let screenshot = preferred_trigger(&settings.hotkeys.screenshot);
    let shortcuts = [
        NewShortcut::new("clip", "Save a clip").preferred_trigger(clip.as_deref()),
        NewShortcut::new("screenshot", "Take a screenshot")
            .preferred_trigger(screenshot.as_deref()),
    ];
    // Subscribe first so no activation after the bind is missed.
    let mut activated = portal
        .receive_activated()
        .await
        .map_err(|error| error.to_string())?;
    let bound = portal
        .bind_shortcuts(&session, &shortcuts, None, BindShortcutsOptions::default())
        .await
        .and_then(|request| request.response())
        .map_err(|error| error.to_string())?;
    for shortcut in bound.shortcuts() {
        log::info!(
            "Global shortcut {} is bound to {}",
            shortcut.id(),
            shortcut.trigger_description()
        );
    }
    // The portal signals only the app that owns the session, and the app
    // opens one.
    while let Some(activation) = activated.next().await {
        if let Some(action) = CaptureAction::parse(activation.shortcut_id()) {
            runtime.trigger(action);
        }
    }
    Ok(())
}

/// Converts a hotkey from the settings, such as `Ctrl+Shift+F8`, to the
/// shortcut format of the XDG shortcuts specification: `CTRL+SHIFT+F8`.
fn preferred_trigger(hotkey: &str) -> Option<String> {
    let mut parts: Vec<_> = hotkey.split('+').map(str::trim).collect();
    let key = parts.pop().filter(|key| !key.is_empty())?;
    let mut trigger = parts
        .into_iter()
        .map(|modifier| match modifier {
            "Ctrl" => Some("CTRL"),
            "Alt" => Some("ALT"),
            "Shift" => Some("SHIFT"),
            "Meta" => Some("LOGO"),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?
        .join("+");
    if !trigger.is_empty() {
        trigger.push('+');
    }
    trigger.push_str(&keysym(key)?);
    Some(trigger)
}

/// The XKB keysym name for a key as the web app records it
/// (`KeyboardEvent.key`, letters upper-cased).
fn keysym(key: &str) -> Option<String> {
    let named = match key {
        "Space" => "space",
        "Enter" => "Return",
        "Backspace" => "BackSpace",
        "PrintScreen" => "Print",
        "ScrollLock" => "Scroll_Lock",
        "PageUp" => "Page_Up",
        "PageDown" => "Page_Down",
        "ArrowUp" => "Up",
        "ArrowDown" => "Down",
        "ArrowLeft" => "Left",
        "ArrowRight" => "Right",
        "Tab" | "Insert" | "Delete" | "Home" | "End" | "Pause" => key,
        _ => "",
    };
    if !named.is_empty() {
        return Some(named.to_string());
    }
    let mut chars = key.chars();
    match (chars.next(), chars.next()) {
        (Some(character), None) if character.is_ascii_alphanumeric() => {
            Some(character.to_ascii_lowercase().to_string())
        }
        _ if key.strip_prefix('F').is_some_and(|number| {
            number
                .parse::<u8>()
                .is_ok_and(|number| (1..=24).contains(&number))
        }) =>
        {
            Some(key.to_string())
        }
        _ => None,
    }
}
