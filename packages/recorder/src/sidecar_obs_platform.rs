fn default_audio_devices() -> Vec<RecordingAudioDeviceSelection> {
    let devices = vec![
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
    ];

    #[cfg(target_os = "windows")]
    {
        let mut devices = devices;
        devices.push(RecordingAudioDeviceSelection {
            id: "communications".to_string(),
            label: "Default communication output".to_string(),
            kind: RecordingAudioDeviceKind::Output,
            enabled: false,
            volume: 100,
        });
        devices.push(RecordingAudioDeviceSelection {
            id: "communications".to_string(),
            label: "Default communication microphone".to_string(),
            kind: RecordingAudioDeviceKind::Input,
            enabled: false,
            volume: 100,
        });
        devices
    }

    #[cfg(not(target_os = "windows"))]
    devices
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
    #[cfg(target_os = "windows")]
    {
        windows_audio_devices()
    }
    #[cfg(target_os = "linux")]
    {
        linux_audio_devices()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Vec::new()
    }
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

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "linux")]
fn platform_gpu_labels() -> Vec<String> {
    let Some(output) = command_output("lspci", &[]) else {
        return Vec::new();
    };

    output
        .lines()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("vga compatible controller")
                || lower.contains("3d controller")
                || lower.contains("display controller")
        })
        .map(|line| line.split_once(':').map(|(_, label)| label).unwrap_or(line).trim())
        .filter(|label| !label.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn platform_gpu_labels() -> Vec<String> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn windows_audio_devices() -> Vec<RecordingAudioDeviceSelection> {
    let script = "Get-CimInstance Win32_PnPEntity -Filter \"PNPClass = 'AudioEndpoint'\" | Select-Object Name,PNPDeviceID | ConvertTo-Json -Compress";
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
    let entries: Vec<&Value> = match &value {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![&value],
        _ => Vec::new(),
    };

    entries
        .into_iter()
        .filter_map(|entry| {
            let label = entry.get("Name")?.as_str()?.to_string();
            let pnp_id = entry.get("PNPDeviceID")?.as_str()?;
            let id = pnp_id.rsplit('\\').next().unwrap_or(pnp_id).to_lowercase();
            let kind = if id.starts_with("{0.0.0.00000000}") {
                RecordingAudioDeviceKind::Output
            } else {
                RecordingAudioDeviceKind::Input
            };

            Some(RecordingAudioDeviceSelection {
                id,
                label,
                kind,
                enabled: false,
                volume: 100,
            })
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn linux_audio_devices() -> Vec<RecordingAudioDeviceSelection> {
    let mut devices = Vec::new();
    devices.extend(linux_pactl_audio_devices(
        "sinks",
        RecordingAudioDeviceKind::Output,
    ));
    devices.extend(linux_pactl_audio_devices(
        "sources",
        RecordingAudioDeviceKind::Input,
    ));
    devices
}

#[cfg(target_os = "linux")]
fn linux_pactl_audio_devices(
    target: &str,
    kind: RecordingAudioDeviceKind,
) -> Vec<RecordingAudioDeviceSelection> {
    let Some(output) = command_output("pactl", &["list", "short", target]) else {
        return Vec::new();
    };

    output
        .lines()
        .filter_map(|line| {
            let mut columns = line.split('\t');
            let _index = columns.next()?;
            let id = columns.next()?.trim();
            if id.is_empty() {
                return None;
            }

            Some(RecordingAudioDeviceSelection {
                id: id.to_string(),
                label: id.to_string(),
                kind: kind.clone(),
                enabled: false,
                volume: 100,
            })
        })
        .collect()
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
        #[cfg(target_os = "windows")]
        {
            candidates.push(runtime_dir.join("bin/64bit/obs.dll"));
            candidates.push(runtime_dir.join("bin/obs.dll"));
            candidates.push(runtime_dir.join("obs.dll"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(runtime_dir.join("lib/libobs.so"));
            candidates.push(runtime_dir.join("lib/libobs.so.0"));
            candidates.push(runtime_dir.join("lib64/libobs.so"));
            candidates.push(runtime_dir.join("bin/64bit/libobs.so"));
            candidates.push(runtime_dir.join("libobs.so"));
        }
    }

    #[cfg(target_os = "windows")]
    candidates.push(PathBuf::from("obs.dll"));
    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("libobs.so.0"));
        candidates.push(PathBuf::from("libobs.so"));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("libobs.0.dylib"));
        candidates.push(PathBuf::from("libobs.dylib"));
    }
    candidates
}

fn module_bin_path(runtime_dir: &Path, module: &str) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        runtime_dir
            .join("obs-plugins/64bit")
            .join(format!("{module}.dll"))
    }
    #[cfg(target_os = "macos")]
    {
        runtime_dir
            .join("obs-plugins")
            .join(format!("{module}.plugin"))
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        runtime_dir
            .join("lib/obs-plugins")
            .join(format!("{module}.so"))
    }
}

struct ObsModuleSpec {
    name: &'static str,
    required: bool,
}

fn platform_modules() -> &'static [ObsModuleSpec] {
    #[cfg(target_os = "windows")]
    {
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
    #[cfg(target_os = "linux")]
    {
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
                name: "linux-capture",
                required: true,
            },
        ]
    }
    #[cfg(target_os = "macos")]
    {
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
                name: "mac-capture",
                required: true,
            },
            ObsModuleSpec {
                name: "mac-avcapture",
                required: true,
            },
        ]
    }
}

fn platform_graphics_module() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "libobs-d3d11"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "libobs-opengl"
    }
}

fn platform_display_source_id() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "monitor_capture"
    }
    #[cfg(target_os = "linux")]
    {
        "xshm_input"
    }
    #[cfg(target_os = "macos")]
    {
        "display_capture"
    }
}

fn platform_audio_output_source_id() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "wasapi_output_capture"
    }
    #[cfg(target_os = "linux")]
    {
        "pulse_output_capture"
    }
    #[cfg(target_os = "macos")]
    {
        "coreaudio_output_capture"
    }
}

fn platform_audio_input_source_id() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "wasapi_input_capture"
    }
    #[cfg(target_os = "linux")]
    {
        "pulse_input_capture"
    }
    #[cfg(target_os = "macos")]
    {
        "coreaudio_input_capture"
    }
}

fn platform_application_audio_source_id() -> Option<&'static str> {
    #[cfg(target_os = "windows")]
    {
        Some("wasapi_process_output_capture")
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn cstring_path(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().replace('\\', "/").into_bytes())
        .map_err(|_| format!("Path contains a nul byte: {}", path.display()))
}
