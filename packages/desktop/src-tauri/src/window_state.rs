//! Remembered window geometry: restored when a window opens, saved shortly
//! after it is resized and once more before the app exits.

use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use alloy_desktop::policy::CONNECT_WINDOW_LABEL;
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

use crate::{host::Host, preferences::DesktopWindowState, services::DesktopServices};

/// Window size used until the user has resized a window once.
const DEFAULT_WINDOW_STATE: DesktopWindowState = DesktopWindowState {
    width: 1280,
    height: 800,
    maximized: false,
};
/// How long after the last resize event the window size is persisted, so
/// dragging a window edge does not rewrite the preferences file every frame.
const WINDOW_STATE_SAVE_DELAY: Duration = Duration::from_millis(400);

/// The size a new window opens with: the last saved size, clamped to the
/// primary monitor so a window saved on a larger display still opens fully
/// on screen.
pub fn restored_window_state(app: &AppHandle, services: &DesktopServices) -> DesktopWindowState {
    let saved = services
        .preferences
        .get_window_state()
        .unwrap_or(DEFAULT_WINDOW_STATE);
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
    let previous = services
        .preferences
        .get_window_state()
        .unwrap_or(DEFAULT_WINDOW_STATE);
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
    if let Err(error) = services.preferences.remember_window_state(state) {
        log::warn!("Could not save the window size: {error}");
    }
}

/// Saves the geometry of every window still alive, so quitting right after a
/// resize does not lose it.
pub fn flush_window_state(app: &AppHandle, host: &Host) {
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
/// dragging. `revisions` belongs to one window and is bumped on each of its
/// resizes, so only the last save of that window's burst runs.
fn queue_window_state_save(
    window: WebviewWindow,
    services: Arc<DesktopServices>,
    revisions: Arc<AtomicU64>,
) {
    let revision = revisions.fetch_add(1, Ordering::Relaxed) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WINDOW_STATE_SAVE_DELAY).await;
        if revisions.load(Ordering::Relaxed) != revision {
            return;
        }
        // The save reads and fsyncs the preferences file.
        tauri::async_runtime::spawn_blocking(move || save_window_state(&window, &services));
    });
}

pub fn track_window_state(window: &WebviewWindow, services: Arc<DesktopServices>) {
    let tracked = window.clone();
    let revisions = Arc::new(AtomicU64::new(0));
    window.clone().on_window_event(move |event| {
        if matches!(event, WindowEvent::Resized(_)) {
            queue_window_state_save(
                tracked.clone(),
                Arc::clone(&services),
                Arc::clone(&revisions),
            );
        }
    });
}
