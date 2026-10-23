use std::{ffi::c_void, marker::PhantomData, ptr};

use windows_sys::core::{IUnknown_Vtbl, GUID, HRESULT, PWSTR};
use windows_sys::Win32::{
    Media::Audio::{
        eCapture, eCommunications, eConsole, eRender, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    },
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED,
    },
};

use crate::types::RecordingAudioDeviceKind;

const S_OK: HRESULT = 0;
const RPC_E_CHANGED_MODE: HRESULT = 0x80010106u32 as HRESULT;
const IID_IMM_DEVICE_ENUMERATOR: GUID = GUID::from_u128(0xa95664d2_9614_4f35_a746_de8db63617e6);
const IID_IAUDIO_SESSION_MANAGER2: GUID = GUID::from_u128(0x77aa99a0_1bd6_484f_8bc7_2c654c9a9b6f);
const IID_IAUDIO_SESSION_CONTROL2: GUID = GUID::from_u128(0xbfb7ff88_7239_4fc9_8fa2_07c950be9c6d);
const PKEY_DEVICE_FRIENDLY_NAME: AudioPropertyKey = AudioPropertyKey {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};
const VT_LPWSTR: u16 = 31;
const STGM_READ: u32 = 0;

pub(crate) struct ComPtr(*mut c_void);

impl ComPtr {
    pub(crate) fn new(ptr: *mut c_void) -> Option<Self> {
        if ptr.is_null() {
            None
        } else {
            Some(Self(ptr))
        }
    }

    pub(crate) fn as_ptr(&self) -> *mut c_void {
        self.0
    }
}

impl Drop for ComPtr {
    fn drop(&mut self) {
        unsafe {
            release_com(self.0);
        }
    }
}

#[repr(C)]
#[allow(non_snake_case)]
pub(crate) struct IMMDeviceEnumeratorVtbl {
    pub(crate) base: IUnknown_Vtbl,
    pub(crate) EnumAudioEndpoints:
        unsafe extern "system" fn(*mut c_void, i32, u32, *mut *mut c_void) -> HRESULT,
    pub(crate) GetDefaultAudioEndpoint:
        unsafe extern "system" fn(*mut c_void, i32, i32, *mut *mut c_void) -> HRESULT,
    pub(crate) GetDevice: usize,
    pub(crate) RegisterEndpointNotificationCallback: usize,
    pub(crate) UnregisterEndpointNotificationCallback: usize,
}

#[repr(C)]
#[allow(non_snake_case)]
struct IMMDeviceCollectionVtbl {
    base: IUnknown_Vtbl,
    GetCount: unsafe extern "system" fn(*mut c_void, *mut u32) -> HRESULT,
    Item: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> HRESULT,
}

#[repr(C)]
#[allow(non_snake_case)]
pub(crate) struct IMMDeviceVtbl {
    pub(crate) base: IUnknown_Vtbl,
    pub(crate) Activate: unsafe extern "system" fn(
        *mut c_void,
        *const GUID,
        u32,
        *const c_void,
        *mut *mut c_void,
    ) -> HRESULT,
    pub(crate) OpenPropertyStore:
        unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> HRESULT,
    pub(crate) GetId: unsafe extern "system" fn(*mut c_void, *mut PWSTR) -> HRESULT,
    pub(crate) GetState: usize,
}

#[repr(C)]
#[allow(non_snake_case)]
struct IPropertyStoreVtbl {
    base: IUnknown_Vtbl,
    GetCount: usize,
    GetAt: usize,
    GetValue: unsafe extern "system" fn(
        *mut c_void,
        *const AudioPropertyKey,
        *mut AudioPropVariant,
    ) -> HRESULT,
    SetValue: usize,
    Commit: usize,
}

#[repr(C)]
#[allow(non_snake_case)]
struct IAudioSessionManager2Vtbl {
    base: IUnknown_Vtbl,
    GetAudioSessionControl: usize,
    GetSimpleAudioVolume: usize,
    GetSessionEnumerator: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    RegisterSessionNotification: usize,
    UnregisterSessionNotification: usize,
    RegisterDuckNotification: usize,
    UnregisterDuckNotification: usize,
}

