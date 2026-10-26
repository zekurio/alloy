//! Shadowed, rounded frame for the frameless server window on Wayland.
//!
//! Wayland leaves shadows and corners to the client. GTK 3 draws both as
//! client-side decorations once a window has a title bar widget and is
//! `decorated`. tao gives every undecorated Wayland window an empty title
//! bar so the compositor adds no decoration of its own; turning `decorated`
//! back on makes GTK draw its frame around that empty title bar: the shadow,
//! the resize borders, and the input shape that lets clicks through the
//! shadow. The frame needs an RGBA window, and the page rounds its own
//! corners to [`CORNER_RADIUS`] behind the bridge's `is-desktop-rounded`
//! flag, so the window is built transparent.
//!
//! GDK and GTK may only be used from the main thread, while server windows
//! are built from async commands on the Tokio pool, so [`init`] runs once in
//! `setup` and the window builder reads its result.

use std::sync::OnceLock;

use gtk::gdk::prelude::DisplayExtManual;
use gtk::prelude::*;
use tauri::WebviewWindow;

/// Corner radius in CSS pixels. `globals.css` rounds the page to match.
pub const CORNER_RADIUS: u32 = 12;

/// Set by [`init`]: whether GTK draws the frame.
static AVAILABLE: OnceLock<bool> = OnceLock::new();

/// Checks the GDK backend and installs the frame style. Call it once on the
/// main thread after GTK has started, before any server window is built.
pub fn init() {
    let wayland =
        gtk::gdk::Display::default().is_some_and(|display| display.backend().is_wayland());
    if wayland {
        install_style();
    }
    let _ = AVAILABLE.set(wayland);
}

/// Whether GTK can draw the frame. It draws client-side shadows on Wayland
/// only; an X11 session keeps the plain frameless window. Safe off the main
/// thread.
pub fn available() -> bool {
    AVAILABLE.get().copied().unwrap_or(false)
}

/// Turns on GTK's frame for a window built with `decorations(false)` and
/// `transparent(true)`. Tauri forwards the call to the main thread.
pub fn decorate(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_decorations(true)
        .map_err(|error| format!("GTK refused the window frame: {error}"))
}

/// Rounds all four corners of the frame. Themes round the top corners only,
/// for a title bar this window does not have, and flatten them while the
/// window is maximized, tiled, or fullscreen, which the page mirrors.
fn install_style() {
    let css = format!(
        "window.csd decoration {{ border-radius: {CORNER_RADIUS}px; }}\n\
         window.csd.maximized decoration, window.csd.fullscreen decoration,\n\
         window.csd.tiled decoration, window.csd.tiled-top decoration,\n\
         window.csd.tiled-right decoration, window.csd.tiled-bottom decoration,\n\
         window.csd.tiled-left decoration {{ border-radius: 0; }}\n"
    );
    let provider = gtk::CssProvider::new();
    if let Err(error) = provider.load_from_data(css.as_bytes()) {
        log::warn!("Could not load the window frame style: {error}");
        return;
    }
    let Some(screen) = gtk::gdk::Screen::default() else {
        log::warn!("Could not style the window frame: no GDK screen.");
        return;
    };
    gtk::StyleContext::add_provider_for_screen(
        &screen,
        &provider,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
}
