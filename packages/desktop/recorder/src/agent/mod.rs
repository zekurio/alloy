//! Recorder process. The runtime owns the request loop and the recorder owns
//! capture state. Windows records through OBS, with the `obs` and `platform`
//! modules providing its dependencies; Linux records through
//! gpu-screen-recorder in `linux`.

mod events;
mod game_matching;
#[cfg(target_os = "linux")]
mod linux;
mod notification_sounds;
#[cfg(windows)]
mod obs;
#[cfg(windows)]
mod platform;
mod quality;
#[cfg(windows)]
mod recorder;
mod runtime;
mod time;
mod watchdog;

pub use runtime::run;
