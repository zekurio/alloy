//! A small PipeWire client: the audio nodes, the default devices, and peak
//! meters. libpipewire is loaded at run time like libobs: from the OBS
//! runtime's `lib` folder first, where the Nix runtime links the copy
//! obs-pipewire-audio-capture uses, then from the system.
//!
//! `pw_core_sync`, `pw_registry_bind` and the other interface methods are
//! inline functions in PipeWire's headers before 1.2, so they are called
//! through the interface's method table, the stable ABI those functions wrap.
//! Every call that touches the graph runs with the thread loop locked;
//! callbacks run on the loop's thread, which holds the same lock.

use std::{
    collections::HashMap,
    env,
    ffi::{c_char, c_int, c_void, CStr, CString},
    mem::offset_of,
    path::PathBuf,
    ptr,
    sync::{
        atomic::{AtomicU32, Ordering},
        Once, OnceLock,
    },
    time::Duration,
};

use libloading::Library;

use crate::{agent::obs::load_symbol, protocol::SIDE_CAR_NAME};

/// How long connecting, or one round trip, may take before the server
/// counts as unresponsive.
const ROUNDTRIP_TIMEOUT: Duration = Duration::from_secs(3);

const PW_ID_CORE: u32 = 0;
const PW_VERSION_REGISTRY: u32 = 3;
const PW_VERSION_NODE: u32 = 3;
const PW_VERSION_CLIENT: u32 = 3;
const PW_VERSION_METADATA: u32 = 3;
const PW_NODE_CHANGE_MASK_PROPS: u64 = 1 << 3;
const PW_CLIENT_CHANGE_MASK_PROPS: u64 = 1 << 0;
const SPA_DIRECTION_INPUT: c_int = 0;
const PW_STREAM_FLAG_AUTOCONNECT: c_int = 1 << 0;
const PW_STREAM_FLAG_MAP_BUFFERS: c_int = 1 << 2;
const PW_STREAM_FLAG_DONT_RECONNECT: c_int = 1 << 7;
/// No node id: a meter's target comes from `target.object`.
const PW_ID_ANY: u32 = u32::MAX;

const INTERFACE_NODE: &CStr = c"PipeWire:Interface:Node";
const INTERFACE_CLIENT: &CStr = c"PipeWire:Interface:Client";
const INTERFACE_METADATA: &CStr = c"PipeWire:Interface:Metadata";

/// `EnumFormat` for interleaved 32-bit floats in native byte order, at the
/// node's own rate and channel count: what `spa_format_audio_raw_build`
/// writes for `SPA_AUDIO_FORMAT_F32`. Pods are 8-byte aligned.
#[repr(C, align(8))]
struct FormatPod([u32; 22]);

static METER_FORMAT: FormatPod = FormatPod([
    80, 15, // pod: body size, SPA_TYPE_Object
    0x40003, 3, // SPA_TYPE_OBJECT_Format, SPA_PARAM_EnumFormat
    1, 0, 4, 3, 1, 0, // SPA_FORMAT_mediaType: Id SPA_MEDIA_TYPE_audio
    2, 0, 4, 3, 1, 0, // SPA_FORMAT_mediaSubtype: Id SPA_MEDIA_SUBTYPE_raw
    0x10001, 0, 4, 3, 0x11b, 0, // SPA_FORMAT_AUDIO_format: Id SPA_AUDIO_FORMAT_F32
]);

type ThreadLoop = c_void;
type Loop = c_void;
type Context = c_void;
type Core = c_void;
type Proxy = c_void;
type Properties = c_void;
type Stream = c_void;
/// An unused callback or method slot.
type Slot = Option<unsafe extern "C" fn()>;

#[repr(C)]
struct SpaList {
    next: *mut SpaList,
    prev: *mut SpaList,
}

#[repr(C)]
struct SpaCallbacks {
    funcs: *const c_void,
    data: *mut c_void,
}

#[repr(C)]
struct SpaHook {
    link: SpaList,
    cb: SpaCallbacks,
    removed: Slot,
    private: *mut c_void,
}

#[repr(C)]
struct SpaInterface {
    kind: *const c_char,
    version: u32,
    cb: SpaCallbacks,
}

#[repr(C)]
struct SpaDictItem {
    key: *const c_char,
    value: *const c_char,
}

#[repr(C)]
struct SpaDict {
    flags: u32,
    n_items: u32,
    items: *const SpaDictItem,
}

/// The leading fields every `pw_*_methods` table shares.
#[repr(C)]
struct ListenerMethods {
    version: u32,
    add_listener: Option<
        unsafe extern "C" fn(*mut c_void, *mut SpaHook, *const c_void, *mut c_void) -> c_int,
    >,
}

