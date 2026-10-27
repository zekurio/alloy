//! libobs on Linux. OBS comes from a runtime folder (`ALLOY_OBS_RUNTIME_DIR`,
//! the layout of an installed prefix) or from the system. Capture uses
//! obs-vkcapture for games, the screen-sharing portal (Wayland) or OBS's X11
//! screen capture for displays, and obs-pipewire-audio-capture for devices
//! and applications.

use std::{
    env,
    ffi::{c_char, c_int, c_void, CStr, CString},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, Once},
    thread,
};

use libloading::Library;

use crate::{
    agent::{
        obs::load_symbol,
        platform::{
            audio_application_id_from_parts,
            linux::{
                audio_devices, audio_target, default_audio_device_id, render_node,
                render_node_labels,
                session::{display_session, DisplaySession},
                x11_screen_index,
            },
            primary_display_id, DetectedGame,
        },
    },
    protocol::SIDE_CAR_NAME,
    types::{
        RecordingAudioApplicationSelection, RecordingAudioDevice, RecordingAudioDeviceKind,
        RecordingSettings,
    },
};

use super::{sort_audio_devices, LibObs, ModulePaths, ObsData, ObsModuleSpec};

pub(in crate::agent) const GAME_CAPTURE_SOURCE_ID: &str = "vkcapture-source";
pub(in crate::agent) const AUDIO_OUTPUT_SOURCE_ID: &str = "pipewire_audio_output_capture";
pub(in crate::agent) const AUDIO_INPUT_SOURCE_ID: &str = "pipewire_audio_input_capture";
pub(in crate::agent) const APPLICATION_AUDIO_SOURCE_ID: &str = "pipewire_audio_application_capture";
/// The application name obs-pipewire-audio-capture matches, case-insensitively,
/// against a stream's binary or application name.
pub(in crate::agent) const APPLICATION_AUDIO_TARGET_KEY: &CStr = c"TargetName";
pub(in crate::agent) const APPLICATION_AUDIO_PRIORITY: Option<i64> = None;

/// The device sources' `TargetId` for following the default device.
const PW_ID_ANY: i64 = u32::MAX as i64;

const OBS_NIX_PLATFORM_X11_EGL: c_int = 1;
const OBS_NIX_PLATFORM_WAYLAND: c_int = 2;
/// OBS's muxer helper, which `ffmpeg_muxer` and `replay_buffer` start from the
/// folder of the running executable.
const MUX_HELPER: &str = "obs-ffmpeg-mux";
const RESTORE_TOKEN_FILE: &str = "screencast-restore-token";

pub(in crate::agent) fn libobs_candidates(runtime_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(runtime_dir) = runtime_dir {
        for directory in ["lib", "lib64", "bin/64bit", ""] {
            candidates.push(runtime_dir.join(directory).join("libobs.so.0"));
        }
    }
    candidates.push(PathBuf::from("libobs.so.0"));
    candidates.push(PathBuf::from("libobs.so"));
    candidates
}

/// Whether the loaded libobs, a canonical path, is one of the runtime
/// folder's. The Nix runtime links it, so compare where its copy resolves.
fn libobs_from_runtime(runtime_dir: &Path, libobs: &Path) -> bool {
    libobs_candidates(Some(runtime_dir))
        .iter()
        .filter(|candidate| candidate.starts_with(runtime_dir))
        .any(|candidate| fs::canonicalize(candidate).is_ok_and(|path| path == libobs))
}

/// The file a loaded symbol came from. A library opened by soname has no path
/// of its own, and its plugins and graphics module live beside it.
pub(in crate::agent) fn library_path(candidate: &Path, symbol: *const c_void) -> PathBuf {
    let mut info = libc::Dl_info {
        dli_fname: std::ptr::null(),
        dli_fbase: std::ptr::null_mut(),
        dli_sname: std::ptr::null(),
        dli_saddr: std::ptr::null_mut(),
    };
    // SAFETY: dladdr only reads the loader's tables for a mapped address.
    let found = unsafe { libc::dladdr(symbol, &mut info) } != 0 && !info.dli_fname.is_null();
    let path = if found {
        // SAFETY: dladdr returned a nul-terminated path owned by the loader.
        PathBuf::from(
            unsafe { CStr::from_ptr(info.dli_fname) }
                .to_string_lossy()
                .into_owned(),
        )
    } else {
        candidate.to_path_buf()
    };
    fs::canonicalize(&path).unwrap_or(path)
}

