//! Audio devices, applications and level meters through the PulseAudio API,
//! which PipeWire serves through pipewire-pulse. libpulse is loaded at run
//! time like libobs: from the OBS runtime's `lib` folder first, where the Nix
//! runtime links it, then from the system.
//!
//! Device ids are PulseAudio source names, the ones OBS's PulseAudio capture
//! takes: a sink's monitor source for an output, the source itself for an
//! input. Applications are playback streams, identified for PipeWire's
//! application audio capture by binary or, for Wine, by application name.

use std::{
    collections::HashMap,
    env,
    ffi::{c_char, c_int, c_void, CStr},
    mem::offset_of,
    path::PathBuf,
    ptr,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex, MutexGuard, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use libloading::Library;

use super::games::unwrapped_executable;
use crate::agent::{
    events::emit_event,
    game_matching::{user_facing_process_name, ProcessDisplayName},
    obs::load_symbol,
    platform::audio_application_id_from_parts,
};
use crate::protocol::SIDE_CAR_NAME;
use crate::types::{
    RecordingAudioApplicationSelection, RecordingAudioDevice, RecordingAudioDeviceKind,
    RecordingAudioLevel, RecordingAudioLevelTarget, RecordingEvent,
};

const AUDIO_LEVEL_SUBSCRIPTION_TTL: Duration = Duration::from_secs(10);
const AUDIO_LEVEL_POLL_INTERVAL: Duration = Duration::from_millis(100);
const AUDIO_LEVEL_REFRESH_INTERVAL: Duration = Duration::from_secs(2);
/// Peak samples per second each meter stream delivers.
const AUDIO_LEVEL_RATE: u32 = 25;

const PA_INVALID_INDEX: u32 = u32::MAX;
const PA_CONTEXT_NOAUTOSPAWN: c_int = 1;
const PA_CONTEXT_READY: c_int = 4;
const PA_CONTEXT_FAILED: c_int = 5;
const PA_CONTEXT_TERMINATED: c_int = 6;
const PA_OPERATION_RUNNING: c_int = 0;
const PA_SAMPLE_FLOAT32NE: c_int = 5;
const PA_STREAM_DONT_MOVE: c_int = 512;
const PA_STREAM_PEAK_DETECT: c_int = 2048;
const PA_STREAM_ADJUST_LATENCY: c_int = 8192;
const PA_STREAM_DONT_INHIBIT_AUTO_SUSPEND: c_int = 32768;

type Mainloop = c_void;
type MainloopApi = c_void;
type Context = c_void;
type Operation = c_void;
type Stream = c_void;
type Proplist = c_void;

#[allow(dead_code)]
#[repr(C)]
struct SampleSpec {
    format: c_int,
    rate: u32,
    channels: u8,
}

#[allow(dead_code)]
#[repr(C)]
struct ChannelMap {
    channels: u8,
    map: [c_int; 32],
}

#[allow(dead_code)]
#[repr(C)]
struct ChannelVolume {
    channels: u8,
    values: [u32; 32],
}

#[repr(C)]
struct BufferAttr {
    maxlength: u32,
    tlength: u32,
    prebuf: u32,
    minreq: u32,
    fragsize: u32,
}

/// The leading fields of `pa_sink_info`, up to the last one read.
#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct SinkInfo {
    name: *const c_char,
    index: u32,
    description: *const c_char,
    sample_spec: SampleSpec,
    channel_map: ChannelMap,
    owner_module: u32,
    volume: ChannelVolume,
    mute: c_int,
    monitor_source: u32,
    monitor_source_name: *const c_char,
}

/// The leading fields of `pa_source_info`, up to the last one read.
#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct SourceInfo {
    name: *const c_char,
    index: u32,
    description: *const c_char,
    sample_spec: SampleSpec,
    channel_map: ChannelMap,
    owner_module: u32,
    volume: ChannelVolume,
    mute: c_int,
    monitor_of_sink: u32,
}

/// The leading fields of `pa_sink_input_info`, up to the last one read.
#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct SinkInputInfo {
    index: u32,
    name: *const c_char,
    owner_module: u32,
    client: u32,
    sink: u32,
    sample_spec: SampleSpec,
    channel_map: ChannelMap,
    volume: ChannelVolume,
    buffer_usec: u64,
    sink_usec: u64,
    resample_method: *const c_char,
    driver: *const c_char,
    mute: c_int,
    proplist: *mut Proplist,
}

/// The leading fields of `pa_server_info`, up to the last one read.
#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct ServerInfo {
    user_name: *const c_char,
    host_name: *const c_char,
    server_version: *const c_char,
    server_name: *const c_char,
    sample_spec: SampleSpec,
    default_sink_name: *const c_char,
    default_source_name: *const c_char,
}