/// The leading fields of `pw_core_methods`, up to the last one called.
#[repr(C)]
struct CoreMethods {
    version: u32,
    add_listener: Slot,
    hello: Slot,
    sync: Option<unsafe extern "C" fn(*mut c_void, u32, c_int) -> c_int>,
    pong: Slot,
    error: Slot,
    get_registry: Option<unsafe extern "C" fn(*mut c_void, u32, usize) -> *mut Proxy>,
}

/// The leading fields of `pw_registry_methods`, up to the last one called.
#[repr(C)]
struct RegistryMethods {
    version: u32,
    add_listener: Slot,
    bind: Option<unsafe extern "C" fn(*mut c_void, u32, *const c_char, u32, usize) -> *mut Proxy>,
}

/// `pw_core_events`, version 0.
#[repr(C)]
struct CoreEvents {
    version: u32,
    info: Slot,
    done: Option<unsafe extern "C" fn(*mut c_void, u32, c_int)>,
    ping: Slot,
    error: Option<unsafe extern "C" fn(*mut c_void, u32, c_int, c_int, *const c_char)>,
    remove_id: Slot,
    bound_id: Slot,
    add_mem: Slot,
    remove_mem: Slot,
}

#[repr(C)]
struct RegistryEvents {
    version: u32,
    global: Option<unsafe extern "C" fn(*mut c_void, u32, u32, *const c_char, u32, *const SpaDict)>,
    global_remove: Option<unsafe extern "C" fn(*mut c_void, u32)>,
}

#[repr(C)]
struct InfoEvents<T> {
    version: u32,
    info: Option<unsafe extern "C" fn(*mut c_void, *const T)>,
    second: Slot,
}

#[repr(C)]
struct MetadataEvents {
    version: u32,
    property: Option<
        unsafe extern "C" fn(
            *mut c_void,
            u32,
            *const c_char,
            *const c_char,
            *const c_char,
        ) -> c_int,
    >,
}

/// `pw_stream_events`, version 0.
#[repr(C)]
struct StreamEvents {
    version: u32,
    destroy: Slot,
    state_changed: Slot,
    control_info: Slot,
    io_changed: Slot,
    param_changed: Slot,
    add_buffer: Slot,
    remove_buffer: Slot,
    process: Option<unsafe extern "C" fn(*mut c_void)>,
    drained: Slot,
}

/// The leading fields of `pw_node_info`, up to the last one read.
#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct NodeInfo {
    id: u32,
    max_input_ports: u32,
    max_output_ports: u32,
    change_mask: u64,
    n_input_ports: u32,
    n_output_ports: u32,
    state: c_int,
    error: *const c_char,
    props: *const SpaDict,
}

#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct ClientInfo {
    id: u32,
    change_mask: u64,
    props: *const SpaDict,
}

/// The leading field of `pw_buffer`.
#[repr(C)]
struct PwBuffer {
    buffer: *mut SpaBuffer,
}

#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct SpaBuffer {
    n_metas: u32,
    n_datas: u32,
    metas: *mut c_void,
    datas: *mut SpaData,
}

#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct SpaData {
    kind: u32,
    flags: u32,
    fd: i64,
    mapoffset: u32,
    maxsize: u32,
    data: *mut c_void,
    chunk: *mut SpaChunk,
}

#[allow(dead_code)] // Mirrors the C layout; only some fields are read.
#[repr(C)]
struct SpaChunk {
    offset: u32,
    size: u32,
    stride: i32,
    flags: i32,
}

// Offsets from PipeWire 1.6's headers on x86_64. Method and event tables only
// grow at the end, so these hold back to 0.3. A mismatch here fails the build
// instead of misreading memory.
const _: () = {
    assert!(size_of::<SpaHook>() == 48);
    assert!(offset_of!(SpaInterface, cb) == 16);
    assert!(size_of::<SpaDict>() == 16);
    assert!(size_of::<SpaDictItem>() == 16);
    assert!(offset_of!(ListenerMethods, add_listener) == 8);
    assert!(offset_of!(CoreMethods, sync) == 24);
    assert!(offset_of!(CoreMethods, get_registry) == 48);
    assert!(offset_of!(RegistryMethods, bind) == 16);
    assert!(offset_of!(CoreEvents, done) == 16);
    assert!(offset_of!(CoreEvents, error) == 32);
    assert!(offset_of!(RegistryEvents, global_remove) == 16);
    assert!(offset_of!(InfoEvents<NodeInfo>, info) == 8);
    assert!(size_of::<InfoEvents<NodeInfo>>() == 24);
    assert!(offset_of!(MetadataEvents, property) == 8);
    assert!(offset_of!(StreamEvents, process) == 64);
    assert!(offset_of!(NodeInfo, change_mask) == 16);
    assert!(offset_of!(NodeInfo, props) == 48);
    assert!(offset_of!(ClientInfo, change_mask) == 8);
    assert!(offset_of!(ClientInfo, props) == 16);
    assert!(offset_of!(SpaBuffer, datas) == 16);
    assert!(size_of::<SpaData>() == 40);
    assert!(offset_of!(SpaData, maxsize) == 20);
    assert!(offset_of!(SpaData, data) == 24);
    assert!(offset_of!(SpaData, chunk) == 32);
    assert!(size_of::<FormatPod>() == 88);
};

