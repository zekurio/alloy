//! The Alloy recorder.
//!
//! The capture pipeline runs on Windows and Linux. The pieces the desktop host
//! shares with it — the JSON wire types, the filename sanitizers and the
//! protocol constants — are platform-neutral so the host builds everywhere.
//! `settings` holds the agent's platform-free settings helpers.

pub mod names;
pub mod protocol;
pub mod settings;
pub mod types;

#[cfg(any(windows, target_os = "linux"))]
mod agent;

#[cfg(any(windows, target_os = "linux"))]
pub use agent::run;