// Offsets from libpulse 17's headers on x86_64; the ABI has been stable since
// 1.0. A mismatch here fails the build instead of misreading memory.
const _: () = {
    assert!(size_of::<SampleSpec>() == 12);
    assert!(size_of::<ChannelMap>() == 132);
    assert!(size_of::<ChannelVolume>() == 132);
    assert!(size_of::<BufferAttr>() == 20);
    assert!(offset_of!(SinkInfo, owner_module) == 168);
    assert!(offset_of!(SinkInfo, mute) == 304);
    assert!(offset_of!(SinkInfo, monitor_source_name) == 312);
    assert!(offset_of!(SourceInfo, monitor_of_sink) == 308);
    assert!(offset_of!(SinkInputInfo, sink) == 24);
    assert!(offset_of!(SinkInputInfo, buffer_usec) == 304);
    assert!(offset_of!(SinkInputInfo, proplist) == 344);
    assert!(offset_of!(ServerInfo, sample_spec) == 32);
    assert!(offset_of!(ServerInfo, default_source_name) == 56);
};

type StateCallback = unsafe extern "C" fn(*mut Context, *mut c_void);
type SinkInfoCallback = unsafe extern "C" fn(*mut Context, *const SinkInfo, c_int, *mut c_void);
type SourceInfoCallback = unsafe extern "C" fn(*mut Context, *const SourceInfo, c_int, *mut c_void);
type SinkInputInfoCallback =
    unsafe extern "C" fn(*mut Context, *const SinkInputInfo, c_int, *mut c_void);
type ServerInfoCallback = unsafe extern "C" fn(*mut Context, *const ServerInfo, *mut c_void);
type StreamRequestCallback = unsafe extern "C" fn(*mut Stream, usize, *mut c_void);

struct Pulse {
    mainloop_new: unsafe extern "C" fn() -> *mut Mainloop,
    mainloop_free: unsafe extern "C" fn(*mut Mainloop),
    mainloop_start: unsafe extern "C" fn(*mut Mainloop) -> c_int,
    mainloop_stop: unsafe extern "C" fn(*mut Mainloop),
    mainloop_lock: unsafe extern "C" fn(*mut Mainloop),
    mainloop_unlock: unsafe extern "C" fn(*mut Mainloop),
    mainloop_wait: unsafe extern "C" fn(*mut Mainloop),
    mainloop_signal: unsafe extern "C" fn(*mut Mainloop, c_int),
    mainloop_get_api: unsafe extern "C" fn(*mut Mainloop) -> *mut MainloopApi,
    context_new: unsafe extern "C" fn(*mut MainloopApi, *const c_char) -> *mut Context,
    context_unref: unsafe extern "C" fn(*mut Context),
    context_connect:
        unsafe extern "C" fn(*mut Context, *const c_char, c_int, *const c_void) -> c_int,
    context_disconnect: unsafe extern "C" fn(*mut Context),
    context_get_state: unsafe extern "C" fn(*mut Context) -> c_int,
    context_set_state_callback:
        unsafe extern "C" fn(*mut Context, Option<StateCallback>, *mut c_void),
    context_get_server_info:
        unsafe extern "C" fn(*mut Context, ServerInfoCallback, *mut c_void) -> *mut Operation,
    context_get_sink_info_list:
        unsafe extern "C" fn(*mut Context, SinkInfoCallback, *mut c_void) -> *mut Operation,
    context_get_source_info_list:
        unsafe extern "C" fn(*mut Context, SourceInfoCallback, *mut c_void) -> *mut Operation,
    context_get_sink_input_info_list:
        unsafe extern "C" fn(*mut Context, SinkInputInfoCallback, *mut c_void) -> *mut Operation,
    operation_get_state: unsafe extern "C" fn(*mut Operation) -> c_int,
    operation_unref: unsafe extern "C" fn(*mut Operation),
    proplist_gets: unsafe extern "C" fn(*mut Proplist, *const c_char) -> *const c_char,
    stream_new: unsafe extern "C" fn(
        *mut Context,
        *const c_char,
        *const SampleSpec,
        *const ChannelMap,
    ) -> *mut Stream,
    stream_set_read_callback:
        unsafe extern "C" fn(*mut Stream, Option<StreamRequestCallback>, *mut c_void),
    stream_set_monitor_stream: unsafe extern "C" fn(*mut Stream, u32) -> c_int,
    stream_connect_record:
        unsafe extern "C" fn(*mut Stream, *const c_char, *const BufferAttr, c_int) -> c_int,
    stream_peek: unsafe extern "C" fn(*mut Stream, *mut *const c_void, *mut usize) -> c_int,
    stream_drop: unsafe extern "C" fn(*mut Stream) -> c_int,
    stream_disconnect: unsafe extern "C" fn(*mut Stream) -> c_int,
    stream_unref: unsafe extern "C" fn(*mut Stream),
    // Keeps the function pointers above valid.
    _library: Library,
}

