//! Windows recorder process. The runtime owns the request loop, the recorder
//! owns capture state, and OBS and platform modules provide their dependencies.

mod events;
mod notification_sounds;
mod obs;
mod platform;
mod recorder;
mod runtime;
mod time;
mod watchdog;

pub use runtime::run;
