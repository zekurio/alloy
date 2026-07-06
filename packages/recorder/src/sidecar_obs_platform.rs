use crate::sidecar_windows_com::{
    active_audio_endpoint_devices, create_mm_device_enumerator, endpoint_friendly_name,
    endpoint_id, initialize_com, uninitialize_com, ComPtr,
};
use windows_sys::Win32::Media::Audio::{eCapture, eRender};

fn default_audio_devices() -> Vec<RecordingAudioDeviceSelection> {
    vec![
        RecordingAudioDeviceSelection {
            id: "default".to_string(),
            label: "Default output".to_string(),
            kind: RecordingAudioDeviceKind::Output,
            enabled: true,
            volume: 100,
        },
        RecordingAudioDeviceSelection {
            id: "default".to_string(),
            label: "Default microphone".to_string(),
            kind: RecordingAudioDeviceKind::Input,
            enabled: false,
            volume: 100,
        },
        RecordingAudioDeviceSelection {
            id: "communications".to_string(),
            label: "Default communication output".to_string(),
            kind: RecordingAudioDeviceKind::Output,
            enabled: false,
            volume: 100,
        },
        RecordingAudioDeviceSelection {
            id: "communications".to_string(),
            label: "Default communication microphone".to_string(),
            kind: RecordingAudioDeviceKind::Input,
            enabled: false,
            volume: 100,
        },
    ]
}

fn dedupe_audio_devices(
    devices: Vec<RecordingAudioDeviceSelection>,
) -> Vec<RecordingAudioDeviceSelection> {
    let mut seen = HashSet::new();
    devices
        .into_iter()
        .filter(|device| seen.insert(format!("{:?}:{}", device.kind, device.id)))
        .collect()
}

fn platform_audio_devices() -> Vec<RecordingAudioDeviceSelection> {
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

fn windows_audio_devices() -> Vec<RecordingAudioDeviceSelection> {
    unsafe {
        let Some(uninitialize) = initialize_com() else {
            return Vec::new();
        };
        let devices = enumerate_active_audio_devices().unwrap_or_default();
        if uninitialize {
            uninitialize_com();
        }
        devices
    }
}

unsafe fn enumerate_active_audio_devices() -> Option<Vec<RecordingAudioDeviceSelection>> {
    let enumerator = create_mm_device_enumerator()?;
    let mut devices = Vec::new();

    collect_active_audio_devices(
        &enumerator,
        eRender,
        RecordingAudioDeviceKind::Output,
        &mut devices,
    );
    collect_active_audio_devices(
        &enumerator,
        eCapture,
        RecordingAudioDeviceKind::Input,
        &mut devices,
    );

    Some(devices)
}

unsafe fn collect_active_audio_devices(
    enumerator: &ComPtr,
    data_flow: i32,
    kind: RecordingAudioDeviceKind,
    devices: &mut Vec<RecordingAudioDeviceSelection>,
) {
    let Some(audio_devices) = active_audio_endpoint_devices(enumerator, data_flow) else {
        return;
    };
    for device in audio_devices {
        let Some(id) = endpoint_id(&device) else {
            continue;
        };
        devices.push(RecordingAudioDeviceSelection {
            label: endpoint_friendly_name(&device).unwrap_or_else(|| id.clone()),
            id,
            kind: kind.clone(),
            enabled: false,
            volume: 100,
        });
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
