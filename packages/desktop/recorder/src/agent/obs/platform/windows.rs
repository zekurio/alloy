use std::{
    ffi::{c_void, CStr, CString},
    path::{Path, PathBuf},
};

use serde_json::Value;
use windows_sys::Win32::Media::Audio::{eCapture, eRender};

use crate::{
    agent::platform::{
        audio_application_id_from_parts,
        com::{
            active_audio_endpoint_devices, create_mm_device_enumerator, default_endpoint_id,
            endpoint_friendly_name, endpoint_id, ComApartment, ComPtr,
        },
        command_output, DetectedGame,
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

pub(in crate::agent) fn platform_audio_devices(
    obs: Option<&LibObs>,
) -> Result<Vec<RecordingAudioDevice>, String> {
    if let Some(obs) = obs {
        // SAFETY: The caller only supplies a started libobs instance. Property
        // handles are owned and destroyed inside `audio_devices`.
        return unsafe { obs.audio_devices() };
    }
    windows_audio_devices()
}

/// GPU choices as `adapter:{index}:{name}`, or `None` when Windows reported
/// no video controller.
pub(in crate::agent) fn platform_gpus() -> Option<Vec<String>> {
    let gpus: Vec<_> = platform_gpu_labels()
        .into_iter()
        .enumerate()
        .map(|(index, label)| format!("adapter:{index}:{label}"))
        .collect();
    (!gpus.is_empty()).then_some(gpus)
}

fn platform_gpu_labels() -> Vec<String> {
    let script =
        "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress";
    let Some(output) = command_output(
        "powershell.exe",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
    ) else {
        return Vec::new();
    };

    let Ok(value) = serde_json::from_str::<Value>(&output) else {
        return Vec::new();
    };
    match value {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|entry| entry.get("Name")?.as_str().map(str::to_string))
            .collect(),
        Value::Object(object) => object
            .get("Name")
            .and_then(Value::as_str)
            .map(|name| vec![name.to_string()])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn windows_audio_devices() -> Result<Vec<RecordingAudioDevice>, String> {
    let _com = ComApartment::initialize()
        .ok_or_else(|| "Could not initialize COM for audio-device discovery.".to_string())?;
    // SAFETY: COM is initialized on this thread until `_com` drops, after
    // every interface the enumeration creates.
    unsafe { enumerate_active_audio_devices() }
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

/// WASAPI endpoint ids are case-insensitive GUID paths; the settings store
/// them in lowercase.
pub(in crate::agent) fn normalized_device_id(id: &str) -> String {
    id.to_ascii_lowercase()
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
