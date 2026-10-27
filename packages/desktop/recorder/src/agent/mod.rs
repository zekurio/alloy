//! Recorder process. The runtime owns the request loop and the recorder owns
//! capture state. Both platforms record through OBS: `obs` drives libobs and
//! `platform` discovers games, displays, GPUs and audio on Windows or Linux.

// Stdout carries the protocol, written only by `events`; on Linux fd 1 even
// points at stderr once it is claimed.
#![deny(clippy::print_stdout)]

mod events;
mod files;
mod game_matching;
mod notification_sounds;
mod obs;
mod platform;
mod quality;
mod recorder;
mod runtime;
mod time;
mod watchdog;

pub use runtime::run;