static PULSE: OnceLock<Option<Pulse>> = OnceLock::new();

fn pulse() -> Option<&'static Pulse> {
    PULSE.get_or_init(load_pulse).as_ref()
}

fn load_pulse() -> Option<Pulse> {
    let mut candidates: Vec<PathBuf> = env::var_os("ALLOY_OBS_RUNTIME_DIR")
        .map(|runtime| PathBuf::from(runtime).join("lib/libpulse.so.0"))
        .into_iter()
        .collect();
    candidates.push(PathBuf::from("libpulse.so.0"));
    let mut errors = Vec::new();
    for candidate in candidates {
        // SAFETY: libpulse runs no initialization with preconditions on load.
        match unsafe { Library::new(&candidate) }.map_err(|error| error.to_string()) {
            Ok(library) => match unsafe { Pulse::from_library(library) } {
                Ok(pulse) => return Some(pulse),
                Err(error) => errors.push(format!("{}: {error}", candidate.display())),
            },
            Err(error) => errors.push(format!("{}: {error}", candidate.display())),
        }
    }
    eprintln!(
        "[{SIDE_CAR_NAME}] PulseAudio client unavailable, audio discovery falls back to OBS: {}",
        errors.join("; ")
    );
    None
}

impl Pulse {
    unsafe fn from_library(library: Library) -> Result<Self, String> {
        Ok(Self {
            mainloop_new: load_symbol(&library, b"pa_threaded_mainloop_new\0")?,
            mainloop_free: load_symbol(&library, b"pa_threaded_mainloop_free\0")?,
            mainloop_start: load_symbol(&library, b"pa_threaded_mainloop_start\0")?,
            mainloop_stop: load_symbol(&library, b"pa_threaded_mainloop_stop\0")?,
            mainloop_lock: load_symbol(&library, b"pa_threaded_mainloop_lock\0")?,
            mainloop_unlock: load_symbol(&library, b"pa_threaded_mainloop_unlock\0")?,
            mainloop_wait: load_symbol(&library, b"pa_threaded_mainloop_wait\0")?,
            mainloop_signal: load_symbol(&library, b"pa_threaded_mainloop_signal\0")?,
            mainloop_get_api: load_symbol(&library, b"pa_threaded_mainloop_get_api\0")?,
            context_new: load_symbol(&library, b"pa_context_new\0")?,
            context_unref: load_symbol(&library, b"pa_context_unref\0")?,
            context_connect: load_symbol(&library, b"pa_context_connect\0")?,
            context_disconnect: load_symbol(&library, b"pa_context_disconnect\0")?,
            context_get_state: load_symbol(&library, b"pa_context_get_state\0")?,
            context_set_state_callback: load_symbol(&library, b"pa_context_set_state_callback\0")?,
            context_get_server_info: load_symbol(&library, b"pa_context_get_server_info\0")?,
            context_get_sink_info_list: load_symbol(&library, b"pa_context_get_sink_info_list\0")?,
            context_get_source_info_list: load_symbol(
                &library,
                b"pa_context_get_source_info_list\0",
            )?,
            context_get_sink_input_info_list: load_symbol(
                &library,
                b"pa_context_get_sink_input_info_list\0",
            )?,
            operation_get_state: load_symbol(&library, b"pa_operation_get_state\0")?,
            operation_unref: load_symbol(&library, b"pa_operation_unref\0")?,
            proplist_gets: load_symbol(&library, b"pa_proplist_gets\0")?,
            stream_new: load_symbol(&library, b"pa_stream_new\0")?,
            stream_set_read_callback: load_symbol(&library, b"pa_stream_set_read_callback\0")?,
            stream_set_monitor_stream: load_symbol(&library, b"pa_stream_set_monitor_stream\0")?,
            stream_connect_record: load_symbol(&library, b"pa_stream_connect_record\0")?,
            stream_peek: load_symbol(&library, b"pa_stream_peek\0")?,
            stream_drop: load_symbol(&library, b"pa_stream_drop\0")?,
            stream_disconnect: load_symbol(&library, b"pa_stream_disconnect\0")?,
            stream_unref: load_symbol(&library, b"pa_stream_unref\0")?,
            _library: library,
        })
    }
}

