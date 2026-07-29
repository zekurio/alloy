use crate::sidecar_windows_com::{
    active_audio_endpoint_devices, create_mm_device_enumerator, default_endpoint_id,
    endpoint_friendly_name, endpoint_id, initialize_com, uninitialize_com, ComPtr,
};
use windows_sys::Win32::Media::Audio::{eCapture, eCommunications, eConsole, eRender};

fn default_audio_devices() -> Vec<RecordingAudioDevice> {
    vec![
        RecordingAudioDevice {
            id: "default".to_string(),
            label: "Default output".to_string(),
            kind: RecordingAudioDeviceKind::Output,
        },
        RecordingAudioDevice {
            id: "default".to_string(),
            label: "Default microphone".to_string(),
            kind: RecordingAudioDeviceKind::Input,
        },
    ]
}

fn default_audio_device_selections() -> Vec<RecordingAudioDeviceSelection> {
    default_audio_devices()
        .into_iter()
        .map(|device| RecordingAudioDeviceSelection {
            enabled: device.kind == RecordingAudioDeviceKind::Output,
            volume: 100,
            id: device.id,
            label: device.label,
            kind: device.kind,
        })
        .collect()
}

fn dedupe_audio_devices(devices: Vec<RecordingAudioDevice>) -> Vec<RecordingAudioDevice> {
    let mut seen = HashSet::new();
    devices
        .into_iter()
        .filter(|device| seen.insert((device.kind.clone(), device.id.clone())))
        .collect()
}

fn platform_audio_devices(obs: Option<&LibObs>) -> Result<Vec<RecordingAudioDevice>, String> {
    if let Some(obs) = obs {
        // SAFETY: The caller only supplies a started libobs instance. Property
        // handles are owned and destroyed inside `audio_devices`.
        return unsafe { obs.audio_devices() };
    }
    windows_audio_devices()
}

fn platform_gpus() -> Vec<String> {
    let gpus = platform_gpu_labels();
    if gpus.is_empty() {
        vec!["adapter:0".to_string()]
    } else {
        gpus.into_iter()
            .enumerate()
            .map(|(index, label)| format!("adapter:{index}:{label}"))
            .collect()
    }
}

fn platform_gpu_labels() -> Vec<String> {
    let script = "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress";
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
    unsafe {
        let Some(uninitialize) = initialize_com() else {
            return Err("Could not initialize COM for audio-device discovery.".to_string());
        };
        let devices = enumerate_active_audio_devices();
        if uninitialize {
            uninitialize_com();
        }
        devices
    }
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
        return Err(format!("Windows audio endpoint enumeration failed for {kind:?}."));
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

fn sort_audio_devices(devices: &mut [RecordingAudioDevice]) {
    devices.sort_by(|a, b| {
        audio_device_kind_order(&a.kind)
            .cmp(&audio_device_kind_order(&b.kind))
            .then_with(|| {
                a.label
                    .to_lowercase()
                    .cmp(&b.label.to_lowercase())
            })
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn audio_device_kind_order(kind: &RecordingAudioDeviceKind) -> u8 {
    match kind {
        RecordingAudioDeviceKind::Output => 0,
        RecordingAudioDeviceKind::Input => 1,
    }
}

fn platform_default_audio_device_id(kind: &RecordingAudioDeviceKind) -> Option<String> {
    unsafe {
        let uninitialize = initialize_com()?;
        let enumerator = create_mm_device_enumerator();
        let id = enumerator.as_ref().and_then(|enumerator| {
            let (data_flow, role) = default_audio_endpoint_selector(kind);
            default_endpoint_id(enumerator, data_flow, role)
        });
        if uninitialize {
            uninitialize_com();
        }
        id
    }
}

fn default_audio_endpoint_selector(kind: &RecordingAudioDeviceKind) -> (i32, i32) {
    match kind {
        RecordingAudioDeviceKind::Output => (eRender, eConsole),
        RecordingAudioDeviceKind::Input => (eCapture, eCommunications),
    }
}

fn audio_application_from_game(
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

fn audio_application_id_from_parts(
    executable: Option<&str>,
    class_name: Option<&str>,
    process_id: u32,
) -> String {
    if let Some(executable) = executable {
        return format!("exe:{}", executable.to_ascii_lowercase());
    }
    if let Some(class_name) = class_name {
        return format!("class:{}", class_name.to_ascii_lowercase());
    }
    format!("process:{process_id}")
}

fn obs_window_selector(title: &str, class_name: &str, executable: &str) -> String {
    format!(
        "{}:{}:{}",
        obs_window_selector_component(title),
        obs_window_selector_component(class_name),
        obs_window_selector_component(executable)
    )
}

fn obs_window_selector_component(value: &str) -> String {
    value.replace('#', "#22").replace(':', "#3A")
}

fn available_audio_applications(
    _game: Option<&DetectedGame>,
) -> HashMap<String, RecordingAudioApplicationSelection> {
    platform_audio_applications()
        .into_iter()
        .map(|application| (application.id.clone(), application))
        .collect()
}

unsafe fn free_calldata(obs: &LibObs, data: &mut CallData) {
    if !data.fixed && !data.stack.is_null() {
        (obs.bfree)(data.stack.cast());
        data.stack = ptr::null_mut();
    }
    data.size = 0;
    data.capacity = 0;
}

fn libobs_candidates(runtime_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(runtime_dir) = runtime_dir {
        candidates.push(runtime_dir.join("bin/64bit/obs.dll"));
        candidates.push(runtime_dir.join("bin/obs.dll"));
        candidates.push(runtime_dir.join("obs.dll"));
    }

    candidates.push(PathBuf::from("obs.dll"));
    candidates
}

fn module_bin_path(runtime_dir: &Path, module: &str) -> PathBuf {
    runtime_dir
        .join("obs-plugins/64bit")
        .join(format!("{module}.dll"))
}

struct ObsModuleSpec {
    name: &'static str,
    required: bool,
}

fn platform_modules() -> &'static [ObsModuleSpec] {
    &[
        ObsModuleSpec {
            name: "obs-ffmpeg",
            required: true,
        },
        ObsModuleSpec {
            name: "obs-outputs",
            required: true,
        },
        ObsModuleSpec {
            name: "obs-x264",
            required: true,
        },
        ObsModuleSpec {
            name: "obs-nvenc",
            required: false,
        },
        ObsModuleSpec {
            name: "obs-qsv11",
            required: false,
        },
        ObsModuleSpec {
            name: "coreaudio-encoder",
            required: false,
        },
        ObsModuleSpec {
            name: "win-capture",
            required: true,
        },
        ObsModuleSpec {
            name: "win-wasapi",
            required: true,
        },
    ]
}

fn platform_graphics_module() -> &'static str {
    "libobs-d3d11"
}

fn platform_display_source_id() -> &'static str {
    "monitor_capture"
}

fn platform_audio_output_source_id() -> &'static str {
    "wasapi_output_capture"
}

fn platform_audio_input_source_id() -> &'static str {
    "wasapi_input_capture"
}

fn platform_application_audio_source_id() -> Option<&'static str> {
    Some("wasapi_process_output_capture")
}

fn cstring_path(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().replace('\\', "/").into_bytes())
        .map_err(|_| format!("Path contains a nul byte: {}", path.display()))
}
