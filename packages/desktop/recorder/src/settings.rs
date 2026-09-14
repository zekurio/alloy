//! Settings helpers that do not touch the platform: audio-selection defaults,
//! resolution against the available endpoints, and validation.
//!
//! The desktop host reuses these so it validates a settings payload exactly the
//! way the agent does.

use crate::protocol::SIDE_CAR_NAME;
use crate::types::{RecordingAudioDevice, RecordingAudioDeviceKind, RecordingAudioDeviceSelection};

pub fn default_audio_devices() -> Vec<RecordingAudioDevice> {
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

pub fn default_audio_device_selections() -> Vec<RecordingAudioDeviceSelection> {
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

pub fn resolve_audio_device_selection(
    device: RecordingAudioDeviceSelection,
    available: &[RecordingAudioDevice],
) -> RecordingAudioDeviceSelection {
    if is_virtual_audio_device_selection(&device) {
        return device;
    }

    available
        .iter()
        .find(|available_device| {
            available_device.kind == device.kind && available_device.id == device.id
        })
        .or_else(|| {
            let mut candidates = available.iter().filter(|available_device| {
                available_device.kind == device.kind && available_device.label == device.label
            });
            let candidate = candidates.next()?;
            candidates.next().is_none().then_some(candidate)
        })
        .map(|available_device| RecordingAudioDeviceSelection {
            id: available_device.id.clone(),
            label: available_device.label.clone(),
            kind: available_device.kind.clone(),
            enabled: device.enabled,
            volume: device.volume,
        })
        .unwrap_or(device)
}

pub fn is_virtual_audio_device_selection(device: &RecordingAudioDeviceSelection) -> bool {
    device.id == "default"
}

pub fn validate_and_dedupe_audio_selections(
    devices: Vec<RecordingAudioDeviceSelection>,
    available: &[RecordingAudioDevice],
    default_endpoint_id: impl Fn(&RecordingAudioDeviceKind) -> Option<String>,
) -> Result<Vec<RecordingAudioDeviceSelection>, String> {
    let mut selected = Vec::<RecordingAudioDeviceSelection>::new();
    for device in devices {
        if !is_virtual_audio_device_selection(&device)
            && !available.iter().any(|available_device| {
                available_device.kind == device.kind && available_device.id == device.id
            })
        {
            eprintln!(
                "[{SIDE_CAR_NAME}] rejected unavailable audio selector {:?}:{} ({})",
                device.kind, device.id, device.label
            );
            return Err(format!(
                "Audio device {} ({}) is unavailable.",
                device.label, device.id
            ));
        }

        if let Some(existing) = selected.iter().find(|selected_device| {
            selected_device.kind == device.kind && selected_device.id == device.id
        }) {
            if existing.volume != device.volume {
                return Err(format!(
                    "Audio device {} is selected more than once with different volumes.",
                    device.label
                ));
            }
            continue;
        }
        selected.push(device);
    }

    for kind in [
        RecordingAudioDeviceKind::Output,
        RecordingAudioDeviceKind::Input,
    ] {
        let captures_default = selected
            .iter()
            .any(|device| device.kind == kind && device.id == "default");
        if !captures_default {
            continue;
        }
        let Some(default_id) = default_endpoint_id(&kind) else {
            continue;
        };
        if selected
            .iter()
            .any(|device| device.kind == kind && device.id == default_id)
        {
            return Err(format!(
                "The default {kind:?} and its current endpoint are both selected; disable one to avoid duplicate audio."
            ));
        }
    }
    Ok(selected)
}