#[repr(C)]
#[allow(non_snake_case)]
struct IAudioSessionEnumeratorVtbl {
    base: IUnknown_Vtbl,
    GetCount: unsafe extern "system" fn(*mut c_void, *mut i32) -> HRESULT,
    GetSession: unsafe extern "system" fn(*mut c_void, i32, *mut *mut c_void) -> HRESULT,
}

#[repr(C)]
#[allow(non_snake_case)]
struct IAudioSessionControl2Vtbl {
    base: IUnknown_Vtbl,
    GetState: usize,
    GetDisplayName: usize,
    SetDisplayName: usize,
    GetIconPath: usize,
    SetIconPath: usize,
    GetGroupingParam: usize,
    SetGroupingParam: usize,
    RegisterAudioSessionNotification: usize,
    UnregisterAudioSessionNotification: usize,
    GetSessionIdentifier: usize,
    GetSessionInstanceIdentifier: usize,
    GetProcessId: unsafe extern "system" fn(*mut c_void, *mut u32) -> HRESULT,
    IsSystemSoundsSession: unsafe extern "system" fn(*mut c_void) -> HRESULT,
    SetDuckingPreference: usize,
}

#[repr(C)]
struct AudioPropertyKey {
    fmtid: GUID,
    pid: u32,
}

#[repr(C)]
#[derive(Default)]
struct AudioPropVariant {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    data: [usize; 2],
}

/// COM initialized on the current thread for as long as this value lives.
/// Bind it before any `ComPtr`: locals drop in reverse order, so every
/// interface is released before `CoUninitialize` runs.
pub(crate) struct ComApartment {
    uninitialize: bool,
    // CoUninitialize must run on the thread that called CoInitializeEx.
    _thread_bound: PhantomData<*const ()>,
}

impl ComApartment {
    /// Enters a single-threaded apartment, or joins the thread's existing
    /// multithreaded one without taking ownership of it.
    pub(crate) fn initialize() -> Option<Self> {
        // SAFETY: CoInitializeEx has no preconditions. Every successful call,
        // S_FALSE included, is balanced by Drop on this thread.
        let hr = unsafe { CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED as u32) };
        let uninitialize = if succeeded(hr) {
            true
        } else if hr == RPC_E_CHANGED_MODE {
            false
        } else {
            return None;
        };
        Some(Self {
            uninitialize,
            _thread_bound: PhantomData,
        })
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.uninitialize {
            // SAFETY: Balances the successful CoInitializeEx in `initialize`;
            // the raw-pointer marker keeps this value on that thread.
            unsafe { CoUninitialize() };
        }
    }
}

pub(crate) unsafe fn create_mm_device_enumerator() -> Option<ComPtr> {
    let mut enumerator_ptr: *mut c_void = ptr::null_mut();
    if !succeeded(CoCreateInstance(
        &MMDeviceEnumerator,
        ptr::null_mut(),
        CLSCTX_ALL,
        &IID_IMM_DEVICE_ENUMERATOR,
        &mut enumerator_ptr,
    )) {
        return None;
    }
    ComPtr::new(enumerator_ptr)
}

pub(crate) unsafe fn active_audio_endpoint_devices(
    enumerator: &ComPtr,
    data_flow: i32,
) -> Option<Vec<ComPtr>> {
    let enumerator_vtbl = com_vtbl::<IMMDeviceEnumeratorVtbl>(enumerator.as_ptr());
    let mut collection_ptr: *mut c_void = ptr::null_mut();
    if !succeeded(((*enumerator_vtbl).EnumAudioEndpoints)(
        enumerator.as_ptr(),
        data_flow,
        DEVICE_STATE_ACTIVE,
        &mut collection_ptr,
    )) {
        return None;
    }
    let collection = ComPtr::new(collection_ptr)?;
    let collection_vtbl = com_vtbl::<IMMDeviceCollectionVtbl>(collection.as_ptr());

    let mut device_count = 0u32;
    if !succeeded(((*collection_vtbl).GetCount)(
        collection.as_ptr(),
        &mut device_count,
    )) {
        return None;
    }

    let mut devices = Vec::new();
    for index in 0..device_count {
        let mut device_ptr: *mut c_void = ptr::null_mut();
        if !succeeded(((*collection_vtbl).Item)(
            collection.as_ptr(),
            index,
            &mut device_ptr,
        )) {
            continue;
        }
        if let Some(device) = ComPtr::new(device_ptr) {
            devices.push(device);
        }
    }

    Some(devices)
}