/// libobs opens its graphics module by soname, which a Nix-built libobs
/// cannot find on its own run path. The module beside libobs, by full path,
/// works everywhere.
pub(in crate::agent) fn graphics_module(libobs: &Path) -> CString {
    let beside = libobs.parent().and_then(|directory| {
        let mut modules: Vec<_> = fs::read_dir(directory)
            .ok()?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("libobs-opengl.so"))
            })
            .collect();
        modules.sort();
        modules.into_iter().next()
    });
    beside
        .and_then(|path| CString::new(path.to_string_lossy().into_owned()).ok())
        .unwrap_or_else(|| c"libobs-opengl".to_owned())
}

/// Where a module may be installed, in search order: the runtime folder,
/// `OBS_PLUGINS_PATH` (the variable Nix's OBS wrapper sets for plugins), the
/// prefix libobs was loaded from, the system, and the user's OBS plugins.
pub(in crate::agent) fn module_paths(
    runtime_dir: Option<&Path>,
    libobs: &Path,
    module: &str,
) -> Vec<ModulePaths> {
    let file = format!("{module}.so");
    // A libobs from the runtime folder only takes modules from that folder or
    // beside it. One from the system or the user's OBS Studio may be built for
    // another libobs, whose ABI isn't stable across versions.
    let pinned = runtime_dir.is_some_and(|runtime| libobs_from_runtime(runtime, libobs));
    let mut paths = Vec::new();
    let mut push = |bin: PathBuf, data: PathBuf| {
        if !paths.iter().any(|known: &ModulePaths| known.bin == bin) {
            paths.push(ModulePaths { bin, data });
        }
    };

    if let Some(runtime) = runtime_dir {
        for library in ["lib", "lib64"] {
            push(
                runtime.join(library).join("obs-plugins").join(&file),
                runtime.join("share/obs/obs-plugins").join(module),
            );
        }
        push(
            runtime.join("obs-plugins/64bit").join(&file),
            runtime.join("data/obs-plugins").join(module),
        );
    }

    if let (false, Some(bin), Some(data)) = (
        pinned,
        env::var_os("OBS_PLUGINS_PATH"),
        env::var_os("OBS_PLUGINS_DATA_PATH"),
    ) {
        push(
            PathBuf::from(bin).join(&file),
            PathBuf::from(data).join(module),
        );
    }

    if let Some(library_dir) = libobs.parent() {
        let data_root = library_dir
            .ancestors()
            .map(|ancestor| ancestor.join("share/obs/obs-plugins"))
            .find(|data| data.is_dir())
            .unwrap_or_else(|| PathBuf::from("/usr/share/obs/obs-plugins"));
        push(
            library_dir.join("obs-plugins").join(&file),
            data_root.join(module),
        );
    }

    if pinned {
        return paths;
    }

    for (bin, data) in [
        ("/usr/lib/obs-plugins", "/usr/share/obs/obs-plugins"),
        ("/usr/lib64/obs-plugins", "/usr/share/obs/obs-plugins"),
        (
            "/usr/lib/x86_64-linux-gnu/obs-plugins",
            "/usr/share/obs/obs-plugins",
        ),
        (
            "/usr/local/lib/obs-plugins",
            "/usr/local/share/obs/obs-plugins",
        ),
    ] {
        push(Path::new(bin).join(&file), Path::new(data).join(module));
    }

    if let Some(config) = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    {
        let plugin = config.join("obs-studio/plugins").join(module);
        push(plugin.join("bin/64bit").join(&file), plugin.join("data"));
    }
    paths
}

