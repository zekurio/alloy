use super::{
    audio_application_id_from_parts,
    com::{
        active_audio_endpoint_devices, com_vtbl, create_mm_device_enumerator, default_endpoint_id,
        endpoint_id, for_each_process_audio_session, query_interface, succeeded, ComApartment,
        ComPtr, IMMDeviceVtbl,
    },
    windows_audio::{process_executable, process_path},
};
use crate::{
    agent::events::emit_event,
    types::{
        RecordingAudioDeviceKind, RecordingAudioLevel, RecordingAudioLevelTarget, RecordingEvent,
    },
};
use std::{
    collections::HashMap,
    ffi::c_void,
    ptr,
    sync::{Mutex, MutexGuard},
    thread,
    time::{Duration, Instant},
};
use windows_sys::core::{IUnknown_Vtbl, GUID, HRESULT};
use windows_sys::Win32::{
    Media::Audio::{eCapture, eRender, AUDCLNT_SHAREMODE_SHARED, WAVEFORMATEX},
    System::Com::{CoTaskMemFree, CLSCTX_ALL},
};

const IID_IAUDIO_CLIENT: GUID = GUID::from_u128(0x1cb9ad4c_dbfa_4c32_b178_c2f568a703b2);

#[repr(C)]
#[allow(non_snake_case)]
struct IAudioClientVtbl {
    base: IUnknown_Vtbl,
    Initialize: unsafe extern "system" fn(
        *mut c_void,
        i32,
        u32,
        i64,
        i64,
        *const WAVEFORMATEX,
        *const GUID,
    ) -> HRESULT,
    GetBufferSize: usize,
    GetStreamLatency: usize,
    GetCurrentPadding: usize,
    IsFormatSupported: usize,
    GetMixFormat: unsafe extern "system" fn(*mut c_void, *mut *mut WAVEFORMATEX) -> HRESULT,
    GetDevicePeriod: usize,
    Start: unsafe extern "system" fn(*mut c_void) -> HRESULT,
    Stop: unsafe extern "system" fn(*mut c_void) -> HRESULT,
    Reset: usize,
    SetEventHandle: usize,
    GetService: usize,
}

struct MicrophoneMeterStream(ComPtr);

impl Drop for MicrophoneMeterStream {
    fn drop(&mut self) {
        unsafe {
            let vtbl = com_vtbl::<IAudioClientVtbl>(self.0.as_ptr());
            ((*vtbl).Stop)(self.0.as_ptr());
        }
    }
}

unsafe fn start_microphone_meter_stream(device: &ComPtr) -> Option<MicrophoneMeterStream> {
    let device_vtbl = com_vtbl::<IMMDeviceVtbl>(device.as_ptr());
    let mut client_ptr = ptr::null_mut();
    if !succeeded(((*device_vtbl).Activate)(
        device.as_ptr(),
        &IID_IAUDIO_CLIENT,
        CLSCTX_ALL,
        ptr::null(),
        &mut client_ptr,
    )) {
        return None;
    }
    let client = ComPtr::new(client_ptr)?;
    let vtbl = com_vtbl::<IAudioClientVtbl>(client.as_ptr());
    let mut format = ptr::null_mut();
    if !succeeded(((*vtbl).GetMixFormat)(client.as_ptr(), &mut format)) {
        return None;
    }
    let initialized = ((*vtbl).Initialize)(
        client.as_ptr(),
        AUDCLNT_SHAREMODE_SHARED,
        0,
        0,
        0,
        format,
        ptr::null(),
    );
    CoTaskMemFree(format.cast());
    if !succeeded(initialized) || !succeeded(((*vtbl).Start)(client.as_ptr())) {
        return None;
    }
    // The endpoint meter supplies peaks; no captured samples are read or saved.
    Some(MicrophoneMeterStream(client))
}

const IID_IAUDIO_METER_INFORMATION: GUID = GUID::from_u128(0xc02216f6_8c67_4b5b_9d00_d008e73e0064);

const AUDIO_LEVEL_SUBSCRIPTION_TTL: Duration = Duration::from_secs(10);
const AUDIO_LEVEL_POLL_INTERVAL: Duration = Duration::from_millis(100);
const AUDIO_LEVEL_REFRESH_INTERVAL: Duration = Duration::from_secs(2);

