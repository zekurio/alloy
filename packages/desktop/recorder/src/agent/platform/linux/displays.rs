//! Displays for display capture. On Wayland the screen-sharing dialog picks
//! the monitor, so a single entry stands for it, sized like the largest
//! connected monitor. On X11 the RandR monitors are listed in the order
//! OBS's screen capture numbers them.

use std::fs;

use super::session::{display_session, DisplaySession};
use crate::agent::platform::command_output;
use crate::types::{RecordingDisplay, VideoDimensions};

/// The display that stands for the screen-sharing dialog's choice.
pub(in crate::agent) const PORTAL_DISPLAY_ID: &str = "portal";
const X11_DISPLAY_PREFIX: &str = "x11:";
const FALLBACK_DIMENSIONS: VideoDimensions = VideoDimensions {
    width: 1920,
    height: 1080,
};

pub(in crate::agent) fn list_displays() -> Vec<RecordingDisplay> {
    match display_session() {
        Some(DisplaySession::Wayland) => {
            let dimensions = largest_connected_mode().unwrap_or(FALLBACK_DIMENSIONS);
            vec![RecordingDisplay {
                id: PORTAL_DISPLAY_ID.to_string(),
                name: "Chosen in the screen-sharing dialog".to_string(),
                width: dimensions.width,
                height: dimensions.height,
                primary: true,
                thumbnail_data_url: None,
            }]
        }
        Some(DisplaySession::X11) => x11_monitors()
            .into_iter()
            .map(|monitor| RecordingDisplay {
                id: format!("{X11_DISPLAY_PREFIX}{}", monitor.name),
                name: monitor.name,
                width: monitor.width,
                height: monitor.height,
                primary: monitor.primary,
                thumbnail_data_url: None,
            })
            .collect(),
        None => Vec::new(),
    }
}

/// The OBS X11 screen capture index for a selected display. Indexes shift
/// when monitors come and go, so displays are stored by name and resolved
/// here. A selection that no longer resolves, such as an unplugged monitor
/// or Wayland's `portal`, falls back to the primary monitor, then the first.
pub(in crate::agent) fn x11_screen_index(display_id: &str) -> Option<i64> {
    let monitors = x11_monitors();
    let name = display_id.strip_prefix(X11_DISPLAY_PREFIX);
    monitors
        .iter()
        .find(|monitor| Some(monitor.name.as_str()) == name)
        .or_else(|| monitors.iter().find(|monitor| monitor.primary))
        .or(monitors.first())
        .map(|monitor| monitor.index)
}

struct X11Monitor {
    index: i64,
    name: String,
    width: u32,
    height: u32,
    primary: bool,
}

/// RandR's active monitors, as `xrandr --listactivemonitors` prints them:
/// ` 0: +*DP-1 2560/597x1440/336+0+0  DP-1`. OBS's X11 screen capture
/// numbers its screens in the same order on RandR 1.5 servers.
fn x11_monitors() -> Vec<X11Monitor> {
    let Some(output) = command_output("xrandr", &["--listactivemonitors"]) else {
        return Vec::new();
    };
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let index = fields.next()?.strip_suffix(':')?.parse().ok()?;
            let flags = fields.next()?;
            let geometry = fields.next()?;
            let name = fields.next()?.to_string();
            let (width, rest) = geometry.split_once('/')?;
            let (_, rest) = rest.split_once('x')?;
            let (height, _) = rest.split_once('/')?;
            Some(X11Monitor {
                index,
                name,
                width: width.parse().ok()?,
                height: height.parse().ok()?,
                primary: flags.contains('*'),
            })
        })
        .collect()
}

/// The largest preferred mode among connected DRM connectors. Each
/// connector's `modes` file lists the preferred mode first.
fn largest_connected_mode() -> Option<VideoDimensions> {
    fs::read_dir("/sys/class/drm")
        .ok()?
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().contains('-'))
        .filter(|entry| {
            fs::read_to_string(entry.path().join("status"))
                .is_ok_and(|status| status.trim() == "connected")
        })
        .filter_map(|entry| {
            let modes = fs::read_to_string(entry.path().join("modes")).ok()?;
            let (width, height) = modes.lines().next()?.split_once('x')?;
            let height: String = height.chars().take_while(char::is_ascii_digit).collect();
            Some(VideoDimensions {
                width: width.parse().ok()?,
                height: height.parse().ok()?,
            })
        })
        .max_by_key(|dimensions| u64::from(dimensions.width) * u64::from(dimensions.height))
}