pub(in crate::agent) fn platform_modules() -> &'static [ObsModuleSpec] {
    &[
        ObsModuleSpec {
            name: "obs-ffmpeg",
            required: true,
            capture: false,
        },
        ObsModuleSpec {
            name: "obs-x264",
            required: true,
            capture: false,
        },
        ObsModuleSpec {
            name: "obs-outputs",
            required: false,
            capture: false,
        },
        ObsModuleSpec {
            name: "obs-nvenc",
            required: false,
            capture: false,
        },
        ObsModuleSpec {
            name: "obs-qsv11",
            required: false,
            capture: false,
        },
        ObsModuleSpec {
            name: "linux-vkcapture",
            required: false,
            capture: true,
        },
        ObsModuleSpec {
            name: "linux-pipewire",
            required: false,
            capture: true,
        },
        ObsModuleSpec {
            name: "linux-capture",
            required: false,
            capture: true,
        },
        // obs-pipewire-audio-capture: every audio source, devices included.
        ObsModuleSpec {
            name: "linux-pipewire-audio",
            required: true,
            capture: true,
        },
    ]
}

/// The display connection libobs renders through, opened once per process
/// and kept for its lifetime, since libobs only borrows it.
pub(in crate::agent) struct NixDisplay {
    pub(in crate::agent) platform: c_int,
    pub(in crate::agent) display: *mut c_void,
}

struct DisplayConnection {
    platform: c_int,
    /// The `wl_display` or Xlib `Display` pointer.
    display: usize,
    _library: Library,
}

/// Only a connection that opened is kept: the session may not be up yet when
/// the agent starts, so the next OBS start tries again.
static DISPLAY_CONNECTION: Mutex<Option<DisplayConnection>> = Mutex::new(None);
static GLIB_MAIN_LOOP: Once = Once::new();

/// Connects libobs to the session and starts the GLib main loop the
/// screen-sharing portal answers on. Call with libobs loaded: its own
/// dependencies provide the Wayland, X11 and GLib libraries opened here.
pub(in crate::agent) fn prepare_display_session() -> Result<NixDisplay, String> {
    start_glib_main_loop();
    let mut connection = DISPLAY_CONNECTION
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if connection.is_none() {
        *connection = Some(connect_display()?);
    }
    let connection = connection.as_ref().expect("connected above");
    Ok(NixDisplay {
        platform: connection.platform,
        display: connection.display as *mut c_void,
    })
}

fn connect_display() -> Result<DisplayConnection, String> {
    // SAFETY: each library is loaded once and kept with the connection; the
    // calls take no arguments beyond a null display name.
    unsafe {
        match display_session() {
            Some(DisplaySession::Wayland) => {
                let library = Library::new("libwayland-client.so.0")
                    .map_err(|error| format!("Could not load libwayland-client: {error}"))?;
                let connect: unsafe extern "C" fn(*const c_char) -> *mut c_void =
                    load_symbol(&library, b"wl_display_connect\0")?;
                let display = connect(std::ptr::null());
                if display.is_null() {
                    return Err("Could not connect to the Wayland display.".into());
                }
                Ok(DisplayConnection {
                    platform: OBS_NIX_PLATFORM_WAYLAND,
                    display: display as usize,
                    _library: library,
                })
            }
            Some(DisplaySession::X11) => {
                let library = Library::new("libX11.so.6")
                    .map_err(|error| format!("Could not load libX11: {error}"))?;
                let init_threads: unsafe extern "C" fn() -> c_int =
                    load_symbol(&library, b"XInitThreads\0")?;
                let open: unsafe extern "C" fn(*const c_char) -> *mut c_void =
                    load_symbol(&library, b"XOpenDisplay\0")?;
                // libobs uses the display from its graphics thread.
                init_threads();
                let display = open(std::ptr::null());
                if display.is_null() {
                    return Err("Could not open the X11 display.".into());
                }
                Ok(DisplayConnection {
                    platform: OBS_NIX_PLATFORM_X11_EGL,
                    display: display as usize,
                    _library: library,
                })
            }
            None => Err("OBS needs a Wayland or X11 session to render.".into()),
        }
    }
}

