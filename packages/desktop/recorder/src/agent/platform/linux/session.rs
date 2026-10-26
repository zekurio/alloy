//! The graphical session libobs renders against and display capture uses.

use std::env;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::agent) enum DisplaySession {
    Wayland,
    X11,
}

/// Wayland when the session offers it, X11 otherwise. A Wayland session also
/// sets `DISPLAY` for XWayland, so `WAYLAND_DISPLAY` decides first.
pub(in crate::agent) fn display_session() -> Option<DisplaySession> {
    let set = |name: &str| env::var_os(name).is_some_and(|value| !value.is_empty());
    if set("WAYLAND_DISPLAY") {
        Some(DisplaySession::Wayland)
    } else if set("DISPLAY") {
        Some(DisplaySession::X11)
    } else {
        None
    }
}
