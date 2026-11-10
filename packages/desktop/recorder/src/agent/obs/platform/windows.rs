use std::{
    ffi::{c_void, CStr, CString},
    path::{Path, PathBuf},
};

use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows_sys::Win32::Media::Audio::{eCapture, eRender};

use crate::{
    agent::platform::{
        audio_application_id_from_parts,
        com::{
            active_audio_endpoint_devices, create_mm_device_enumerator, default_endpoint_id,
            endpoint_friendly_name, endpoint_id, ComApartment, ComPtr,
        },
        DetectedGame,
    },
    types::{RecordingAudioApplicationSelection, RecordingAudioDevice, RecordingAudioDeviceKind},
};

use super::{sort_audio_devices, LibObs, ModulePaths, ObsData, ObsModuleSpec};

pub(in crate::agent) const GAME_CAPTURE_SOURCE_ID: &str = "game_capture";
pub(in crate::agent) const AUDIO_OUTPUT_SOURCE_ID: &str = "wasapi_output_capture";
pub(in crate::agent) const AUDIO_INPUT_SOURCE_ID: &str = "wasapi_input_capture";
pub(in crate::agent) const APPLICATION_AUDIO_SOURCE_ID: &str = "wasapi_process_output_capture";
/// The application audio source's `title:class:exe` window setting.
pub(in crate::agent) const APPLICATION_AUDIO_TARGET_KEY: &CStr = c"window";
/// Match application windows by executable first.
pub(in crate::agent) const APPLICATION_AUDIO_PRIORITY: Option<i64> = Some(2);

/// The active WASAPI endpoints, which are the devices OBS's own sources
/// offer. Listing them needs no running OBS, so the settings can show them
/// while recording is off.
pub(in crate::agent) fn platform_audio_devices() -> Result<Vec<RecordingAudioDevice>, String> {
    let _com = ComApartment::initialize()
        .ok_or_else(|| "Could not initialize COM for audio-device discovery.".to_string())?;
    // SAFETY: COM is initialized on this thread until `_com` drops, after
    // every interface the enumeration creates.
    unsafe { enumerate_active_audio_devices() }
}

/// GPU choices as `adapter:{index}:{name}`, or `None` when DXGI listed no
/// hardware adapter.
pub(in crate::agent) fn platform_gpus() -> Option<Vec<String>> {
    let gpus: Vec<_> = dxgi_adapter_names()
        .into_iter()
        .enumerate()
        .map(|(index, label)| format!("adapter:{index}:{label}"))
        .collect();
    (!gpus.is_empty()).then_some(gpus)
}

/// Adapter names in DXGI's order, so that a name's position is the index
/// libobs-d3d11 opens that adapter by. The software adapters Windows lists
/// last are left off. One listed before a real adapter stays, since dropping
/// it would shift every position after it.
fn dxgi_adapter_names() -> Vec<String> {
    // SAFETY: DXGI needs no COM apartment, and the factory and each adapter
    // are released when their wrappers drop.
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };
    let mut adapters = Vec::new();
    // Enumeration ends with DXGI_ERROR_NOT_FOUND.
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(adapters.len() as u32) } {
        let Ok(description) = (unsafe { adapter.GetDesc1() }) else {
            break;
        };
        let name = &description.Description;
        let length = name
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(name.len());
        let software = description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0;
        adapters.push((String::from_utf16_lossy(&name[..length]), software));
    }
    while adapters.last().is_some_and(|(_, software)| *software) {
        adapters.pop();
    }
    adapters.into_iter().map(|(name, _)| name).collect()
}

unsafe fn enumerate_active_audio_devices() -> Result<Vec<RecordingAudioDevice>, String> {
    let enumerator = create_mm_device_enumerator()
        .ok_or_else(|| "Could not create the Windows audio-device enumerator.".to_string())?;
    let mut devices = Vec::new();

    collect_active_audio_devices(
        &enumerator,
        eRender,
        RecordingAudioDeviceKind::Output,
        &mut devices,
    )?;
    collect_active_audio_devices(
        &enumerator,
        eCapture,
        RecordingAudioDeviceKind::Input,
        &mut devices,
    )?;

    sort_audio_devices(&mut devices);
    Ok(devices)
}