/// A connected client on its own threaded main loop. Every libpulse call
/// that touches the context or a stream runs with the main loop locked.
struct Client {
    pulse: &'static Pulse,
    mainloop: *mut Mainloop,
    context: *mut Context,
}

impl Client {
    fn connect() -> Result<Self, String> {
        let pulse = pulse().ok_or("The PulseAudio client library is not available.")?;
        // SAFETY: each call follows libpulse's threaded main loop protocol;
        // the client owns the main loop and context until it drops.
        unsafe {
            let mainloop = (pulse.mainloop_new)();
            if mainloop.is_null() {
                return Err("Could not create a PulseAudio main loop.".into());
            }
            let context =
                (pulse.context_new)((pulse.mainloop_get_api)(mainloop), c"Alloy".as_ptr());
            if context.is_null() {
                (pulse.mainloop_free)(mainloop);
                return Err("Could not create a PulseAudio context.".into());
            }
            let client = Self {
                pulse,
                mainloop,
                context,
            };
            (pulse.context_set_state_callback)(context, Some(signal_state), mainloop);
            if (pulse.context_connect)(context, ptr::null(), PA_CONTEXT_NOAUTOSPAWN, ptr::null())
                < 0
            {
                return Err("Could not connect to the PulseAudio server.".into());
            }
            if (pulse.mainloop_start)(mainloop) < 0 {
                return Err("Could not start the PulseAudio main loop.".into());
            }
            let _lock = client.lock();
            loop {
                match (pulse.context_get_state)(context) {
                    PA_CONTEXT_READY => break,
                    PA_CONTEXT_FAILED | PA_CONTEXT_TERMINATED => {
                        return Err("The PulseAudio server refused the connection.".into());
                    }
                    _ => (pulse.mainloop_wait)(mainloop),
                }
            }
            drop(_lock);
            Ok(client)
        }
    }

    fn lock(&self) -> MainloopLock<'_> {
        // SAFETY: the main loop lives as long as the client.
        unsafe { (self.pulse.mainloop_lock)(self.mainloop) };
        MainloopLock(self)
    }

    /// Runs one introspection request and waits for its last callback.
    /// The callbacks signal the main loop at the end of the list; a context
    /// failure signals through the state callback and cancels the request.
    ///
    /// # Safety
    ///
    /// `start` must issue a request whose callback stores into `request` and
    /// signals `request.mainloop` once done.
    unsafe fn run<T>(
        &self,
        request: &mut Request<T>,
        start: impl FnOnce(*mut Context, *mut c_void) -> *mut Operation,
    ) -> Result<(), String> {
        let _lock = self.lock();
        let operation = start(self.context, (request as *mut Request<T>).cast());
        if operation.is_null() {
            return Err("PulseAudio rejected an introspection request.".into());
        }
        while (self.pulse.operation_get_state)(operation) == PA_OPERATION_RUNNING {
            (self.pulse.mainloop_wait)(self.mainloop);
        }
        (self.pulse.operation_unref)(operation);
        Ok(())
    }

    fn inventory(&self) -> Result<Inventory, String> {
        let mut server = Request::<(Option<String>, Option<String>)>::new(self.mainloop);
        let mut sinks = Request::<SinkEntry>::new(self.mainloop);
        let mut sources = Request::<SourceEntry>::new(self.mainloop);
        let mut inputs = Request::<SinkInputEntry>::new(self.mainloop);
        // SAFETY: each callback matches its request's item type.
        unsafe {
            self.run(&mut server, |context, data| {
                (self.pulse.context_get_server_info)(context, collect_server, data)
            })?;
            self.run(&mut sinks, |context, data| {
                (self.pulse.context_get_sink_info_list)(context, collect_sink, data)
            })?;
            self.run(&mut sources, |context, data| {
                (self.pulse.context_get_source_info_list)(context, collect_source, data)
            })?;
            self.run(&mut inputs, |context, data| {
                (self.pulse.context_get_sink_input_info_list)(context, collect_sink_input, data)
            })?;
        }
        let (default_sink, default_source) = server.items.pop().unwrap_or_default();
        Ok(Inventory {
            default_output: default_sink.and_then(|name| {
                sinks
                    .items
                    .iter()
                    .find(|sink| sink.name == name)
                    .map(|sink| sink.monitor_source_name.clone())
            }),
            default_input: default_source,
            sinks: sinks.items,
            sources: sources.items,
            inputs: inputs.items,
        })
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // SAFETY: stopping the main loop joins its thread, so no callback runs
        // once the context and loop are freed.
        unsafe {
            {
                let _lock = self.lock();
                (self.pulse.context_set_state_callback)(self.context, None, ptr::null_mut());
                (self.pulse.context_disconnect)(self.context);
            }
            (self.pulse.mainloop_stop)(self.mainloop);
            (self.pulse.context_unref)(self.context);
            (self.pulse.mainloop_free)(self.mainloop);
        }
    }
}

