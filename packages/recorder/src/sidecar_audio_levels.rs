    use super::{
        emit_event, RecordingAudioDeviceKind, RecordingAudioLevel, RecordingAudioLevelTarget,
        RecordingEvent,
    };
    use std::{
        sync::{Mutex, MutexGuard},
        time::Instant,
    };

    const IID_IAUDIO_METER_INFORMATION: GUID =
        GUID::from_u128(0xc02216f6_8c67_4b5b_9d00_d008e73e0064);

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
        unsafe {
            let Some(uninitialize) = initialize_com() else {
                let mut monitor = lock_audio_level_monitor();
                monitor.deadline = None;
                monitor.running = false;
                return;
            };

            let mut meters = AudioLevelMeters::default();
            let mut refreshed_at: Option<Instant> = None;
            while audio_level_subscription_active() {
                // Endpoints and app sessions come and go; re-enumerate on a slow
                // cadence and only poll the cached meter interfaces in between.
                if refreshed_at
                    .is_none_or(|at| at.elapsed() >= AUDIO_LEVEL_REFRESH_INTERVAL)
                {
                    meters = collect_audio_level_meters();
                    refreshed_at = Some(Instant::now());
                }

                emit_event(RecordingEvent::AudioLevels {
                    levels: poll_audio_levels(&meters),
                });
                thread::sleep(AUDIO_LEVEL_POLL_INTERVAL);
            }

            drop(meters);
            if uninitialize {
                uninitialize_com();
            }
        }
    }

    struct DeviceLevelMeter {
        kind: RecordingAudioDeviceKind,
        /// Endpoint id plus the "default" alias used by the settings UI.
        ids: Vec<String>,
        meter: ComPtr,
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

    unsafe fn collect_audio_level_meters() -> AudioLevelMeters {
        let mut meters = AudioLevelMeters::default();
        let Some(enumerator) = create_mm_device_enumerator() else {
            return meters;
        };

        for (data_flow, kind) in [
            (eRender, RecordingAudioDeviceKind::Output),
            (eCapture, RecordingAudioDeviceKind::Input),
        ] {
            collect_device_level_meters(&enumerator, data_flow, kind, &mut meters);
        }
        meters
    }

    unsafe fn collect_device_level_meters(
        enumerator: &ComPtr,
        data_flow: i32,
        kind: RecordingAudioDeviceKind,
        meters: &mut AudioLevelMeters,
    ) {
        let default_role = match kind {
            RecordingAudioDeviceKind::Output => eConsole,
            RecordingAudioDeviceKind::Input => eCommunications,
        };
        let default_id = default_endpoint_id(enumerator, data_flow, default_role);

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

            let mut ids = vec![id.clone()];
            if default_id.as_deref() == Some(id.as_str()) {
                ids.push("default".to_string());
            }
            meters.devices.push(DeviceLevelMeter {
                kind: kind.clone(),
                ids,
                meter,
            });

            if data_flow == eRender {
                collect_application_level_meters(&device, meters);
            }
        }
    }

    unsafe fn default_endpoint_id(
        enumerator: &ComPtr,
        data_flow: i32,
        role: i32,
    ) -> Option<String> {
        let enumerator_vtbl = com_vtbl::<IMMDeviceEnumeratorVtbl>(enumerator.as_ptr());
        let mut device_ptr: *mut c_void = ptr::null_mut();
        if !succeeded(((*enumerator_vtbl).GetDefaultAudioEndpoint)(
            enumerator.as_ptr(),
            data_flow,
            role,
            &mut device_ptr,
        )) {
            return None;
        }
        let device = ComPtr::new(device_ptr)?;
        endpoint_id(&device)
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

    unsafe fn collect_application_level_meters(
        device: &ComPtr,
        meters: &mut AudioLevelMeters,
    ) {
        let device_vtbl = com_vtbl::<IMMDeviceVtbl>(device.as_ptr());
        let mut manager_ptr: *mut c_void = ptr::null_mut();
        if !succeeded(((*device_vtbl).Activate)(
            device.as_ptr(),
            &IID_IAUDIO_SESSION_MANAGER2,
            CLSCTX_ALL,
            ptr::null(),
            &mut manager_ptr,
        )) {
            return;
        }
        let Some(manager) = ComPtr::new(manager_ptr) else {
            return;
        };
        let manager_vtbl = com_vtbl::<IAudioSessionManager2Vtbl>(manager.as_ptr());

        let mut session_enum_ptr: *mut c_void = ptr::null_mut();
        if !succeeded(((*manager_vtbl).GetSessionEnumerator)(
            manager.as_ptr(),
            &mut session_enum_ptr,
        )) {
            return;
        }
        let Some(session_enum) = ComPtr::new(session_enum_ptr) else {
            return;
        };
        let session_enum_vtbl = com_vtbl::<IAudioSessionEnumeratorVtbl>(session_enum.as_ptr());

        let mut count = 0i32;
        if !succeeded(((*session_enum_vtbl).GetCount)(session_enum.as_ptr(), &mut count)) {
            return;
        }

        let mut ids_by_process: HashMap<u32, String> = HashMap::new();
        for index in 0..count {
            let mut control_ptr: *mut c_void = ptr::null_mut();
            if !succeeded(((*session_enum_vtbl).GetSession)(
                session_enum.as_ptr(),
                index,
                &mut control_ptr,
            )) {
                continue;
            }
            let Some(control) = ComPtr::new(control_ptr) else {
                continue;
            };

            let Some(control2) =
                query_interface(control.as_ptr(), &IID_IAUDIO_SESSION_CONTROL2)
            else {
                continue;
            };
            let control2_vtbl = com_vtbl::<IAudioSessionControl2Vtbl>(control2.as_ptr());
            if ((*control2_vtbl).IsSystemSoundsSession)(control2.as_ptr()) == S_OK {
                continue;
            }

            let mut process_id = 0u32;
            if !succeeded(((*control2_vtbl).GetProcessId)(
                control2.as_ptr(),
                &mut process_id,
            )) || process_id == 0
            {
                continue;
            }

            let id = ids_by_process
                .entry(process_id)
                .or_insert_with(|| audio_level_application_id(process_id))
                .clone();
            let Some(meter) = query_interface(control.as_ptr(), &IID_IAUDIO_METER_INFORMATION)
            else {
                continue;
            };
            meters.applications.push(ApplicationLevelMeter { id, meter });
        }
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