unsafe fn collect_active_audio_devices(
    enumerator: &ComPtr,
    data_flow: i32,
    kind: RecordingAudioDeviceKind,
    devices: &mut Vec<RecordingAudioDevice>,
) -> Result<(), String> {
    let Some(audio_devices) = active_audio_endpoint_devices(enumerator, data_flow) else {
        return Err(format!(
            "Windows audio endpoint enumeration failed for {kind:?}."
        ));
    };
    for device in audio_devices {
        let Some(id) = endpoint_id(&device) else {
            continue;
        };
        devices.push(RecordingAudioDevice {
            label: endpoint_friendly_name(&device).unwrap_or_else(|| id.clone()),
            id,
            kind: kind.clone(),
        });
    }
    Ok(())
}

pub(in crate::agent) fn platform_default_audio_device_id(
    kind: &RecordingAudioDeviceKind,
) -> Option<String> {
    let _com = ComApartment::initialize()?;
    // SAFETY: COM stays initialized until `_com` drops, after `enumerator`.
    unsafe {
        let enumerator = create_mm_device_enumerator()?;
        default_endpoint_id(&enumerator, kind)
    }
}

pub(in crate::agent) fn audio_application_from_game(
    game: &DetectedGame,
    enabled: bool,
) -> Option<RecordingAudioApplicationSelection> {
    let window = game.obs_window.clone()?;
    Some(RecordingAudioApplicationSelection {
        id: audio_application_id(game),
        name: game.game.name.clone(),
        window,
        executable: game.game.executable.clone(),
        icon_url: None,
        process_id: Some(game.game.process_id),
        enabled,
        volume: 100,
    })
}

fn audio_application_id(game: &DetectedGame) -> String {
    audio_application_id_from_parts(
        game.game.executable.as_deref(),
        game.game.window_class.as_deref(),
        game.game.process_id,
    )
}

/// Points a WASAPI source at an endpoint id, or at `default`.
///
/// # Safety
///
/// `settings` must be a live OBS data object.
pub(in crate::agent) unsafe fn set_audio_device(
    obs: &LibObs,
    settings: *mut ObsData,
    device_id: &str,
) -> Result<(), String> {
    obs.set_string(settings, c"device_id", device_id)
}

pub(in crate::agent) fn libobs_candidates(runtime_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(runtime_dir) = runtime_dir {
        candidates.push(runtime_dir.join("bin/64bit/obs.dll"));
        candidates.push(runtime_dir.join("bin/obs.dll"));
        candidates.push(runtime_dir.join("obs.dll"));
    }

    candidates.push(PathBuf::from("obs.dll"));
    candidates
}

/// libobs as loaded; Windows needs no more than the candidate that loaded.
pub(in crate::agent) fn library_path(candidate: &Path, _symbol: *const c_void) -> PathBuf {
    candidate.to_path_buf()
}

pub(in crate::agent) fn graphics_module(_libobs: &Path) -> CString {
    c"libobs-d3d11".to_owned()
}

/// The runtime folder whose data and module paths libobs may use. Windows
/// adds the bundled folder whatever libobs loaded.
pub(in crate::agent) fn own_runtime_dir<'a>(
    runtime_dir: Option<&'a Path>,
    _libobs: &Path,
) -> Option<&'a Path> {
    runtime_dir
}

/// Where a module from `platform_modules` lives in the bundled runtime.
/// Without a runtime, OBS loads every module from its own search paths.
pub(in crate::agent) fn module_paths(
    runtime_dir: Option<&Path>,
    _libobs: &Path,
    module: &str,
) -> Vec<ModulePaths> {
    runtime_dir
        .map(|runtime_dir| ModulePaths {
            bin: runtime_dir
                .join("obs-plugins/64bit")
                .join(format!("{module}.dll")),
            data: runtime_dir.join("data/obs-plugins").join(module),
        })
        .into_iter()
        .collect()
}

pub(in crate::agent) fn platform_modules() -> &'static [ObsModuleSpec] {
    &[
        ObsModuleSpec {
            name: "obs-ffmpeg",
            required: true,
            capture: false,
        },
        ObsModuleSpec {
            name: "obs-outputs",
            required: true,
            capture: false,
        },
        ObsModuleSpec {
            name: "obs-x264",
            required: true,
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
            name: "coreaudio-encoder",
            required: false,
            capture: false,
        },
        ObsModuleSpec {
            name: "win-capture",
            required: true,
            capture: true,
        },
        ObsModuleSpec {
            name: "win-wasapi",
            required: true,
            capture: true,
        },
    ]
}