/// Id of the endpoint the "default" device setting follows for `kind`.
pub(crate) unsafe fn default_endpoint_id(
    enumerator: &ComPtr,
    kind: &RecordingAudioDeviceKind,
) -> Option<String> {
    let (data_flow, role) = match kind {
        RecordingAudioDeviceKind::Output => (eRender, eConsole),
        RecordingAudioDeviceKind::Input => (eCapture, eCommunications),
    };
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
    endpoint_id(&ComPtr::new(device_ptr)?)
}

/// WASAPI endpoint id (`{0.0.x.00000000}.{guid}`), lowercased to match
/// persisted recorder audio-device ids and UI merge keys.
pub(crate) unsafe fn endpoint_id(device: &ComPtr) -> Option<String> {
    let device_vtbl = com_vtbl::<IMMDeviceVtbl>(device.as_ptr());
    let mut raw: PWSTR = ptr::null_mut();
    if !succeeded(((*device_vtbl).GetId)(device.as_ptr(), &mut raw)) {
        return None;
    }
    string_from_cotaskmem_pwstr(raw).map(|id| id.to_ascii_lowercase())
}

pub(crate) unsafe fn endpoint_friendly_name(device: &ComPtr) -> Option<String> {
    let device_vtbl = com_vtbl::<IMMDeviceVtbl>(device.as_ptr());
    let mut store_ptr: *mut c_void = ptr::null_mut();
    if !succeeded(((*device_vtbl).OpenPropertyStore)(
        device.as_ptr(),
        STGM_READ,
        &mut store_ptr,
    )) {
        return None;
    }
    let store = ComPtr::new(store_ptr)?;
    let store_vtbl = com_vtbl::<IPropertyStoreVtbl>(store.as_ptr());
    let mut value = AudioPropVariant::default();
    if !succeeded(((*store_vtbl).GetValue)(
        store.as_ptr(),
        &PKEY_DEVICE_FRIENDLY_NAME,
        &mut value,
    )) || value.vt != VT_LPWSTR
    {
        return None;
    }
    string_from_cotaskmem_pwstr(value.data[0] as PWSTR)
}

/// Calls `visit` with each session's `IAudioSessionControl` on a render
/// endpoint and the id of the process that owns it. System sounds and
/// sessions without a process are skipped.
pub(crate) unsafe fn for_each_process_audio_session(
    device: &ComPtr,
    mut visit: impl FnMut(&ComPtr, u32),
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
    if !succeeded(((*session_enum_vtbl).GetCount)(
        session_enum.as_ptr(),
        &mut count,
    )) {
        return;
    }

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

        let Some(control2) = query_interface(control.as_ptr(), &IID_IAUDIO_SESSION_CONTROL2) else {
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

        visit(&control, process_id);
    }
}

pub(crate) unsafe fn query_interface(ptr: *mut c_void, iid: &GUID) -> Option<ComPtr> {
    let mut interface: *mut c_void = ptr::null_mut();
    let unknown_vtbl = com_vtbl::<IUnknown_Vtbl>(ptr);
    if succeeded(((*unknown_vtbl).QueryInterface)(ptr, iid, &mut interface)) {
        ComPtr::new(interface)
    } else {
        None
    }
}

pub(crate) unsafe fn release_com(ptr: *mut c_void) {
    if ptr.is_null() {
        return;
    }
    let unknown_vtbl = com_vtbl::<IUnknown_Vtbl>(ptr);
    ((*unknown_vtbl).Release)(ptr);
}

pub(crate) unsafe fn com_vtbl<T>(ptr: *mut c_void) -> *const T {
    *(ptr as *mut *const T)
}

pub(crate) fn succeeded(hr: HRESULT) -> bool {
    hr >= 0
}

pub(crate) unsafe fn string_from_cotaskmem_pwstr(raw: PWSTR) -> Option<String> {
    if raw.is_null() {
        return None;
    }

    let mut len = 0usize;
    while *raw.add(len) != 0 {
        len += 1;
    }
    let value = String::from_utf16_lossy(std::slice::from_raw_parts(raw, len))
        .trim()
        .to_string();
    CoTaskMemFree(raw as *const c_void);

    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