/// The screen-sharing portal answers OBS's PipeWire capture over D-Bus on
/// GLib's default main context, which the OBS app iterates from its UI loop.
/// The agent has none, so a thread runs that context for the process.
fn start_glib_main_loop() {
    GLIB_MAIN_LOOP.call_once(|| {
        let library = match unsafe { Library::new("libglib-2.0.so.0") } {
            Ok(library) => library,
            Err(error) => {
                eprintln!(
                    "[{SIDE_CAR_NAME}] GLib unavailable, portal capture will not start: {error}"
                );
                return;
            }
        };
        thread::spawn(move || unsafe {
            let new_loop: Result<unsafe extern "C" fn(*mut c_void, c_int) -> *mut c_void, _> =
                load_symbol(&library, b"g_main_loop_new\0");
            let run: Result<unsafe extern "C" fn(*mut c_void), _> =
                load_symbol(&library, b"g_main_loop_run\0");
            let (Ok(new_loop), Ok(run)) = (new_loop, run) else {
                eprintln!("[{SIDE_CAR_NAME}] GLib main loop symbols are missing.");
                return;
            };
            let main_loop = new_loop(std::ptr::null_mut(), 0);
            if !main_loop.is_null() {
                run(main_loop);
            }
        });
    });
}

/// How display capture records on this session.
pub(in crate::agent) enum DisplayCaptureSource {
    /// The screen-sharing portal, restoring the last choice when it can.
    Portal { restore_token: Option<String> },
    /// An X11 screen by OBS's RandR index.
    X11Screen(i64),
}

pub(in crate::agent) fn display_capture_source(
    settings: &RecordingSettings,
) -> Result<DisplayCaptureSource, String> {
    match display_session() {
        Some(DisplaySession::Wayland) => Ok(DisplayCaptureSource::Portal {
            restore_token: stored_restore_token(),
        }),
        Some(DisplaySession::X11) => {
            // A stored id that no longer resolves, such as an unplugged
            // monitor or Wayland's `portal`, records the primary monitor.
            let selected = Some(settings.selected_display_id.trim())
                .filter(|id| !id.is_empty())
                .and_then(x11_screen_index);
            Ok(DisplayCaptureSource::X11Screen(
                selected
                    .or_else(|| primary_display_id().and_then(|id| x11_screen_index(&id)))
                    .unwrap_or(0),
            ))
        }
        None => Err("Display capture needs a Wayland or X11 session.".into()),
    }
}

static AGENT_STATE_FOLDER: Mutex<Option<PathBuf>> = Mutex::new(None);
/// The token last written, so the tick does not reread the file.
static REMEMBERED_RESTORE_TOKEN: Mutex<Option<String>> = Mutex::new(None);

pub(in crate::agent) fn set_agent_state_folder(folder: &Path) {
    *AGENT_STATE_FOLDER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(folder.to_path_buf());
}

fn restore_token_path() -> Option<PathBuf> {
    AGENT_STATE_FOLDER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .map(|folder| folder.join(RESTORE_TOKEN_FILE))
}

fn stored_restore_token() -> Option<String> {
    let token = fs::read_to_string(restore_token_path()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_string())
}

/// Keeps the portal's restore token, so the next session reopens the chosen
/// screen without asking. The portal issues a new token for every session
/// and OBS saves it into the source's settings once the screen is chosen.
///
/// # Safety
///
/// `source` must be a live display capture source of this libobs instance.
pub(in crate::agent) unsafe fn remember_display_restore_token(
    obs: &LibObs,
    source: *mut crate::agent::obs::bindings::ObsSource,
) {
    let Some(token) = obs.source_setting_string(source, c"RestoreToken") else {
        return;
    };
    let mut remembered = REMEMBERED_RESTORE_TOKEN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if remembered.as_deref() == Some(token.as_str()) {
        return;
    }
    let Some(path) = restore_token_path() else {
        return;
    };
    let temporary = path.with_extension("tmp");
    match write_private(&temporary, &token).and_then(|()| fs::rename(&temporary, &path)) {
        Ok(()) => *remembered = Some(token),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            eprintln!("[{SIDE_CAR_NAME}] could not keep the screen-sharing choice: {error}");
        }
    }
}

