//! The platform half of the OBS backend: where libobs and its modules live,
//! the source ids and settings each platform's capture plugins use, and the
//! audio and GPU inventory those sources select from.

use std::{
    collections::{HashMap, HashSet},
    ffi::CString,
    path::{Path, PathBuf},
    ptr,
};

use crate::{
    agent::platform::audio_applications,
    types::{RecordingAudioApplicationSelection, RecordingAudioDevice, RecordingAudioDeviceKind},
};

use super::bindings::{CallData, LibObs, ObsData};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
pub(in crate::agent) use linux::{
    audio_application_from_game, display_capture_source, forget_screencast_declined,
    graphics_module, libobs_candidates, library_path, module_paths, mux_helper_ready,
    observe_obs_log, own_runtime_dir, platform_audio_devices, platform_default_audio_device_id,
    platform_gpus, platform_modules, prepare_display_session, remember_display_restore_token,
    screencast_declined, set_agent_state_folder, set_audio_device, vaapi_device,
    DisplayCaptureSource, APPLICATION_AUDIO_PRIORITY, APPLICATION_AUDIO_SOURCE_ID,
    APPLICATION_AUDIO_TARGET_KEY, AUDIO_INPUT_SOURCE_ID, AUDIO_OUTPUT_SOURCE_ID,
    GAME_CAPTURE_SOURCE_ID,
};
#[cfg(windows)]
pub(in crate::agent) use windows::{
    audio_application_from_game, graphics_module, libobs_candidates, library_path, module_paths,
    normalized_device_id, own_runtime_dir, platform_audio_devices,
    platform_default_audio_device_id, platform_gpus, platform_modules, set_audio_device,
    APPLICATION_AUDIO_PRIORITY, APPLICATION_AUDIO_SOURCE_ID, APPLICATION_AUDIO_TARGET_KEY,
    AUDIO_INPUT_SOURCE_ID, AUDIO_OUTPUT_SOURCE_ID, GAME_CAPTURE_SOURCE_ID,
};

pub(in crate::agent) struct ObsModuleSpec {
    pub(in crate::agent) name: &'static str,
    pub(in crate::agent) required: bool,
    /// Capture sources, which an encoder probe does not load.
    pub(in crate::agent) capture: bool,
}

/// One place a module may be installed: its binary and its data folder.
pub(in crate::agent) struct ModulePaths {
    pub(in crate::agent) bin: PathBuf,
    pub(in crate::agent) data: PathBuf,
}

pub(in crate::agent) fn dedupe_audio_devices(
    devices: Vec<RecordingAudioDevice>,
) -> Vec<RecordingAudioDevice> {
    let mut seen = HashSet::new();
    devices
        .into_iter()
        .filter(|device| seen.insert((device.kind.clone(), device.id.clone())))
        .collect()
}

pub(in crate::agent) fn sort_audio_devices(devices: &mut [RecordingAudioDevice]) {
    devices.sort_by(|a, b| {
        audio_device_kind_order(&a.kind)
            .cmp(&audio_device_kind_order(&b.kind))
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn audio_device_kind_order(kind: &RecordingAudioDeviceKind) -> u8 {
    match kind {
        RecordingAudioDeviceKind::Output => 0,
        RecordingAudioDeviceKind::Input => 1,
    }
}

pub(in crate::agent) fn available_audio_applications(
) -> HashMap<String, RecordingAudioApplicationSelection> {
    audio_applications()
        .into_iter()
        .map(|application| (application.id.clone(), application))
        .collect()
}

pub(in crate::agent) unsafe fn free_calldata(obs: &LibObs, data: &mut CallData) {
    if !data.fixed && !data.stack.is_null() {
        (obs.bfree)(data.stack.cast());
        data.stack = ptr::null_mut();
    }
    data.size = 0;
    data.capacity = 0;
}

pub(in crate::agent) fn cstring_path(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().replace('\\', "/").into_bytes())
        .map_err(|_| format!("Path contains a nul byte: {}", path.display()))
}