struct Pw {
    init: unsafe extern "C" fn(*mut c_int, *mut *mut *mut c_char),
    thread_loop_new: unsafe extern "C" fn(*const c_char, *const SpaDict) -> *mut ThreadLoop,
    thread_loop_destroy: unsafe extern "C" fn(*mut ThreadLoop),
    thread_loop_start: unsafe extern "C" fn(*mut ThreadLoop) -> c_int,
    thread_loop_stop: unsafe extern "C" fn(*mut ThreadLoop),
    thread_loop_lock: unsafe extern "C" fn(*mut ThreadLoop),
    thread_loop_unlock: unsafe extern "C" fn(*mut ThreadLoop),
    thread_loop_signal: unsafe extern "C" fn(*mut ThreadLoop, bool),
    thread_loop_get_time: unsafe extern "C" fn(*mut ThreadLoop, *mut libc::timespec, i64) -> c_int,
    thread_loop_timed_wait_full:
        unsafe extern "C" fn(*mut ThreadLoop, *const libc::timespec) -> c_int,
    thread_loop_get_loop: unsafe extern "C" fn(*mut ThreadLoop) -> *mut Loop,
    context_new: unsafe extern "C" fn(*mut Loop, *mut Properties, usize) -> *mut Context,
    context_destroy: unsafe extern "C" fn(*mut Context),
    context_connect: unsafe extern "C" fn(*mut Context, *mut Properties, usize) -> *mut Core,
    core_disconnect: unsafe extern "C" fn(*mut Core) -> c_int,
    proxy_destroy: unsafe extern "C" fn(*mut Proxy),
    properties_new_dict: unsafe extern "C" fn(*const SpaDict) -> *mut Properties,
    stream_new: unsafe extern "C" fn(*mut Core, *const c_char, *mut Properties) -> *mut Stream,
    stream_add_listener:
        unsafe extern "C" fn(*mut Stream, *mut SpaHook, *const StreamEvents, *mut c_void),
    stream_connect:
        unsafe extern "C" fn(*mut Stream, c_int, u32, c_int, *mut *const c_void, u32) -> c_int,
    stream_dequeue_buffer: unsafe extern "C" fn(*mut Stream) -> *mut PwBuffer,
    stream_queue_buffer: unsafe extern "C" fn(*mut Stream, *mut PwBuffer) -> c_int,
    stream_destroy: unsafe extern "C" fn(*mut Stream),
    // Keeps the function pointers above valid.
    _library: Library,
}

static PIPEWIRE: OnceLock<Option<Pw>> = OnceLock::new();

fn pipewire() -> Option<&'static Pw> {
    PIPEWIRE.get_or_init(load_pipewire).as_ref()
}

fn load_pipewire() -> Option<Pw> {
    let mut candidates: Vec<PathBuf> = env::var_os("ALLOY_OBS_RUNTIME_DIR")
        .map(|runtime| PathBuf::from(runtime).join("lib/libpipewire-0.3.so.0"))
        .into_iter()
        .collect();
    candidates.push(PathBuf::from("libpipewire-0.3.so.0"));
    let mut errors = Vec::new();
    for candidate in candidates {
        // SAFETY: libpipewire runs no initialization with preconditions on
        // load; `pw_init` runs once below.
        match unsafe { Library::new(&candidate) }.map_err(|error| error.to_string()) {
            Ok(library) => match unsafe { Pw::from_library(library) } {
                Ok(pw) => {
                    static INIT: Once = Once::new();
                    // SAFETY: null arguments are allowed; libpipewire
                    // counts nested calls, so the plugin's own is fine.
                    INIT.call_once(|| unsafe { (pw.init)(ptr::null_mut(), ptr::null_mut()) });
                    return Some(pw);
                }
                Err(error) => errors.push(format!("{}: {error}", candidate.display())),
            },
            Err(error) => errors.push(format!("{}: {error}", candidate.display())),
        }
    }
    eprintln!(
        "[{SIDE_CAR_NAME}] PipeWire client unavailable, so audio discovery and meters are off: {}",
        errors.join("; ")
    );
    None
}

