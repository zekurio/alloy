    const S_OK: HRESULT = 0;
    const RPC_E_CHANGED_MODE: HRESULT = 0x80010106u32 as HRESULT;
    const IID_IMM_DEVICE_ENUMERATOR: GUID =
        GUID::from_u128(0xa95664d2_9614_4f35_a746_de8db63617e6);
    const IID_IAUDIO_SESSION_MANAGER2: GUID =
        GUID::from_u128(0x77aa99a0_1bd6_484f_8bc7_2c654c9a9b6f);
    const IID_IAUDIO_SESSION_CONTROL2: GUID =
        GUID::from_u128(0xbfb7ff88_7239_4fc9_8fa2_07c950be9c6d);
    const PNG_ENCODER_CLSID: GUID =
        GUID::from_u128(0x557cf406_1a04_11d3_9a73_0000f81ef32e);

    #[derive(Clone)]
    struct AudioSessionProcess {
        display_name: Option<String>,
    }

    struct WindowInfo {
        title: Option<String>,
        class_name: Option<String>,
        window: String,
    }

    struct AudioWindowContext {
        process_ids: HashSet<u32>,
        windows: HashMap<u32, WindowInfo>,
    }

    struct GameWindowContext {
        foreground_process_id: Option<u32>,
        candidates: Vec<GameDetection>,
    }

    struct ComPtr(*mut c_void);

    impl ComPtr {
        fn new(ptr: *mut c_void) -> Option<Self> {
            if ptr.is_null() {
                None
            } else {
                Some(Self(ptr))
            }
        }

        fn as_ptr(&self) -> *mut c_void {
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
    struct IMMDeviceEnumeratorVtbl {
        base: IUnknown_Vtbl,
        EnumAudioEndpoints:
            unsafe extern "system" fn(*mut c_void, i32, u32, *mut *mut c_void) -> HRESULT,
        GetDefaultAudioEndpoint:
            unsafe extern "system" fn(*mut c_void, i32, i32, *mut *mut c_void) -> HRESULT,
        GetDevice: usize,
        RegisterEndpointNotificationCallback: usize,
        UnregisterEndpointNotificationCallback: usize,
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
    struct IMMDeviceVtbl {
        base: IUnknown_Vtbl,
        Activate: unsafe extern "system" fn(
            *mut c_void,
            *const GUID,
            u32,
            *const c_void,
            *mut *mut c_void,
        ) -> HRESULT,
        OpenPropertyStore: usize,
        GetId: usize,
        GetState: usize,
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
    struct IAudioSessionControlVtbl {
        base: IUnknown_Vtbl,
        GetState: unsafe extern "system" fn(*mut c_void, *mut i32) -> HRESULT,
        GetDisplayName: unsafe extern "system" fn(*mut c_void, *mut PWSTR) -> HRESULT,
        SetDisplayName: usize,
        GetIconPath: usize,
        SetIconPath: usize,
        GetGroupingParam: usize,
        SetGroupingParam: usize,
        RegisterAudioSessionNotification: usize,
        UnregisterAudioSessionNotification: usize,
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
    #[allow(non_snake_case)]
    struct IStreamVtbl {
        base: IUnknown_Vtbl,
        Read: usize,
        Write: usize,
        Seek: usize,
        SetSize: usize,
        CopyTo: usize,
        Commit: usize,
        Revert: usize,
        LockRegion: usize,
        UnlockRegion: usize,
        Stat: unsafe extern "system" fn(*mut c_void, *mut STATSTG, i32) -> HRESULT,
        Clone: usize,
    }

    fn active_audio_sessions() -> HashMap<u32, AudioSessionProcess> {
        unsafe {
            let Some(uninitialize) = initialize_com() else {
                return HashMap::new();
            };
            let sessions = enumerate_active_audio_sessions().unwrap_or_default();
            if uninitialize {
                CoUninitialize();
            }
            sessions
        }
    }

    unsafe fn initialize_com() -> Option<bool> {
        let hr = CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED as u32);
        if succeeded(hr) {
            Some(true)
        } else if hr == RPC_E_CHANGED_MODE {
            Some(false)
        } else {
            None
        }
    }

    unsafe fn enumerate_active_audio_sessions() -> Option<HashMap<u32, AudioSessionProcess>> {
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
        let enumerator = ComPtr::new(enumerator_ptr)?;
        let enumerator_vtbl = com_vtbl::<IMMDeviceEnumeratorVtbl>(enumerator.as_ptr());

        let mut collection_ptr: *mut c_void = ptr::null_mut();
        if !succeeded(((*enumerator_vtbl).EnumAudioEndpoints)(
            enumerator.as_ptr(),
            eRender,
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

        let mut sessions = HashMap::new();
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
                let _ = collect_device_audio_sessions(device.as_ptr(), &mut sessions);
            }
        }

        Some(sessions)
    }

    unsafe fn collect_device_audio_sessions(
        device: *mut c_void,
        sessions: &mut HashMap<u32, AudioSessionProcess>,
    ) -> Option<()> {
        let device_vtbl = com_vtbl::<IMMDeviceVtbl>(device);

        let mut manager_ptr: *mut c_void = ptr::null_mut();
        if !succeeded(((*device_vtbl).Activate)(
            device,
            &IID_IAUDIO_SESSION_MANAGER2,
            CLSCTX_ALL,
            ptr::null(),
            &mut manager_ptr,
        )) {
            return None;
        }
        let manager = ComPtr::new(manager_ptr)?;
        let manager_vtbl = com_vtbl::<IAudioSessionManager2Vtbl>(manager.as_ptr());

        let mut session_enum_ptr: *mut c_void = ptr::null_mut();
        if !succeeded(((*manager_vtbl).GetSessionEnumerator)(
            manager.as_ptr(),
            &mut session_enum_ptr,
        )) {
            return None;
        }
        let session_enum = ComPtr::new(session_enum_ptr)?;
        let session_enum_vtbl = com_vtbl::<IAudioSessionEnumeratorVtbl>(session_enum.as_ptr());

        let mut count = 0i32;
        if !succeeded(((*session_enum_vtbl).GetCount)(
            session_enum.as_ptr(),
            &mut count,
        )) {
            return None;
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
            if !audio_session_is_active(control.as_ptr()) {
                continue;
            }

            let Some(control2) = query_interface(control.as_ptr(), &IID_IAUDIO_SESSION_CONTROL2)
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

            let display_name = session_display_name(control.as_ptr());
            sessions
                .entry(process_id)
                .and_modify(|session: &mut AudioSessionProcess| {
                    if session.display_name.is_none() {
                        session.display_name = display_name.clone();
                    }
                })
                .or_insert(AudioSessionProcess { display_name });
        }

        Some(())
    }

    unsafe fn audio_session_is_active(control: *mut c_void) -> bool {
        let mut state = 0i32;
        let control_vtbl = com_vtbl::<IAudioSessionControlVtbl>(control);
        succeeded(((*control_vtbl).GetState)(control, &mut state))
            && state == AudioSessionStateActive
    }

    unsafe fn session_display_name(control: *mut c_void) -> Option<String> {
        let control_vtbl = com_vtbl::<IAudioSessionControlVtbl>(control);
        let mut raw: PWSTR = ptr::null_mut();
        if !succeeded(((*control_vtbl).GetDisplayName)(control, &mut raw)) {
            return None;
        }
        string_from_cotaskmem_pwstr(raw)
    }

    unsafe fn query_interface(ptr: *mut c_void, iid: &GUID) -> Option<ComPtr> {
        let mut interface: *mut c_void = ptr::null_mut();
        let unknown_vtbl = com_vtbl::<IUnknown_Vtbl>(ptr);
        if succeeded(((*unknown_vtbl).QueryInterface)(
            ptr,
            iid,
            &mut interface,
        )) {
            ComPtr::new(interface)
        } else {
            None
        }
    }

    unsafe fn release_com(ptr: *mut c_void) {
        if ptr.is_null() {
            return;
        }
        let unknown_vtbl = com_vtbl::<IUnknown_Vtbl>(ptr);
        ((*unknown_vtbl).Release)(ptr);
    }

    unsafe fn com_vtbl<T>(ptr: *mut c_void) -> *const T {
        *(ptr as *mut *const T)
    }

    fn succeeded(hr: HRESULT) -> bool {
        hr >= 0
    }

    unsafe fn string_from_cotaskmem_pwstr(raw: PWSTR) -> Option<String> {
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

    fn application_icon_data_url(path: &str) -> Option<String> {
        unsafe {
            let mut info = SHFILEINFOW::default();
            let path = wide_null(path);
            let result = SHGetFileInfoW(
                path.as_ptr(),
                0,
                &mut info,
                size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_SMALLICON,
            );
            if result == 0 || info.hIcon.is_null() {
                return None;
            }

            let icon_url = icon_png_data_url(info.hIcon);
            DestroyIcon(info.hIcon);
            icon_url
        }
    }

    unsafe fn icon_png_data_url(hicon: HICON) -> Option<String> {
        let mut token = 0usize;
        let input = GdiplusStartupInput {
            GdiplusVersion: 1,
            DebugEventCallback: 0,
            SuppressBackgroundThread: 0,
            SuppressExternalCodecs: 0,
        };
        if GdiplusStartup(&mut token, &input, ptr::null_mut()) != GDIP_OK {
            return None;
        }

        let result = icon_png_data_url_inner(hicon);
        GdiplusShutdown(token);
        result
    }

    unsafe fn icon_png_data_url_inner(hicon: HICON) -> Option<String> {
        let mut bitmap: *mut GpBitmap = ptr::null_mut();
        if GdipCreateBitmapFromHICON(hicon, &mut bitmap) != GDIP_OK || bitmap.is_null() {
            return None;
        }

        let result = gdiplus_image_png_data_url(bitmap.cast::<GpImage>());
        GdipDisposeImage(bitmap.cast::<GpImage>());
        result
    }

    unsafe fn gdiplus_image_png_data_url(image: *mut GpImage) -> Option<String> {
        let mut stream: *mut c_void = ptr::null_mut();
        if !succeeded(CreateStreamOnHGlobal(ptr::null_mut(), 1, &mut stream)) || stream.is_null() {
            return None;
        }

        let result = save_image_stream_to_png_data_url(image, stream);
        release_com(stream);
        result
    }

    unsafe fn save_image_stream_to_png_data_url(
        image: *mut GpImage,
        stream: *mut c_void,
    ) -> Option<String> {
        if GdipSaveImageToStream(image, stream, &PNG_ENCODER_CLSID, ptr::null()) != GDIP_OK {
            return None;
        }

        let mut hglobal: HGLOBAL = ptr::null_mut();
        if !succeeded(GetHGlobalFromStream(stream, &mut hglobal)) || hglobal.is_null() {
            return None;
        }

        let size = stream_size(stream)
            .filter(|size| *size > 0)
            .unwrap_or_else(|| GlobalSize(hglobal));
        if size == 0 {
            return None;
        }

        let locked = GlobalLock(hglobal);
        if locked.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(locked.cast::<u8>(), size).to_vec();
        GlobalUnlock(hglobal);

        base64_encode(&bytes).map(|encoded| format!("data:image/png;base64,{encoded}"))
    }

    unsafe fn stream_size(stream: *mut c_void) -> Option<usize> {
        let stream_vtbl = com_vtbl::<IStreamVtbl>(stream);
        let mut stat = STATSTG::default();
        if !succeeded(((*stream_vtbl).Stat)(
            stream,
            &mut stat,
            STATFLAG_NONAME,
        )) {
            return None;
        }
        usize::try_from(stat.cbSize).ok()
    }

    fn base64_encode(bytes: &[u8]) -> Option<String> {
        if bytes.is_empty() {
            return None;
        }

        unsafe {
            let flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
            let mut len = 0u32;
            if CryptBinaryToStringW(
                bytes.as_ptr(),
                u32::try_from(bytes.len()).ok()?,
                flags,
                ptr::null_mut(),
                &mut len,
            ) == 0
            {
                return None;
            }

            let mut buffer = vec![0u16; len as usize];
            if CryptBinaryToStringW(
                bytes.as_ptr(),
                u32::try_from(bytes.len()).ok()?,
                flags,
                buffer.as_mut_ptr(),
                &mut len,
            ) == 0
            {
                return None;
            }

            let len = buffer
                .iter()
                .position(|ch| *ch == 0)
                .unwrap_or(buffer.len());
            Some(String::from_utf16_lossy(&buffer[..len]))
        }
    }

    fn process_executable(path: Option<&str>) -> Option<String> {
        path.and_then(|path| Path::new(path).file_name())
            .map(|name| name.to_string_lossy().into_owned())
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    unsafe fn is_capturable_application_window(hwnd: HWND) -> bool {
        if hwnd.is_null()
            || IsWindow(hwnd) == 0
            || IsWindowVisible(hwnd) == 0
            || hwnd == GetShellWindow()
        {
            return false;
        }

        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex_style & WS_EX_TOOLWINDOW != 0 && ex_style & WS_EX_APPWINDOW == 0 {
            return false;
        }

        true
    }

    fn looks_like_audio_application(
        title: &str,
        class_name: Option<&str>,
        executable: Option<&str>,
    ) -> bool {
        let has_identity = !title.trim().is_empty()
            || class_name.is_some_and(|class_name| !class_name.trim().is_empty())
            || executable.is_some_and(|executable| !executable.trim().is_empty());
        if !has_identity {
            return false;
        }

        let executable = executable.unwrap_or_default().to_ascii_lowercase();
        let class_name = class_name.unwrap_or_default().to_ascii_lowercase();
        let title = title.trim().to_ascii_lowercase();
        if executable == "alloy.exe"
            || executable == "alloy-desktop.exe"
            || (executable == "electron.exe" && title == "alloy")
        {
            return false;
        }

        let blocked = [
            "alloy-recorder.exe",
            "dwm.exe",
            "explorer.exe",
            "applicationframehost.exe",
            "shellexperiencehost.exe",
            "startmenuexperiencehost.exe",
            "searchhost.exe",
            "textinputhost.exe",
        ];

        !blocked
            .iter()
            .any(|blocked| executable == *blocked || class_name.contains(blocked))
    }

    fn clean_application_name(title: &str) -> Option<String> {
        let name = title.trim();
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }

    unsafe fn window_text(hwnd: HWND) -> Option<String> {
        let mut buffer = vec![0u16; 512];
        let len = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if len <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }

    unsafe fn window_class(hwnd: HWND) -> Option<String> {
        let mut buffer = vec![0u16; 256];
        let len = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if len <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }

    unsafe fn process_path(process_id: u32) -> Option<String> {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if handle.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32768];
        let mut len = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut len) != 0;
        CloseHandle(handle);
        if !ok || len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }

    unsafe fn fullscreen_monitor_dimensions(hwnd: HWND) -> Option<VideoDimensions> {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return None;
        }
        let mut monitor_info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT::default(),
            rcWork: RECT::default(),
            dwFlags: 0,
        };
        if GetMonitorInfoW(monitor, &mut monitor_info) == 0 {
            return None;
        }
        let fullscreen = rect.left <= monitor_info.rcMonitor.left + 4
            && rect.top <= monitor_info.rcMonitor.top + 4
            && rect.right >= monitor_info.rcMonitor.right - 4
            && rect.bottom >= monitor_info.rcMonitor.bottom - 4;
        if !fullscreen {
            return None;
        }

        rect_dimensions(&monitor_info.rcMonitor)
    }

    unsafe fn window_dimensions(hwnd: HWND) -> Option<VideoDimensions> {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        rect_dimensions(&rect)
    }

    unsafe fn c_char_array_to_string(value: *const i8) -> Option<String> {
        if value.is_null() {
            return None;
        }
        CStr::from_ptr(value)
            .to_str()
            .ok()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn rect_dimensions(rect: &RECT) -> Option<VideoDimensions> {
        let width = rect.right.checked_sub(rect.left)?;
        let height = rect.bottom.checked_sub(rect.top)?;
        Some(VideoDimensions {
            width: u32::try_from(width).ok()?,
            height: u32::try_from(height).ok()?,
        })
    }
