    const S_OK: HRESULT = 0;
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

    struct GameWindowContext<'a> {
        foreground_process_id: Option<u32>,
        settings: &'a RecordingSettings,
        candidates: Vec<GameDetection>,
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
                uninitialize_com();
            }
            sessions
        }
    }

    unsafe fn enumerate_active_audio_sessions() -> Option<HashMap<u32, AudioSessionProcess>> {
        let enumerator = create_mm_device_enumerator()?;
        let mut sessions = HashMap::new();
        for device in active_audio_endpoint_devices(&enumerator, eRender)? {
            let _ = collect_device_audio_sessions(device.as_ptr(), &mut sessions);
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
            if !audio_session_is_capturable(control.as_ptr()) {
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

    /// Active sessions are rendering right now; inactive ones hold an open
    /// render stream that is momentarily silent — e.g. a voice call where
    /// nobody is talking. Both belong in the capturable application list;
    /// only expired sessions are gone for good.
    unsafe fn audio_session_is_capturable(control: *mut c_void) -> bool {
        let mut state = 0i32;
        let control_vtbl = com_vtbl::<IAudioSessionControlVtbl>(control);
        succeeded(((*control_vtbl).GetState)(control, &mut state))
            && (state == AudioSessionStateActive || state == AudioSessionStateInactive)
    }

    unsafe fn session_display_name(control: *mut c_void) -> Option<String> {
        let control_vtbl = com_vtbl::<IAudioSessionControlVtbl>(control);
        let mut raw: PWSTR = ptr::null_mut();
        if !succeeded(((*control_vtbl).GetDisplayName)(control, &mut raw)) {
            return None;
        }
        string_from_cotaskmem_pwstr(raw)
    }

    pub(super) fn application_icon_data_url(path: &str) -> Option<String> {
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

    pub(super) fn application_display_name(path: &str) -> Option<String> {
        file_version_string(path, "ProductName")
            .or_else(|| file_version_string(path, "FileDescription"))
            .and_then(|name| clean_user_facing_process_name(&name))
    }

    fn file_version_string(path: &str, key: &str) -> Option<String> {
        unsafe {
            let path = wide_null(path);
            let mut handle = 0u32;
            let size = GetFileVersionInfoSizeW(path.as_ptr(), &mut handle);
            if size == 0 {
                return None;
            }

            let mut data = vec![0u8; size as usize];
            if GetFileVersionInfoW(path.as_ptr(), 0, size, data.as_mut_ptr().cast()) == 0 {
                return None;
            }

            for translation in file_version_translations(&data) {
                let query = wide_null(&format!(
                    "\\StringFileInfo\\{:04x}{:04x}\\{key}",
                    translation.language, translation.code_page
                ));
                if let Some(value) = version_query_string(&data, &query) {
                    return Some(value);
                }
            }

            for query in [
                format!("\\StringFileInfo\\040904b0\\{key}"),
                format!("\\StringFileInfo\\040904e4\\{key}"),
            ] {
                let query = wide_null(&query);
                if let Some(value) = version_query_string(&data, &query) {
                    return Some(value);
                }
            }

            None
        }
    }

    #[derive(Clone, Copy)]
    struct VersionTranslation {
        language: u16,
        code_page: u16,
    }

    unsafe fn file_version_translations(data: &[u8]) -> Vec<VersionTranslation> {
        let query = wide_null("\\VarFileInfo\\Translation");
        let mut buffer: *mut c_void = ptr::null_mut();
        let mut len = 0u32;
        if VerQueryValueW(
            data.as_ptr().cast(),
            query.as_ptr(),
            &mut buffer,
            &mut len,
        ) == 0
            || buffer.is_null()
            || len < 4
        {
            return Vec::new();
        }

        let count = (len / 4) as usize;
        let raw = std::slice::from_raw_parts(buffer.cast::<u16>(), count * 2);
        raw.chunks_exact(2)
            .map(|chunk| VersionTranslation {
                language: chunk[0],
                code_page: chunk[1],
            })
            .collect()
    }

    unsafe fn version_query_string(data: &[u8], query: &[u16]) -> Option<String> {
        let mut buffer: *mut c_void = ptr::null_mut();
        let mut len = 0u32;
        if VerQueryValueW(
            data.as_ptr().cast(),
            query.as_ptr(),
            &mut buffer,
            &mut len,
        ) == 0
            || buffer.is_null()
            || len == 0
        {
            return None;
        }

        let raw = std::slice::from_raw_parts(buffer.cast::<u16>(), len as usize);
        let nul = raw.iter().position(|ch| *ch == 0).unwrap_or(raw.len());
        let value = String::from_utf16_lossy(&raw[..nul]).trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
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

    const ADVANCED_COLOR_ENABLED_FLAG: u32 = 0b10;

    pub fn refresh_capture_metadata(game: &mut DetectedGame) {
        unsafe {
            let hwnd = game.window_handle as HWND;
            if hwnd.is_null() || IsWindow(hwnd) == 0 {
                return;
            }

            let fullscreen_dimensions = fullscreen_monitor_dimensions(hwnd);
            game.fullscreen = fullscreen_dimensions.is_some();
            if let Some(dimensions) = fullscreen_dimensions
                .or_else(|| window_dimensions(hwnd))
                .filter(|dimensions| valid_capture_dimensions(*dimensions))
            {
                game.capture_dimensions = Some(dimensions);
            }
            game.hdr_enabled = window_hdr_enabled(hwnd);
        }
    }

    unsafe fn window_dimensions(hwnd: HWND) -> Option<VideoDimensions> {
        let mut rect = RECT::default();
        if GetClientRect(hwnd, &mut rect) == 0 {
            return None;
        }
        rect_dimensions(&rect)
    }

    unsafe fn window_hdr_enabled(hwnd: HWND) -> bool {
        let Some(device_name) = monitor_gdi_device_name(hwnd) else {
            return false;
        };
        display_path_hdr_enabled(&device_name).unwrap_or(false)
    }

    unsafe fn monitor_gdi_device_name(hwnd: HWND) -> Option<String> {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return None;
        }

        let mut monitor_info: MONITORINFOEXA = zeroed();
        monitor_info.monitorInfo.cbSize = size_of::<MONITORINFOEXA>() as u32;
        if GetMonitorInfoA(monitor, &mut monitor_info as *mut MONITORINFOEXA as *mut _) == 0 {
            return None;
        }

        c_char_array_to_string(monitor_info.szDevice.as_ptr())
    }

    unsafe fn display_path_hdr_enabled(monitor_device_name: &str) -> Option<bool> {
        let mut path_count = 0u32;
        let mut mode_count = 0u32;
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count) != 0
        {
            return None;
        }

        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            ptr::null_mut(),
        ) != 0
        {
            return None;
        }
        paths.truncate(path_count as usize);

        for path in paths {
            let Some(source_name) = display_path_source_name(&path) else {
                continue;
            };
            if source_name.eq_ignore_ascii_case(monitor_device_name) {
                return display_path_advanced_color_enabled(&path);
            }
        }

        None
    }

    unsafe fn display_path_source_name(path: &DISPLAYCONFIG_PATH_INFO) -> Option<String> {
        let mut source_name = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
        source_name.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        source_name.header.size = size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
        source_name.header.adapterId = path.sourceInfo.adapterId;
        source_name.header.id = path.sourceInfo.id;
        if DisplayConfigGetDeviceInfo(&mut source_name.header) != 0 {
            return None;
        }

        Some(wide_array_to_string(&source_name.viewGdiDeviceName))
            .filter(|value| !value.is_empty())
    }

    unsafe fn display_path_advanced_color_enabled(path: &DISPLAYCONFIG_PATH_INFO) -> Option<bool> {
        let mut color_info = DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO::default();
        color_info.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
        color_info.header.size = size_of::<DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>() as u32;
        color_info.header.adapterId = path.targetInfo.adapterId;
        color_info.header.id = path.targetInfo.id;
        if DisplayConfigGetDeviceInfo(&mut color_info.header) != 0 {
            return None;
        }

        Some(color_info.Anonymous.value & ADVANCED_COLOR_ENABLED_FLAG != 0)
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