impl Pw {
    unsafe fn from_library(library: Library) -> Result<Self, String> {
        Ok(Self {
            init: load_symbol(&library, b"pw_init\0")?,
            thread_loop_new: load_symbol(&library, b"pw_thread_loop_new\0")?,
            thread_loop_destroy: load_symbol(&library, b"pw_thread_loop_destroy\0")?,
            thread_loop_start: load_symbol(&library, b"pw_thread_loop_start\0")?,
            thread_loop_stop: load_symbol(&library, b"pw_thread_loop_stop\0")?,
            thread_loop_lock: load_symbol(&library, b"pw_thread_loop_lock\0")?,
            thread_loop_unlock: load_symbol(&library, b"pw_thread_loop_unlock\0")?,
            thread_loop_signal: load_symbol(&library, b"pw_thread_loop_signal\0")?,
            thread_loop_get_time: load_symbol(&library, b"pw_thread_loop_get_time\0")?,
            thread_loop_timed_wait_full: load_symbol(
                &library,
                b"pw_thread_loop_timed_wait_full\0",
            )?,
            thread_loop_get_loop: load_symbol(&library, b"pw_thread_loop_get_loop\0")?,
            context_new: load_symbol(&library, b"pw_context_new\0")?,
            context_destroy: load_symbol(&library, b"pw_context_destroy\0")?,
            context_connect: load_symbol(&library, b"pw_context_connect\0")?,
            core_disconnect: load_symbol(&library, b"pw_core_disconnect\0")?,
            proxy_destroy: load_symbol(&library, b"pw_proxy_destroy\0")?,
            properties_new_dict: load_symbol(&library, b"pw_properties_new_dict\0")?,
            stream_new: load_symbol(&library, b"pw_stream_new\0")?,
            stream_add_listener: load_symbol(&library, b"pw_stream_add_listener\0")?,
            stream_connect: load_symbol(&library, b"pw_stream_connect\0")?,
            stream_dequeue_buffer: load_symbol(&library, b"pw_stream_dequeue_buffer\0")?,
            stream_queue_buffer: load_symbol(&library, b"pw_stream_queue_buffer\0")?,
            stream_destroy: load_symbol(&library, b"pw_stream_destroy\0")?,
            _library: library,
        })
    }
}

/// A zeroed `spa_hook` at a fixed address. libpipewire links it into a
/// listener list, so it is freed only after its object is destroyed.
struct Hook(*mut SpaHook);

impl Hook {
    fn new() -> Self {
        Self(Box::into_raw(Box::new(SpaHook {
            link: SpaList {
                next: ptr::null_mut(),
                prev: ptr::null_mut(),
            },
            cb: SpaCallbacks {
                funcs: ptr::null(),
                data: ptr::null_mut(),
            },
            removed: None,
            private: ptr::null_mut(),
        })))
    }
}

impl Drop for Hook {
    fn drop(&mut self) {
        // SAFETY: allocated in `new`; its object has been destroyed.
        drop(unsafe { Box::from_raw(self.0) });
    }
}

/// Calls `add_listener`, the first method of every PipeWire interface.
///
/// # Safety
///
/// `object` must be a live proxy, `events` the event table for its type,
/// and `hook` must stay allocated until the proxy is destroyed.
unsafe fn add_listener(object: *mut c_void, hook: &Hook, events: *const c_void, data: *mut c_void) {
    let interface = &*object.cast::<SpaInterface>();
    let methods = &*interface.cb.funcs.cast::<ListenerMethods>();
    if let Some(add_listener) = methods.add_listener {
        add_listener(interface.cb.data, hook.0, events, data);
    }
}

/// A playback stream's identity, or a device, as the capture plugin sees it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum NodeClass {
    /// `Audio/Sink` or `Audio/Duplex`: an output.
    Sink,
    /// `Audio/Source` or `Audio/Source/Virtual`: an input.
    Source,
    /// `Stream/Output/Audio`: an application's playback.
    Playback,
}

