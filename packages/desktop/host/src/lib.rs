//! The desktop host's native work: the recorder sidecar client, the capture
//! library, server checks and browser sign-in, saved preferences, and the
//! host log. The Electron main process loads it through the
//! `alloy-desktop-native` addon; nothing here knows about windows.

pub mod capture_library;
pub mod global_shortcuts;
pub mod logging;
pub mod login;
pub mod preferences;
pub mod recording_host;
pub mod runtime;
pub mod server;
pub mod update_signature;