struct MainloopLock<'a>(&'a Client);

impl Drop for MainloopLock<'_> {
    fn drop(&mut self) {
        // SAFETY: paired with the lock taken in `Client::lock`.
        unsafe { (self.0.pulse.mainloop_unlock)(self.0.mainloop) };
    }
}

struct Request<T> {
    mainloop: *mut Mainloop,
    items: Vec<T>,
}

impl<T> Request<T> {
    fn new(mainloop: *mut Mainloop) -> Self {
        Self {
            mainloop,
            items: Vec::new(),
        }
    }
}

struct SinkEntry {
    index: u32,
    name: String,
    description: String,
    monitor_source_name: String,
}

struct SourceEntry {
    name: String,
    description: String,
    monitor_of_sink: u32,
}

struct SinkInputEntry {
    index: u32,
    sink: u32,
    binary: Option<String>,
    application_name: Option<String>,
    process_id: Option<u32>,
}

struct Inventory {
    default_output: Option<String>,
    default_input: Option<String>,
    sinks: Vec<SinkEntry>,
    sources: Vec<SourceEntry>,
    inputs: Vec<SinkInputEntry>,
}

impl Inventory {
    fn devices(&self) -> Vec<RecordingAudioDevice> {
        let outputs = self.sinks.iter().map(|sink| RecordingAudioDevice {
            id: sink.monitor_source_name.clone(),
            label: sink.description.clone(),
            kind: RecordingAudioDeviceKind::Output,
        });
        let inputs = self
            .sources
            .iter()
            .filter(|source| source.monitor_of_sink == PA_INVALID_INDEX)
            .map(|source| RecordingAudioDevice {
                id: source.name.clone(),
                label: source.description.clone(),
                kind: RecordingAudioDeviceKind::Input,
            });
        outputs.chain(inputs).collect()
    }
}