#[repr(C)]
#[allow(non_snake_case)]
struct IAudioMeterInformationVtbl {
    base: IUnknown_Vtbl,
    GetPeakValue: unsafe extern "system" fn(*mut c_void, *mut f32) -> HRESULT,
    GetMeteringChannelCount: usize,
    GetChannelsPeakValues: usize,
    QueryHardwareSupport: usize,
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
pub fn subscribe_audio_levels() {
    let mut monitor = lock_audio_level_monitor();
    monitor.deadline = Some(Instant::now() + AUDIO_LEVEL_SUBSCRIPTION_TTL);
    if !monitor.running {
        monitor.running = true;
        thread::spawn(run_audio_level_monitor);
    }
}

pub fn stop_audio_levels() {
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
/// either extends the deadline in time or observes `running == false` and
/// spawns a fresh thread.
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

fn run_audio_level_monitor() {
    let Some(_com) = ComApartment::initialize() else {
        let mut monitor = lock_audio_level_monitor();
        monitor.deadline = None;
        monitor.running = false;
        return;
    };

    // Declared after `_com`, so the meters are released before COM is
    // uninitialized.
    let mut meters = AudioLevelMeters::default();
    let mut refreshed_at: Option<Instant> = None;
    while audio_level_subscription_active() {
        // Endpoints and app sessions come and go; re-enumerate on a slow
        // cadence and only poll the cached meter interfaces in between.
        if refreshed_at.is_none_or(|at| at.elapsed() >= AUDIO_LEVEL_REFRESH_INTERVAL) {
            // SAFETY: COM is initialized on this thread for the whole loop.
            meters = unsafe { collect_audio_level_meters(&mut meters) };
            refreshed_at = Some(Instant::now());
        }

        emit_event(RecordingEvent::AudioLevels {
            // SAFETY: Every cached meter was activated in this apartment.
            levels: unsafe { poll_audio_levels(&meters) },
        });
        thread::sleep(AUDIO_LEVEL_POLL_INTERVAL);
    }
}

struct DeviceLevelMeter {
    kind: RecordingAudioDeviceKind,
    /// Endpoint id plus the "default" alias used by the settings UI.
    ids: Vec<String>,
    meter: ComPtr,
    capture: Option<MicrophoneMeterStream>,
}

struct ApplicationLevelMeter {
    id: String,
    meter: ComPtr,
}

#[derive(Default)]
struct AudioLevelMeters {
    devices: Vec<DeviceLevelMeter>,
    applications: Vec<ApplicationLevelMeter>,
}

unsafe fn collect_audio_level_meters(previous: &mut AudioLevelMeters) -> AudioLevelMeters {
    let mut meters = AudioLevelMeters::default();
    let Some(enumerator) = create_mm_device_enumerator() else {
        return meters;
    };

    for (data_flow, kind) in [
        (eRender, RecordingAudioDeviceKind::Output),
        (eCapture, RecordingAudioDeviceKind::Input),
    ] {
        collect_device_level_meters(&enumerator, data_flow, kind, &mut meters, previous);
    }
    meters
}

unsafe fn collect_device_level_meters(
    enumerator: &ComPtr,
    data_flow: i32,
    kind: RecordingAudioDeviceKind,
    meters: &mut AudioLevelMeters,
    previous: &mut AudioLevelMeters,
) {
    let default_id = default_endpoint_id(enumerator, &kind);

    let Some(devices) = active_audio_endpoint_devices(enumerator, data_flow) else {
        return;
    };

    for device in devices {
        let Some(id) = endpoint_id(&device) else {
            continue;
        };
        let Some(meter) = activate_device_meter(&device) else {
            continue;
        };

        // Reading a peak meter alone does not start microphone capture.
        // Keep our shared stream alive across refreshes so another app is
        // never needed to wake the mic. Failed opens retry on the next refresh.
        let capture = if data_flow == eCapture {
            previous
                .devices
                .iter_mut()
                .find(|device| device.ids.first() == Some(&id))
                .and_then(|device| device.capture.take())
                .or_else(|| start_microphone_meter_stream(&device))
        } else {
            None
        };

        let mut ids = vec![id.clone()];
        if default_id.as_deref() == Some(id.as_str()) {
            ids.push("default".to_string());
        }
        meters.devices.push(DeviceLevelMeter {
            kind: kind.clone(),
            ids,
            meter,
            capture,
        });

        if data_flow == eRender {
            collect_application_level_meters(&device, meters);
        }
    }
}

unsafe fn activate_device_meter(device: &ComPtr) -> Option<ComPtr> {
    let device_vtbl = com_vtbl::<IMMDeviceVtbl>(device.as_ptr());
    let mut meter_ptr: *mut c_void = ptr::null_mut();
    if !succeeded(((*device_vtbl).Activate)(
        device.as_ptr(),
        &IID_IAUDIO_METER_INFORMATION,
        CLSCTX_ALL,
        ptr::null(),
        &mut meter_ptr,
    )) {
        return None;
    }
    ComPtr::new(meter_ptr)
}

unsafe fn collect_application_level_meters(device: &ComPtr, meters: &mut AudioLevelMeters) {
    let mut ids_by_process: HashMap<u32, String> = HashMap::new();
    for_each_process_audio_session(device, |control, process_id| {
        let id = ids_by_process
            .entry(process_id)
            .or_insert_with(|| audio_level_application_id(process_id))
            .clone();
        let Some(meter) = query_interface(control.as_ptr(), &IID_IAUDIO_METER_INFORMATION) else {
            return;
        };
        meters
            .applications
            .push(ApplicationLevelMeter { id, meter });
    });
}

fn audio_level_application_id(process_id: u32) -> String {
    let path = unsafe { process_path(process_id) };
    let executable = process_executable(path.as_deref());
    audio_application_id_from_parts(executable.as_deref(), None, process_id)
}

unsafe fn poll_audio_levels(meters: &AudioLevelMeters) -> Vec<RecordingAudioLevel> {
    let mut levels = Vec::new();
    for device in &meters.devices {
        let peak = meter_peak(&device.meter);
        for id in &device.ids {
            levels.push(RecordingAudioLevel {
                target: RecordingAudioLevelTarget::Device,
                kind: Some(device.kind.clone()),
                id: id.clone(),
                peak,
            });
        }
    }

    // An application can hold several sessions (and play on several
    // devices); report the loudest one per application id.
    let mut application_peaks: HashMap<&str, f32> = HashMap::new();
    for application in &meters.applications {
        let peak = meter_peak(&application.meter);
        let entry = application_peaks
            .entry(application.id.as_str())
            .or_insert(0.0);
        if peak > *entry {
            *entry = peak;
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

unsafe fn meter_peak(meter: &ComPtr) -> f32 {
    let meter_vtbl = com_vtbl::<IAudioMeterInformationVtbl>(meter.as_ptr());
    let mut peak = 0f32;
    if !succeeded(((*meter_vtbl).GetPeakValue)(meter.as_ptr(), &mut peak)) {
        return 0.0;
    }
    peak.clamp(0.0, 1.0)
}