/// Writes `contents` to a new file only the user can read. The token lets a
/// process on the user's session bus reopen the screencast without the
/// dialog, so it is kept as private as the session itself.
fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};

    // A file left by an interrupted write could have looser permissions,
    // which opening it again would keep.
    let _ = fs::remove_file(path);
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?
        .write_all(contents.as_bytes())
}

/// OBS starts its muxer helper from the folder of the running executable, so
/// it has to be installed beside `alloy-agent`.
pub(in crate::agent) fn mux_helper_ready() -> Result<(), String> {
    let executable =
        env::current_exe().map_err(|error| format!("Could not locate alloy-agent: {error}"))?;
    let helper = executable
        .parent()
        .map(|folder| folder.join(MUX_HELPER))
        .ok_or("Could not locate the alloy-agent folder.")?;
    if helper.exists() {
        return Ok(());
    }
    Err(format!(
        "OBS's {MUX_HELPER} helper is missing. Install it beside alloy-agent at {}.",
        helper.display()
    ))
}

/// Devices from PipeWire. OBS can't list them instead: the device sources
/// only know their nodes once created.
pub(in crate::agent) fn platform_audio_devices(
    _obs: Option<&LibObs>,
) -> Result<Vec<RecordingAudioDevice>, String> {
    let mut devices = audio_devices()?;
    sort_audio_devices(&mut devices);
    Ok(devices)
}

/// Points a device source at `device_id`. `default` follows the default
/// device; any other `TargetId` makes the source reconnect to the node named
/// `TargetName` whenever it appears, since node ids change between sessions.
///
/// # Safety
///
/// `settings` must be a live OBS data object.
pub(in crate::agent) unsafe fn set_audio_device(
    obs: &LibObs,
    settings: *mut ObsData,
    device_id: &str,
) -> Result<(), String> {
    if device_id == "default" {
        obs.set_int(settings, c"TargetId", PW_ID_ANY);
        return Ok(());
    }
    obs.set_int(settings, c"TargetId", 0);
    obs.set_string(settings, c"TargetName", device_id)
}

pub(in crate::agent) fn platform_default_audio_device_id(
    kind: &RecordingAudioDeviceKind,
) -> Option<String> {
    default_audio_device_id(kind)
}

/// GPUs as `adapter:{index}:{label}`, by DRM render node.
pub(in crate::agent) fn platform_gpus() -> Option<Vec<String>> {
    let gpus: Vec<_> = render_node_labels()
        .into_iter()
        .enumerate()
        .map(|(index, label)| format!("adapter:{index}:{label}"))
        .collect();
    (!gpus.is_empty()).then_some(gpus)
}

/// The render node VAAPI encodes on for the selected adapter.
pub(in crate::agent) fn vaapi_device(adapter: u32) -> Option<String> {
    render_node(adapter)
}

pub(in crate::agent) fn audio_application_from_game(
    game: &DetectedGame,
    enabled: bool,
) -> Option<RecordingAudioApplicationSelection> {
    let target = audio_target(game)?;
    // The id and executable match what the application list shows for the
    // game's stream; only the capture target is the raw binary.
    let executable = game
        .game
        .executable
        .clone()
        .unwrap_or_else(|| target.clone());
    Some(RecordingAudioApplicationSelection {
        id: audio_application_id_from_parts(Some(&executable), None, game.game.process_id),
        name: game.game.name.clone(),
        window: target,
        executable: Some(executable),
        icon_url: None,
        process_id: Some(game.game.process_id),
        enabled,
        volume: 100,
    })
}
