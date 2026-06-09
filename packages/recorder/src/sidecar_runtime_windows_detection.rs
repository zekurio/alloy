    use super::{
        audio_application_id_from_parts, clean_user_facing_process_name, detected_game_from_parts,
        normalized_path, user_facing_process_name, DetectedGame, GameDetection,
        ProcessDisplayName, RecordingAudioApplicationSelection, RecordingGameProcess,
        RecordingSettings, VideoDimensions, SIDE_CAR_NAME,
    };
    use std::{
        collections::{HashMap, HashSet},
        ffi::{c_void, CStr},
        mem::{size_of, zeroed},
        path::Path,
        ptr,
        thread,
        time::Duration,
    };
    use windows_sys::core::{BOOL, GUID, HRESULT, IUnknown_Vtbl, PWSTR};
    use windows_sys::Win32::{
        Devices::Display::{
            DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
            DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
            DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO,
            DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME,
            QDC_ONLY_ACTIVE_PATHS,
        },
        Foundation::{
            CloseHandle, HGLOBAL, HWND, INVALID_HANDLE_VALUE, LPARAM, POINT, RECT, STILL_ACTIVE,
        },
        Graphics::{
            Gdi::{
                EnumDisplayDevicesA, GetMonitorInfoA, GetMonitorInfoW, MonitorFromPoint,
                MonitorFromWindow, DISPLAY_DEVICEA, MONITORINFO, MONITORINFOEXA,
                MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
            },
            GdiPlus::{
                GdipCreateBitmapFromHICON, GdipDisposeImage, GdipSaveImageToStream,
                GdiplusShutdown, GdiplusStartup, GdiplusStartupInput, GpBitmap, GpImage,
                Ok as GDIP_OK,
            },
        },
        Media::Audio::{AudioSessionStateActive, DEVICE_STATE_ACTIVE, MMDeviceEnumerator, eRender},
        Security::Cryptography::{
            CryptBinaryToStringW, CRYPT_STRING_BASE64, CRYPT_STRING_NOCRLF,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
                COINIT_APARTMENTTHREADED, STATFLAG_NONAME, STATSTG,
            },
            Com::StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream},
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
            Threading::{
                GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
        UI::{
            Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON},
            WindowsAndMessaging::{
                DestroyIcon, EnumWindows, GetClassNameW, GetClientRect, GetForegroundWindow,
                GetShellWindow, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect, GetWindowTextW,
                GetWindowThreadProcessId, IsWindow, IsWindowVisible, EDD_GET_DEVICE_INTERFACE_NAME,
                HICON, GWL_EXSTYLE, SM_CXSCREEN, SM_CYSCREEN, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
            },
        },
    };

    pub fn detect_game_activity(
        active_game: Option<&DetectedGame>,
        settings: &RecordingSettings,
    ) -> Option<GameDetection> {
        unsafe {
            let mut context = GameWindowContext {
                foreground_process_id: foreground_process_id(),
                settings,
                candidates: Vec::new(),
            };
            EnumWindows(
                Some(collect_game_candidate_window),
                (&mut context as *mut GameWindowContext<'_>) as LPARAM,
            );
            select_game_candidate(context.candidates, active_game)
        }
    }

    unsafe fn foreground_process_id() -> Option<u32> {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() || IsWindow(hwnd) == 0 {
            return None;
        }
        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        (process_id != 0).then_some(process_id)
    }

    fn select_game_candidate(
        candidates: Vec<GameDetection>,
        active_game: Option<&DetectedGame>,
    ) -> Option<GameDetection> {
        if candidates.is_empty() {
            return None;
        }

        if let Some(active_process_id) = active_game.map(|game| game.game.process_id) {
            if let Some(candidate) = candidates
                .iter()
                .filter(|candidate| candidate.game.game.process_id == active_process_id)
                .max_by_key(|candidate| game_candidate_sort_key(candidate))
                .cloned()
            {
                return Some(candidate);
            }
        }

        candidates
            .into_iter()
            .max_by_key(|candidate| game_candidate_sort_key(candidate))
    }

    fn game_candidate_sort_key(candidate: &GameDetection) -> (u8, i32, u64) {
        let area = candidate
            .game
            .capture_dimensions
            .map(|dimensions| u64::from(dimensions.width) * u64::from(dimensions.height))
            .unwrap_or_default();
        (
            u8::from(candidate.focused),
            candidate.game.detection_score,
            area,
        )
    }

    pub fn process_alive(process_id: u32) -> bool {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
            if handle.is_null() {
                return false;
            }
            let mut exit_code = 0u32;
            let ok = GetExitCodeProcess(handle, &mut exit_code) != 0;
            CloseHandle(handle);
            ok && exit_code == STILL_ACTIVE as u32
        }
    }

    pub fn primary_display_dimensions() -> Option<VideoDimensions> {
        unsafe {
            let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
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
                return screen_dimensions();
            }
            rect_dimensions(&monitor_info.rcMonitor).or_else(screen_dimensions)
        }
    }

    fn screen_dimensions() -> Option<VideoDimensions> {
        unsafe {
            let width = GetSystemMetrics(SM_CXSCREEN);
            let height = GetSystemMetrics(SM_CYSCREEN);
            if width <= 0 || height <= 0 {
                return None;
            }
            Some(VideoDimensions {
                width: width as u32,
                height: height as u32,
            })
        }
    }

    pub fn primary_display_id() -> Option<String> {
        unsafe {
            let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
            if monitor.is_null() {
                return None;
            }

            let mut monitor_info: MONITORINFOEXA = zeroed();
            monitor_info.monitorInfo.cbSize = size_of::<MONITORINFOEXA>() as u32;
            if GetMonitorInfoA(monitor, &mut monitor_info as *mut MONITORINFOEXA as *mut _) == 0 {
                return None;
            }

            let mut device: DISPLAY_DEVICEA = zeroed();
            device.cb = size_of::<DISPLAY_DEVICEA>() as u32;
            if EnumDisplayDevicesA(
                monitor_info.szDevice.as_ptr().cast(),
                0,
                &mut device,
                EDD_GET_DEVICE_INTERFACE_NAME,
            ) == 0
            {
                return c_char_array_to_string(monitor_info.szDevice.as_ptr());
            }

            c_char_array_to_string(device.DeviceID.as_ptr())
        }
    }

    pub fn audio_applications() -> Vec<RecordingAudioApplicationSelection> {
        let sessions = active_audio_sessions();
        if sessions.is_empty() {
            return Vec::new();
        }

        let process_ids = sessions.keys().copied().collect::<HashSet<_>>();
        let windows = audio_windows_by_process(&process_ids);
        let mut applications = Vec::new();
        let mut seen = HashSet::new();

        for (process_id, session) in sessions {
            let path = unsafe { process_path(process_id) };
            let executable = process_executable(path.as_deref());
            let window_info = windows.get(&process_id);
            let title = window_info
                .and_then(|window| window.title.clone())
                .unwrap_or_default();
            let class_name = window_info.and_then(|window| window.class_name.clone());

            if !looks_like_audio_application(
                title.as_str(),
                class_name.as_deref(),
                executable.as_deref(),
            ) {
                continue;
            }

            let executable_for_obs = executable.clone().unwrap_or_default();
            let window = window_info
                .map(|window| window.window.clone())
                .unwrap_or_else(|| format!("::{executable_for_obs}"));
            if window == "::" {
                continue;
            }

            let id = audio_application_id_from_parts(
                executable.as_deref(),
                class_name.as_deref(),
                process_id,
            );
            if !seen.insert(id.clone()) {
                continue;
            }

            let name = user_facing_process_name(ProcessDisplayName {
                path: path.as_deref(),
                preferred: session.display_name.as_deref(),
                title: Some(&title),
                executable: executable.as_deref(),
                fallback: None,
                preserve_preferred: false,
            })
            .unwrap_or_else(|| format!("Application {process_id}"));
            applications.push(RecordingAudioApplicationSelection {
                id,
                name,
                window,
                executable,
                icon_url: path.as_deref().and_then(application_icon_data_url),
                process_id: Some(process_id),
                enabled: false,
                volume: 100,
            });
        }

        applications.sort_by(|left, right| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
        });
        applications
    }

    pub fn game_processes() -> Vec<RecordingGameProcess> {
        unsafe {
            let processes = process_entries();
            if processes.is_empty() {
                return Vec::new();
            }

            let process_ids = processes.iter().map(|process| process.process_id).collect();
            let windows = audio_windows_by_process(&process_ids);
            let mut items = Vec::new();
            let mut seen = HashSet::new();

            for process in processes {
                let Some(path) = process_path(process.process_id) else {
                    continue;
                };
                if ignored_process_path(&path) {
                    continue;
                }

                let key = normalized_path(&path).to_ascii_lowercase();
                if !seen.insert(key.clone()) {
                    continue;
                }

                let executable = process_executable(Some(&path))
                    .or_else(|| clean_user_facing_process_name(&process.executable));
                let window_title = windows
                    .get(&process.process_id)
                    .and_then(|window| window.title.clone());
                let name = user_facing_process_name(ProcessDisplayName {
                    path: Some(&path),
                    preferred: None,
                    title: window_title.as_deref(),
                    executable: executable.as_deref(),
                    fallback: Some(&process.executable),
                    preserve_preferred: false,
                })
                .unwrap_or_else(|| format!("Process {}", process.process_id));

                items.push(RecordingGameProcess {
                    id: key,
                    name,
                    process_id: process.process_id,
                    executable,
                    path: Some(path.clone()),
                    window_title,
                    icon_url: application_icon_data_url(&path),
                });
            }

            items.sort_by(|left, right| {
                let left_visible = left.window_title.is_none() as u8;
                let right_visible = right.window_title.is_none() as u8;
                left_visible.cmp(&right_visible).then_with(|| {
                    left.name
                        .to_ascii_lowercase()
                        .cmp(&right.name.to_ascii_lowercase())
                })
            });
            items
        }
    }

    struct ProcessEntry {
        process_id: u32,
        executable: String,
    }

    unsafe fn process_entries() -> Vec<ProcessEntry> {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Vec::new();
        }

        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..zeroed()
        };
        let mut processes = Vec::new();
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                if entry.th32ProcessID != 0 {
                    processes.push(ProcessEntry {
                        process_id: entry.th32ProcessID,
                        executable: wide_array_to_string(&entry.szExeFile),
                    });
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        processes
    }

    fn ignored_process_path(path: &str) -> bool {
        normalized_path(path)
            .to_ascii_lowercase()
            .starts_with("c:/windows/")
    }

    fn wide_array_to_string(value: &[u16]) -> String {
        let len = value.iter().position(|ch| *ch == 0).unwrap_or(value.len());
        String::from_utf16_lossy(&value[..len]).trim().to_string()
    }

    unsafe extern "system" fn collect_game_candidate_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam as *mut GameWindowContext<'_>);
        if let Some(candidate) =
            game_candidate_from_window(hwnd, context.foreground_process_id, context.settings)
        {
            context.candidates.push(candidate);
        }
        1
    }

    unsafe fn game_candidate_from_window(
        hwnd: HWND,
        foreground_process_id: Option<u32>,
        settings: &RecordingSettings,
    ) -> Option<GameDetection> {
        if !is_capturable_application_window(hwnd) {
            return None;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 {
            return None;
        }

        let title = window_text(hwnd);
        let class_name = window_class(hwnd);
        let path = process_path(process_id);
        let executable = process_executable(path.as_deref()).unwrap_or_default();
        let obs_window = Some(format!(
            "{}:{}:{}",
            title.clone().unwrap_or_default(),
            class_name.clone().unwrap_or_default(),
            executable
        ));
        let fullscreen_dimensions = fullscreen_monitor_dimensions(hwnd);
        let capture_dimensions = fullscreen_dimensions.or_else(|| window_dimensions(hwnd));
        let game = detected_game_from_parts(
            process_id,
            path,
            title,
            class_name,
            format!("pid:{process_id}"),
            hwnd as isize,
            fullscreen_dimensions.is_some(),
            obs_window,
            capture_dimensions,
            false,
            settings,
        )?;

        Some(GameDetection {
            game,
            focused: foreground_process_id == Some(process_id),
        })
    }

    fn audio_windows_by_process(process_ids: &HashSet<u32>) -> HashMap<u32, WindowInfo> {
        let mut context = AudioWindowContext {
            process_ids: process_ids.clone(),
            windows: HashMap::new(),
        };
        unsafe {
            EnumWindows(
                Some(collect_audio_application_window),
                (&mut context as *mut AudioWindowContext) as LPARAM,
            );
        }
        context.windows
    }

    unsafe extern "system" fn collect_audio_application_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam as *mut AudioWindowContext);
        if !is_capturable_application_window(hwnd) {
            return 1;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0
            || !context.process_ids.contains(&process_id)
            || context.windows.contains_key(&process_id)
        {
            return 1;
        }

        let title = window_text(hwnd);
        let class_name = window_class(hwnd);
        let path = process_path(process_id);
        let executable = process_executable(path.as_deref());
        if !looks_like_audio_application(
            title.as_deref().unwrap_or_default(),
            class_name.as_deref(),
            executable.as_deref(),
        ) {
            return 1;
        }

        let window = format!(
            "{}:{}:{}",
            title.clone().unwrap_or_default(),
            class_name.clone().unwrap_or_default(),
            executable.unwrap_or_default()
        );
        context.windows.insert(
            process_id,
            WindowInfo {
                title,
                class_name,
                window,
            },
        );
        1
    }