unsafe fn owned_string(value: *const c_char) -> Option<String> {
    (!value.is_null())
        .then(|| CStr::from_ptr(value).to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
}

unsafe fn property(pulse: &Pulse, proplist: *mut Proplist, key: &CStr) -> Option<String> {
    if proplist.is_null() {
        return None;
    }
    owned_string((pulse.proplist_gets)(proplist, key.as_ptr()))
}

unsafe extern "C" fn signal_state(_context: *mut Context, mainloop: *mut c_void) {
    if let Some(pulse) = pulse() {
        (pulse.mainloop_signal)(mainloop, 0);
    }
}

unsafe fn finish_list<T>(request: &mut Request<T>) {
    if let Some(pulse) = pulse() {
        (pulse.mainloop_signal)(request.mainloop, 0);
    }
}

unsafe extern "C" fn collect_server(
    _context: *mut Context,
    info: *const ServerInfo,
    data: *mut c_void,
) {
    let request = &mut *data.cast::<Request<(Option<String>, Option<String>)>>();
    if let Some(info) = info.as_ref() {
        request.items.push((
            owned_string(info.default_sink_name),
            owned_string(info.default_source_name),
        ));
    }
    finish_list(request);
}

unsafe extern "C" fn collect_sink(
    _context: *mut Context,
    info: *const SinkInfo,
    end: c_int,
    data: *mut c_void,
) {
    let request = &mut *data.cast::<Request<SinkEntry>>();
    let Some(info) = info.as_ref().filter(|_| end == 0) else {
        finish_list(request);
        return;
    };
    if let (Some(name), Some(monitor_source_name)) = (
        owned_string(info.name),
        owned_string(info.monitor_source_name),
    ) {
        request.items.push(SinkEntry {
            index: info.index,
            description: owned_string(info.description).unwrap_or_else(|| name.clone()),
            name,
            monitor_source_name,
        });
    }
}

unsafe extern "C" fn collect_source(
    _context: *mut Context,
    info: *const SourceInfo,
    end: c_int,
    data: *mut c_void,
) {
    let request = &mut *data.cast::<Request<SourceEntry>>();
    let Some(info) = info.as_ref().filter(|_| end == 0) else {
        finish_list(request);
        return;
    };
    if let Some(name) = owned_string(info.name) {
        request.items.push(SourceEntry {
            description: owned_string(info.description).unwrap_or_else(|| name.clone()),
            name,
            monitor_of_sink: info.monitor_of_sink,
        });
    }
}

unsafe extern "C" fn collect_sink_input(
    _context: *mut Context,
    info: *const SinkInputInfo,
    end: c_int,
    data: *mut c_void,
) {
    let request = &mut *data.cast::<Request<SinkInputEntry>>();
    let Some(info) = info.as_ref().filter(|_| end == 0) else {
        finish_list(request);
        return;
    };
    let Some(pulse) = pulse() else {
        return;
    };
    request.items.push(SinkInputEntry {
        index: info.index,
        sink: info.sink,
        binary: property(pulse, info.proplist, c"application.process.binary"),
        application_name: property(pulse, info.proplist, c"application.name"),
        process_id: property(pulse, info.proplist, c"application.process.id")
            .and_then(|value| value.parse().ok()),
    });
}

/// How a playback stream is identified. PipeWire's application capture
/// matches its target against the stream's binary or application name. Wine
/// streams all report the Wine loader as their binary but name the Windows
/// program, so they are matched by name.
struct StreamApplication {
    id: String,
    target: String,
    executable: String,
    name: Option<String>,
    process_id: Option<u32>,
}

fn stream_application(input: &SinkInputEntry) -> Option<StreamApplication> {
    let wine = input
        .binary
        .as_deref()
        .is_none_or(|binary| binary.starts_with("wine"));
    let (target, executable) = if wine {
        let name = input.application_name.clone()?;
        (name.clone(), name)
    } else {
        let binary = input.binary.clone()?;
        (binary.clone(), unwrapped_executable(binary))
    };
    Some(StreamApplication {
        id: audio_application_id_from_parts(Some(&executable), None, input.process_id.unwrap_or(0)),
        target,
        executable,
        name: input.application_name.clone(),
        process_id: input.process_id,
    })
}

fn foreign_stream(input: &SinkInputEntry) -> bool {
    input.process_id != Some(std::process::id())
}

pub(in crate::agent) fn audio_devices() -> Result<Vec<RecordingAudioDevice>, String> {
    Ok(Client::connect()?.inventory()?.devices())
}

pub(in crate::agent) fn default_audio_device_id(kind: &RecordingAudioDeviceKind) -> Option<String> {
    let inventory = Client::connect().ok()?.inventory().ok()?;
    match kind {
        RecordingAudioDeviceKind::Output => inventory.default_output,
        RecordingAudioDeviceKind::Input => inventory.default_input,
    }
}

pub(in crate::agent) fn audio_applications() -> Vec<RecordingAudioApplicationSelection> {
    let inventory = match Client::connect().and_then(|client| client.inventory()) {
        Ok(inventory) => inventory,
        Err(error) => {
            eprintln!("[{SIDE_CAR_NAME}] could not list audio applications: {error}");
            return Vec::new();
        }
    };
    let mut applications: Vec<RecordingAudioApplicationSelection> = Vec::new();
    for application in inventory
        .inputs
        .iter()
        .filter(|input| foreign_stream(input))
        .filter_map(stream_application)
    {
        if applications.iter().any(|known| known.id == application.id) {
            continue;
        }
        let name = user_facing_process_name(ProcessDisplayName {
            path: None,
            preferred: application.name.as_deref(),
            title: None,
            executable: Some(&application.executable),
            fallback: Some(&application.executable),
            preserve_preferred: false,
        })
        .unwrap_or_else(|| application.executable.clone());
        applications.push(RecordingAudioApplicationSelection {
            id: application.id,
            name,
            window: application.target,
            executable: Some(application.executable),
            icon_url: None,
            process_id: application.process_id,
            enabled: false,
            volume: 100,
        });
    }
    applications
}

struct AudioLevelMonitor {
    deadline: Option<Instant>,
    running: bool,
}

static AUDIO_LEVEL_MONITOR: Mutex<AudioLevelMonitor> = Mutex::new(AudioLevelMonitor {
    deadline: None,
    running: false,
});

/// Keeps live `audio-levels` events flowing for the next few seconds.
/// Callers re-send this as a heartbeat while a meter UI is visible, so a
/// crashed window or sidecar respawn never leaves the meter thread orphaned.
pub(in crate::agent) fn subscribe_audio_level_events() {
    let mut monitor = lock_audio_level_monitor();
    monitor.deadline = Some(Instant::now() + AUDIO_LEVEL_SUBSCRIPTION_TTL);
    if !monitor.running {
        monitor.running = true;
        thread::spawn(run_audio_level_monitor);
    }
}

pub(in crate::agent) fn stop_audio_level_events() {
    lock_audio_level_monitor().deadline = None;
}

fn lock_audio_level_monitor() -> MutexGuard<'static, AudioLevelMonitor> {
    match AUDIO_LEVEL_MONITOR.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// True while the subscription deadline is in the future. Once expired the
/// monitor is marked stopped under the same lock, so a concurrent subscribe
/// either extends the deadline in time or spawns a fresh thread.
fn audio_level_subscription_active() -> bool {
    let mut monitor = lock_audio_level_monitor();
    let active = monitor
        .deadline
        .is_some_and(|deadline| Instant::now() < deadline);
    if !active {
        monitor.deadline = None;
        monitor.running = false;
    }
    active
}

#[derive(Clone, PartialEq, Eq, Hash)]
enum MeterTarget {
    /// A source name: an input, or a sink's monitor for an output.
    Source(String),
    /// A playback stream, metered through its sink's monitor.
    Stream(u32),
}

/// One peak-detect record stream. The read callback raises `peak` to the
/// loudest sample since the last poll; the poller swaps it back to zero.
struct Meter {
    stream: *mut Stream,
    peak: Box<AtomicU32>,
    level: MeterLevel,
}

enum MeterLevel {
    Device {
        kind: RecordingAudioDeviceKind,
        ids: Vec<String>,
    },
    Application(String),
}

fn run_audio_level_monitor() {
    let client = match Client::connect() {
        Ok(client) => client,
        Err(error) => {
            eprintln!("[{SIDE_CAR_NAME}] audio levels unavailable: {error}");
            let mut monitor = lock_audio_level_monitor();
            monitor.deadline = None;
            monitor.running = false;
            return;
        }
    };

    let mut meters: HashMap<MeterTarget, Meter> = HashMap::new();
    let mut refreshed_at: Option<Instant> = None;
    while audio_level_subscription_active() {
        // Devices and streams come and go; reconcile on a slow cadence and
        // only read the peaks in between.
        if refreshed_at.is_none_or(|at| at.elapsed() >= AUDIO_LEVEL_REFRESH_INTERVAL) {
            match client.inventory() {
                Ok(inventory) => reconcile_meters(&client, &mut meters, &inventory),
                Err(error) => {
                    eprintln!("[{SIDE_CAR_NAME}] audio level refresh failed: {error}");
                    break;
                }
            }
            refreshed_at = Some(Instant::now());
        }
        emit_event(RecordingEvent::AudioLevels {
            levels: poll_levels(&meters),
        });
        thread::sleep(AUDIO_LEVEL_POLL_INTERVAL);
    }

    for (_, meter) in meters.drain() {
        remove_meter(&client, meter);
    }
    let mut monitor = lock_audio_level_monitor();
    monitor.deadline = None;
    monitor.running = false;
}

fn reconcile_meters(
    client: &Client,
    meters: &mut HashMap<MeterTarget, Meter>,
    inventory: &Inventory,
) {
    let mut wanted: HashMap<MeterTarget, (String, Option<u32>, MeterLevel)> = HashMap::new();
    for device in inventory.devices() {
        let default = match device.kind {
            RecordingAudioDeviceKind::Output => inventory.default_output.as_deref(),
            RecordingAudioDeviceKind::Input => inventory.default_input.as_deref(),
        };
        let mut ids = vec![device.id.clone()];
        if default == Some(device.id.as_str()) {
            ids.push("default".to_string());
        }
        wanted.insert(
            MeterTarget::Source(device.id.clone()),
            (
                device.id,
                None,
                MeterLevel::Device {
                    kind: device.kind,
                    ids,
                },
            ),
        );
    }
    for input in inventory
        .inputs
        .iter()
        .filter(|input| foreign_stream(input))
    {
        let (Some(application), Some(sink)) = (
            stream_application(input),
            inventory.sinks.iter().find(|sink| sink.index == input.sink),
        ) else {
            continue;
        };
        wanted.insert(
            MeterTarget::Stream(input.index),
            (
                sink.monitor_source_name.clone(),
                Some(input.index),
                MeterLevel::Application(application.id),
            ),
        );
    }

    let gone: Vec<_> = meters
        .keys()
        .filter(|target| !wanted.contains_key(target))
        .cloned()
        .collect();
    for target in gone {
        if let Some(meter) = meters.remove(&target) {
            remove_meter(client, meter);
        }
    }
    for (target, (source, stream_index, level)) in wanted {
        if let Some(meter) = meters.get_mut(&target) {
            meter.level = level;
            continue;
        }
        match create_meter(client, &source, stream_index, level) {
            Ok(meter) => {
                meters.insert(target, meter);
            }
            Err(error) => eprintln!("[{SIDE_CAR_NAME}] audio level meter skipped: {error}"),
        }
    }
}

fn create_meter(
    client: &Client,
    source: &str,
    stream_index: Option<u32>,
    level: MeterLevel,
) -> Result<Meter, String> {
    let pulse = client.pulse;
    let source = std::ffi::CString::new(source).map_err(|_| "Invalid source name.")?;
    let spec = SampleSpec {
        format: PA_SAMPLE_FLOAT32NE,
        rate: AUDIO_LEVEL_RATE,
        channels: 1,
    };
    // One float per fragment keeps the meter current without buffering.
    let attributes = BufferAttr {
        maxlength: u32::MAX,
        tlength: u32::MAX,
        prebuf: u32::MAX,
        minreq: u32::MAX,
        fragsize: size_of::<f32>() as u32,
    };
    let peak = Box::new(AtomicU32::new(0));
    let _lock = client.lock();
    // SAFETY: the main loop is locked; `peak` outlives the stream, whose read
    // callback is cleared under the same lock before the box drops.
    unsafe {
        let stream = (pulse.stream_new)(
            client.context,
            c"Alloy level meter".as_ptr(),
            &spec,
            ptr::null(),
        );
        if stream.is_null() {
            return Err("PulseAudio could not create a meter stream.".into());
        }
        (pulse.stream_set_read_callback)(
            stream,
            Some(read_peak),
            (&*peak as *const AtomicU32).cast_mut().cast(),
        );
        if let Some(index) = stream_index {
            (pulse.stream_set_monitor_stream)(stream, index);
        }
        let flags = PA_STREAM_PEAK_DETECT
            | PA_STREAM_ADJUST_LATENCY
            | PA_STREAM_DONT_MOVE
            | PA_STREAM_DONT_INHIBIT_AUTO_SUSPEND;
        if (pulse.stream_connect_record)(stream, source.as_ptr(), &attributes, flags) < 0 {
            (pulse.stream_set_read_callback)(stream, None, ptr::null_mut());
            (pulse.stream_unref)(stream);
            return Err(format!(
                "PulseAudio could not meter {}.",
                source.to_string_lossy()
            ));
        }
        Ok(Meter {
            stream,
            peak,
            level,
        })
    }
}

fn remove_meter(client: &Client, meter: Meter) {
    let pulse = client.pulse;
    let _lock = client.lock();
    // SAFETY: the main loop is locked, so the read callback is not running
    // and cannot run again once cleared.
    unsafe {
        (pulse.stream_set_read_callback)(meter.stream, None, ptr::null_mut());
        (pulse.stream_disconnect)(meter.stream);
        (pulse.stream_unref)(meter.stream);
    }
}

unsafe extern "C" fn read_peak(stream: *mut Stream, _length: usize, peak: *mut c_void) {
    let Some(pulse) = pulse() else {
        return;
    };
    let mut data: *const c_void = ptr::null();
    let mut length = 0usize;
    if (pulse.stream_peek)(stream, &mut data, &mut length) < 0 || length == 0 {
        return;
    }
    if !data.is_null() {
        let samples = std::slice::from_raw_parts(data.cast::<f32>(), length / size_of::<f32>());
        let loudest = samples
            .iter()
            .fold(0f32, |loudest, sample| loudest.max(sample.abs()))
            .clamp(0.0, 1.0);
        // Non-negative floats order like their bit patterns.
        (*peak.cast::<AtomicU32>()).fetch_max(loudest.to_bits(), Ordering::Relaxed);
    }
    // A hole (null data) is dropped too.
    (pulse.stream_drop)(stream);
}

fn poll_levels(meters: &HashMap<MeterTarget, Meter>) -> Vec<RecordingAudioLevel> {
    let mut levels = Vec::new();
    // An application can play several streams; report the loudest one.
    let mut application_peaks: HashMap<&str, f32> = HashMap::new();
    for meter in meters.values() {
        let peak = f32::from_bits(meter.peak.swap(0, Ordering::Relaxed));
        match &meter.level {
            MeterLevel::Device { kind, ids } => {
                for id in ids {
                    levels.push(RecordingAudioLevel {
                        target: RecordingAudioLevelTarget::Device,
                        kind: Some(kind.clone()),
                        id: id.clone(),
                        peak,
                    });
                }
            }
            MeterLevel::Application(id) => {
                let entry = application_peaks.entry(id.as_str()).or_insert(0.0);
                *entry = entry.max(peak);
            }
        }
    }
    for (id, peak) in application_peaks {
        levels.push(RecordingAudioLevel {
            target: RecordingAudioLevelTarget::Application,
            kind: None,
            id: id.to_string(),
            peak,
        });
    }
    levels
}
