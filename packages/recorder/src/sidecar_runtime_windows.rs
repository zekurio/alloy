mod windows_detector {
    use crate::sidecar_windows_com::{
        active_audio_endpoint_devices, com_vtbl, create_mm_device_enumerator, endpoint_id,
        initialize_com, query_interface, release_com, string_from_cotaskmem_pwstr, succeeded,
        uninitialize_com, ComPtr, IMMDeviceEnumeratorVtbl, IMMDeviceVtbl,
    };
    use windows_sys::core::{GUID, HRESULT, IUnknown_Vtbl, PWSTR};
    use windows_sys::Win32::{
        Media::Audio::{
            AudioSessionStateActive, AudioSessionStateInactive, eCapture, eCommunications,
            eConsole, eRender,
        },
        System::Com::CLSCTX_ALL,
    };

    include!("sidecar_runtime_windows_detection.rs");
    include!("sidecar_runtime_windows_audio.rs");
    include!("sidecar_audio_levels.rs");
}