impl NodeClass {
    fn from_media_class(class: &str) -> Option<Self> {
        match class {
            "Audio/Sink" | "Audio/Duplex" => Some(Self::Sink),
            "Audio/Source" | "Audio/Source/Virtual" => Some(Self::Source),
            "Stream/Output/Audio" => Some(Self::Playback),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub(super) struct Node {
    pub(super) serial: Option<u32>,
    pub(super) class: NodeClass,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) application_name: Option<String>,
    pub(super) binary: Option<String>,
    pub(super) process_id: Option<u32>,
    client: Option<u32>,
}

#[derive(Default)]
struct ClientProps {
    binary: Option<String>,
    process_id: Option<u32>,
}

/// The audio nodes and default devices at one moment.
pub(super) struct Graph {
    pub(super) nodes: Vec<Node>,
    pub(super) default_sink: Option<String>,
    pub(super) default_source: Option<String>,
}

/// A proxy bound from a registry global, with the listener reading its info.
struct Bound {
    proxy: *mut Proxy,
    _hook: Hook,
    _target: Box<Target>,
}

/// What a bound proxy's callback updates.
struct Target {
    state: *mut State,
    global: u32,
}

/// Everything callbacks write. Only touched with the thread loop locked.
struct State {
    pw: &'static Pw,
    thread_loop: *mut ThreadLoop,
    registry: *mut Proxy,
    nodes: HashMap<u32, Node>,
    clients: HashMap<u32, ClientProps>,
    bound: HashMap<u32, Bound>,
    /// The `default` metadata's global.
    metadata: Option<u32>,
    default_sink: Option<String>,
    default_source: Option<String>,
    synced: c_int,
    error: Option<String>,
}

static CORE_EVENTS: CoreEvents = CoreEvents {
    version: 0,
    info: None,
    done: Some(core_done),
    ping: None,
    error: Some(core_error),
    remove_id: None,
    bound_id: None,
    add_mem: None,
    remove_mem: None,
};

static REGISTRY_EVENTS: RegistryEvents = RegistryEvents {
    version: 0,
    global: Some(registry_global),
    global_remove: Some(registry_global_remove),
};

static NODE_EVENTS: InfoEvents<NodeInfo> = InfoEvents {
    version: 0,
    info: Some(node_info),
    second: None,
};

static CLIENT_EVENTS: InfoEvents<ClientInfo> = InfoEvents {
    version: 0,
    info: Some(client_info),
    second: None,
};

static METADATA_EVENTS: MetadataEvents = MetadataEvents {
    version: 0,
    property: Some(metadata_property),
};

static METER_EVENTS: StreamEvents = StreamEvents {
    version: 0,
    destroy: None,
    state_changed: None,
    control_info: None,
    io_changed: None,
    param_changed: None,
    add_buffer: None,
    remove_buffer: None,
    process: Some(meter_process),
    drained: None,
};

/// A connection with a live view of the audio graph: the registry listener
/// keeps nodes and defaults current for as long as the client lives.
pub(super) struct Client {
    pw: &'static Pw,
    thread_loop: *mut ThreadLoop,
    context: *mut Context,
    core: *mut Core,
    state: *mut State,
    core_hook: Hook,
    registry_hook: Hook,
}

impl Client {
    pub(super) fn connect() -> Result<Self, String> {
        let pw = pipewire().ok_or("The PipeWire client library is not available.")?;
        // SAFETY: each call follows libpipewire's thread loop rules; the
        // client owns the loop, context, core and state until it drops.
        unsafe {
            let thread_loop = (pw.thread_loop_new)(c"alloy-pipewire".as_ptr(), ptr::null());
            if thread_loop.is_null() {
                return Err("Could not create a PipeWire thread loop.".into());
            }
            let context =
                (pw.context_new)((pw.thread_loop_get_loop)(thread_loop), ptr::null_mut(), 0);
            if context.is_null() {
                (pw.thread_loop_destroy)(thread_loop);
                return Err("Could not create a PipeWire context.".into());
            }
            let mut client = Self {
                pw,
                thread_loop,
                context,
                core: ptr::null_mut(),
                state: Box::into_raw(Box::new(State {
                    pw,
                    thread_loop,
                    registry: ptr::null_mut(),
                    nodes: HashMap::new(),
                    clients: HashMap::new(),
                    bound: HashMap::new(),
                    metadata: None,
                    default_sink: None,
                    default_source: None,
                    synced: -1,
                    error: None,
                })),
                core_hook: Hook::new(),
                registry_hook: Hook::new(),
            };
            if (pw.thread_loop_start)(thread_loop) < 0 {
                return Err("Could not start the PipeWire thread loop.".into());
            }
            let _lock = client.lock();
            client.core = (pw.context_connect)(context, ptr::null_mut(), 0);
            if client.core.is_null() {
                return Err("Could not connect to the PipeWire server.".into());
            }
            add_listener(
                client.core,
                &client.core_hook,
                ptr::addr_of!(CORE_EVENTS).cast(),
                client.state.cast(),
            );
            let registry = client.registry()?;
            (*client.state).registry = registry;
            add_listener(
                registry,
                &client.registry_hook,
                ptr::addr_of!(REGISTRY_EVENTS).cast(),
                client.state.cast(),
            );
            // The first round trip delivers the globals. Their binds go out
            // from the global callback, so the second one delivers the node,
            // client and metadata info they answer with.
            client.roundtrip()?;
            client.roundtrip()?;
            drop(_lock);
            Ok(client)
        }
    }

    /// The core's method table and the object its methods take.
    ///
    /// # Safety
    ///
    /// The core must be connected.
    unsafe fn core_methods(&self) -> (&CoreMethods, *mut c_void) {
        let interface = &*self.core.cast::<SpaInterface>();
        (
            &*interface.cb.funcs.cast::<CoreMethods>(),
            interface.cb.data,
        )
    }

    /// # Safety
    ///
    /// The thread loop must be locked.
    unsafe fn registry(&self) -> Result<*mut Proxy, String> {
        let (methods, object) = self.core_methods();
        let get_registry = methods
            .get_registry
            .ok_or("PipeWire's core has no registry method.")?;
        let registry = get_registry(object, PW_VERSION_REGISTRY, 0);
        if registry.is_null() {
            return Err("PipeWire did not hand out its registry.".into());
        }
        Ok(registry)
    }

    fn lock(&self) -> LoopLock {
        // SAFETY: the loop lives as long as the client, which outlives the
        // guard.
        unsafe { (self.pw.thread_loop_lock)(self.thread_loop) };
        LoopLock {
            pw: self.pw,
            thread_loop: self.thread_loop,
        }
    }

    /// Waits until the server has handled every request sent so far.
    ///
    /// # Safety
    ///
    /// The thread loop must be locked.
    unsafe fn roundtrip(&self) -> Result<(), String> {
        let (methods, object) = self.core_methods();
        let sync = methods.sync.ok_or("PipeWire's core has no sync method.")?;
        let seq = sync(object, PW_ID_CORE, 0);
        if seq < 0 {
            return Err("PipeWire rejected a sync request.".into());
        }
        let mut deadline = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        (self.pw.thread_loop_get_time)(
            self.thread_loop,
            &mut deadline,
            ROUNDTRIP_TIMEOUT.as_nanos() as i64,
        );
        loop {
            let state = &*self.state;
            if let Some(error) = &state.error {
                return Err(format!("PipeWire closed the connection: {error}"));
            }
            if state.synced == seq {
                return Ok(());
            }
            if (self.pw.thread_loop_timed_wait_full)(self.thread_loop, &deadline) != 0 {
                return Err("PipeWire did not answer in time.".into());
            }
        }
    }

    /// The audio nodes and defaults as last reported.
    pub(super) fn graph(&self) -> Graph {
        let _lock = self.lock();
        // SAFETY: callbacks only write the state with the loop locked.
        let state = unsafe { &*self.state };
        let nodes = state
            .nodes
            .values()
            .map(|node| {
                // A native client names its binary and process on the client;
                // pipewire-pulse puts them on each stream.
                let client = node.client.and_then(|id| state.clients.get(&id));
                Node {
                    binary: node
                        .binary
                        .clone()
                        .or_else(|| client.and_then(|client| client.binary.clone())),
                    process_id: node
                        .process_id
                        .or_else(|| client.and_then(|client| client.process_id)),
                    ..node.clone()
                }
            })
            .collect();
        Graph {
            nodes,
            default_sink: state.default_sink.clone(),
            default_source: state.default_source.clone(),
        }
    }

    /// Starts a meter on `target`, a node name or serial. With
    /// `capture_sink`, it reads what a sink plays rather than a source.
    pub(super) fn meter(&self, target: &str, capture_sink: bool) -> Result<Meter, String> {
        let target = CString::new(target).map_err(|_| "Invalid meter target.")?;
        let properties = [
            (c"media.type", c"Audio"),
            (c"media.category", c"Capture"),
            (c"media.name", c"Alloy level meter"),
            (c"target.object", target.as_c_str()),
            (
                c"stream.capture.sink",
                if capture_sink { c"true" } else { c"false" },
            ),
            // A meter must not wake a suspended device or count toward its
            // latency.
            (c"node.passive", c"true"),
            (c"stream.monitor", c"true"),
        ];
        let items: Vec<SpaDictItem> = properties
            .iter()
            .map(|(key, value)| SpaDictItem {
                key: key.as_ptr(),
                value: value.as_ptr(),
            })
            .collect();
        let dict = SpaDict {
            flags: 0,
            n_items: items.len() as u32,
            items: items.as_ptr(),
        };
        let mut data = Box::new(MeterData {
            stream: ptr::null_mut(),
            peak: AtomicU32::new(0),
        });
        let hook = Hook::new();
        let _lock = self.lock();
        // SAFETY: the loop is locked; `data` and `hook` outlive the stream,
        // which `remove_meter` destroys under the same lock before they drop.
        unsafe {
            let stream = (self.pw.stream_new)(
                self.core,
                c"Alloy level meter".as_ptr(),
                (self.pw.properties_new_dict)(&dict),
            );
            if stream.is_null() {
                return Err("PipeWire could not create a meter stream.".into());
            }
            data.stream = stream;
            (self.pw.stream_add_listener)(
                stream,
                hook.0,
                &METER_EVENTS,
                (&*data as *const MeterData).cast_mut().cast(),
            );
            let mut params = [METER_FORMAT.0.as_ptr().cast::<c_void>()];
            let flags = PW_STREAM_FLAG_AUTOCONNECT
                | PW_STREAM_FLAG_MAP_BUFFERS
                | PW_STREAM_FLAG_DONT_RECONNECT;
            if (self.pw.stream_connect)(
                stream,
                SPA_DIRECTION_INPUT,
                PW_ID_ANY,
                flags,
                params.as_mut_ptr(),
                params.len() as u32,
            ) < 0
            {
                (self.pw.stream_destroy)(stream);
                return Err(format!(
                    "PipeWire could not meter {}.",
                    target.to_string_lossy()
                ));
            }
            Ok(Meter {
                stream,
                data,
                _hook: hook,
            })
        }
    }

    pub(super) fn remove_meter(&self, meter: Meter) {
        let _lock = self.lock();
        // SAFETY: the loop is locked, so the process callback is not running;
        // destroying the stream unhooks it before `meter` frees the hook.
        unsafe { (self.pw.stream_destroy)(meter.stream) };
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // SAFETY: disconnecting destroys the registry and every bound proxy,
        // which unhooks their listeners; stopping the loop joins its thread,
        // so no callback runs once the state is freed.
        unsafe {
            if !self.core.is_null() {
                let _lock = self.lock();
                (self.pw.core_disconnect)(self.core);
            }
            (self.pw.thread_loop_stop)(self.thread_loop);
            (self.pw.context_destroy)(self.context);
            (self.pw.thread_loop_destroy)(self.thread_loop);
            drop(Box::from_raw(self.state));
        }
    }
}

/// Holds the thread loop's lock. Doesn't borrow the client, so `connect`
/// can fill in the core while holding it.
struct LoopLock {
    pw: &'static Pw,
    thread_loop: *mut ThreadLoop,
}

impl Drop for LoopLock {
    fn drop(&mut self) {
        // SAFETY: paired with the lock taken in `Client::lock`.
        unsafe { (self.pw.thread_loop_unlock)(self.thread_loop) };
    }
}

/// One capture stream. The process callback raises `peak` to the loudest
/// sample since the last poll; the poller swaps it back to zero.
pub(super) struct Meter {
    stream: *mut Stream,
    data: Box<MeterData>,
    _hook: Hook,
}

impl Meter {
    pub(super) fn take_peak(&self) -> f32 {
        f32::from_bits(self.data.peak.swap(0, Ordering::Relaxed))
    }
}

struct MeterData {
    stream: *mut Stream,
    peak: AtomicU32,
}

unsafe extern "C" fn meter_process(data: *mut c_void) {
    let Some(pw) = pipewire() else {
        return;
    };
    let meter = &*data.cast::<MeterData>();
    let buffer = (pw.stream_dequeue_buffer)(meter.stream);
    if buffer.is_null() {
        return;
    }
    if let Some(spa) = (*buffer).buffer.as_ref().filter(|spa| spa.n_datas > 0) {
        let plane = &*spa.datas;
        if let (false, Some(chunk)) = (plane.data.is_null(), plane.chunk.as_ref()) {
            let offset = chunk.offset.min(plane.maxsize) as usize;
            let size = (chunk.size as usize).min(plane.maxsize as usize - offset);
            let bytes = std::slice::from_raw_parts(plane.data.cast::<u8>().add(offset), size);
            let loudest = bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|sample| f32::from_ne_bytes(*sample))
                .fold(0f32, |loudest, sample| loudest.max(sample.abs()))
                .clamp(0.0, 1.0);
            // Non-negative floats order like their bit patterns.
            meter.peak.fetch_max(loudest.to_bits(), Ordering::Relaxed);
        }
    }
    (pw.stream_queue_buffer)(meter.stream, buffer);
}

unsafe fn owned_string(value: *const c_char) -> Option<String> {
    (!value.is_null())
        .then(|| CStr::from_ptr(value).to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
}

unsafe fn lookup(dict: *const SpaDict, key: &str) -> Option<String> {
    let dict = dict.as_ref()?;
    if dict.items.is_null() {
        return None;
    }
    std::slice::from_raw_parts(dict.items, dict.n_items as usize)
        .iter()
        .find(|item| !item.key.is_null() && CStr::from_ptr(item.key).to_bytes() == key.as_bytes())
        .and_then(|item| owned_string(item.value))
}

unsafe fn signal(state: &State) {
    (state.pw.thread_loop_signal)(state.thread_loop, false);
}

unsafe extern "C" fn core_done(data: *mut c_void, id: u32, seq: c_int) {
    let state = &mut *data.cast::<State>();
    if id == PW_ID_CORE {
        state.synced = seq;
        signal(state);
    }
}

unsafe extern "C" fn core_error(
    data: *mut c_void,
    id: u32,
    _seq: c_int,
    _res: c_int,
    message: *const c_char,
) {
    // Errors on other ids answer a bind to a global that just went away.
    let state = &mut *data.cast::<State>();
    if id == PW_ID_CORE {
        state.error = Some(owned_string(message).unwrap_or_else(|| "unknown error".into()));
        signal(state);
    }
}

unsafe extern "C" fn registry_global(
    data: *mut c_void,
    id: u32,
    _permissions: u32,
    kind: *const c_char,
    _version: u32,
    props: *const SpaDict,
) {
    let state = &mut *data.cast::<State>();
    if kind.is_null() {
        return;
    }
    let kind = CStr::from_ptr(kind);
    if kind == INTERFACE_NODE {
        let (Some(name), Some(class)) = (
            lookup(props, "node.name"),
            lookup(props, "media.class")
                .as_deref()
                .and_then(NodeClass::from_media_class),
        ) else {
            return;
        };
        let description = lookup(props, "node.description")
            .or_else(|| lookup(props, "node.nick"))
            .unwrap_or_else(|| name.clone());
        state.nodes.insert(
            id,
            Node {
                serial: lookup(props, "object.serial").and_then(|serial| serial.parse().ok()),
                class,
                name,
                description,
                application_name: lookup(props, "application.name"),
                binary: None,
                process_id: None,
                client: lookup(props, "client.id").and_then(|client| client.parse().ok()),
            },
        );
        // The binary and process are only in the node's full properties.
        if class == NodeClass::Playback {
            bind(
                state,
                id,
                INTERFACE_NODE,
                PW_VERSION_NODE,
                ptr::addr_of!(NODE_EVENTS).cast(),
            );
        }
    } else if kind == INTERFACE_CLIENT {
        state.clients.insert(id, ClientProps::default());
        bind(
            state,
            id,
            INTERFACE_CLIENT,
            PW_VERSION_CLIENT,
            ptr::addr_of!(CLIENT_EVENTS).cast(),
        );
    } else if kind == INTERFACE_METADATA
        && lookup(props, "metadata.name").as_deref() == Some("default")
    {
        state.metadata = Some(id);
        bind(
            state,
            id,
            INTERFACE_METADATA,
            PW_VERSION_METADATA,
            ptr::addr_of!(METADATA_EVENTS).cast(),
        );
    }
}

unsafe extern "C" fn registry_global_remove(data: *mut c_void, id: u32) {
    let state = &mut *data.cast::<State>();
    state.nodes.remove(&id);
    state.clients.remove(&id);
    if state.metadata == Some(id) {
        state.metadata = None;
        state.default_sink = None;
        state.default_source = None;
    }
    if let Some(bound) = state.bound.remove(&id) {
        // Destroying the proxy unhooks its listener before `bound` frees it.
        (state.pw.proxy_destroy)(bound.proxy);
    }
}

/// Binds a global and listens for its info. Runs on the loop thread.
unsafe fn bind(state: &mut State, id: u32, kind: &CStr, version: u32, events: *const c_void) {
    let interface = &*state.registry.cast::<SpaInterface>();
    let methods = &*interface.cb.funcs.cast::<RegistryMethods>();
    let Some(bind) = methods.bind else {
        return;
    };
    let proxy = bind(interface.cb.data, id, kind.as_ptr(), version, 0);
    if proxy.is_null() {
        return;
    }
    let target = Box::new(Target {
        state: state as *mut State,
        global: id,
    });
    let hook = Hook::new();
    add_listener(
        proxy,
        &hook,
        events,
        (&*target as *const Target).cast_mut().cast(),
    );
    state.bound.insert(
        id,
        Bound {
            proxy,
            _hook: hook,
            _target: target,
        },
    );
}

unsafe extern "C" fn node_info(data: *mut c_void, info: *const NodeInfo) {
    let target = &*data.cast::<Target>();
    let Some(info) = info
        .as_ref()
        .filter(|info| info.change_mask & PW_NODE_CHANGE_MASK_PROPS != 0)
    else {
        return;
    };
    let state = &mut *target.state;
    if let Some(node) = state.nodes.get_mut(&target.global) {
        node.binary = lookup(info.props, "application.process.binary");
        node.process_id =
            lookup(info.props, "application.process.id").and_then(|id| id.parse().ok());
        if node.application_name.is_none() {
            node.application_name = lookup(info.props, "application.name");
        }
    }
}

unsafe extern "C" fn client_info(data: *mut c_void, info: *const ClientInfo) {
    let target = &*data.cast::<Target>();
    let Some(info) = info
        .as_ref()
        .filter(|info| info.change_mask & PW_CLIENT_CHANGE_MASK_PROPS != 0)
    else {
        return;
    };
    let state = &mut *target.state;
    if let Some(client) = state.clients.get_mut(&target.global) {
        client.binary = lookup(info.props, "application.process.binary");
        client.process_id = lookup(info.props, "application.process.id")
            .or_else(|| lookup(info.props, "pipewire.sec.pid"))
            .and_then(|id| id.parse().ok());
    }
}

/// The session manager's `default` metadata: the default sink and source as
/// `{"name": "<node.name>"}`. A null key clears every entry.
unsafe extern "C" fn metadata_property(
    data: *mut c_void,
    subject: u32,
    key: *const c_char,
    _kind: *const c_char,
    value: *const c_char,
) -> c_int {
    let target = &*data.cast::<Target>();
    let state = &mut *target.state;
    if subject != PW_ID_CORE {
        return 0;
    }
    let name = owned_string(value)
        .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
        .and_then(|value| value.get("name")?.as_str().map(str::to_string));
    match owned_string(key).as_deref() {
        Some("default.audio.sink") => state.default_sink = name,
        Some("default.audio.source") => state.default_source = name,
        None => {
            state.default_sink = None;
            state.default_source = None;
        }
        Some(_) => {}
    }
    0
}
