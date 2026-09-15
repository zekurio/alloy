//! The Alloy recorder.
//!
//! The capture pipeline is Windows-only, but the pieces the desktop host shares
//! with it — the JSON wire types, the settings helpers, the filename sanitizers
//! and the protocol constants — are platform-neutral so the host still builds
//! (and tests) on macOS and Linux.

pub mod names;
pub mod protocol;
pub mod settings;
pub mod types;

#[cfg(windows)]
mod agent;

#[cfg(windows)]
pub use agent::run;
