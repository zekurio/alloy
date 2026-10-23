use super::game_matching::{
    candidate_game_detection_match, clean_user_facing_process_name, readable_detected_game_name,
    user_facing_process_name, ProcessDisplayName,
};
use super::windows_audio::{
    active_audio_sessions, application_icon_data_url, fullscreen_monitor_dimensions,
    is_capturable_application_window, looks_like_audio_application, process_executable,
    process_path, rect_dimensions, window_class, window_dimensions, window_text,
    AudioWindowContext, GameWindowContext, WindowInfo,
};
use super::{
    audio_application_id_from_parts, normalized_path, obs_window_selector, path_file_name,
    valid_capture_dimensions, DetectedGame, GameDetection,
};
use crate::agent::time::now_iso;
use crate::types::{
    RecordingAudioApplicationSelection, RecordingDisplay, RecordingGame, RecordingGameGuess,
    RecordingGameProcess, RecordingSettings,
};
use std::{
    collections::{HashMap, HashSet},
    mem::{size_of, zeroed},
    ptr,
};
use windows_sys::core::BOOL;
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, HWND, INVALID_HANDLE_VALUE, LPARAM, POINT,
        RECT, STILL_ACTIVE,
    },
    Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplayMonitors, GetMonitorInfoW, MonitorFromPoint,
        DISPLAY_DEVICEW, HDC, HMONITOR, MONITORINFOEXW, MONITOR_DEFAULTTOPRIMARY,
    },
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
        EDD_GET_DEVICE_INTERFACE_NAME,
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

    candidates.into_iter().max_by_key(game_candidate_sort_key)
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
            // Anti-cheat drivers (Vanguard, EAC) strip handle rights on
            // protected game processes: access-denied means the process
            // exists, and treating it as dead collapses the game-ended
            // grace period into a detect/clear flap.
            return GetLastError() == ERROR_ACCESS_DENIED;
        }
        // WaitForSingleObject needs SYNCHRONIZE access, which this
        // query-limited handle does not carry — the wait always fails and
        // every process reads as dead. GetExitCodeProcess only needs
        // PROCESS_QUERY_LIMITED_INFORMATION.
        let mut exit_code = 0u32;
        let alive =
            GetExitCodeProcess(handle, &mut exit_code) != 0 && exit_code == STILL_ACTIVE as u32;
        CloseHandle(handle);
        alive
    }
}

pub fn is_detected_game_alive(game: &DetectedGame) -> bool {
    unsafe {
        let hwnd = game.window_handle as HWND;
        if hwnd.is_null() || IsWindow(hwnd) == 0 {
            return false;
        }
        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        process_id == game.game.process_id && process_alive(game.game.process_id)
    }
}

pub fn primary_display_id() -> Option<String> {
    // SAFETY: MonitorFromPoint has no preconditions, and the helpers below
    // only read the monitor handle it returns.
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        if monitor.is_null() {
            return None;
        }
        let (id, _) = monitor_id_and_name(&monitor_info_ex(monitor)?);
        (!id.is_empty()).then_some(id)
    }
}

/// Monitor bounds plus the GDI device name (`\\.\DISPLAY1`).
pub(super) unsafe fn monitor_info_ex(monitor: HMONITOR) -> Option<MONITORINFOEXW> {
    let mut monitor_info: MONITORINFOEXW = zeroed();
    monitor_info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    (GetMonitorInfoW(monitor, &mut monitor_info as *mut MONITORINFOEXW as *mut _) != 0)
        .then_some(monitor_info)
}

/// The monitor's device interface path and adapter name. Each falls back to
/// the GDI device name when Windows has no value for it.
unsafe fn monitor_id_and_name(monitor_info: &MONITORINFOEXW) -> (String, String) {
    let device_name = wide_array_to_string(&monitor_info.szDevice);
    let mut device: DISPLAY_DEVICEW = zeroed();
    device.cb = size_of::<DISPLAY_DEVICEW>() as u32;
    if EnumDisplayDevicesW(
        monitor_info.szDevice.as_ptr(),
        0,
        &mut device,
        EDD_GET_DEVICE_INTERFACE_NAME,
    ) == 0
    {
        return (device_name.clone(), device_name);
    }

    let or_device_name = |value: String| {
        if value.is_empty() {
            device_name.clone()
        } else {
            value
        }
    };
    (
        or_device_name(wide_array_to_string(&device.DeviceID)),
        or_device_name(wide_array_to_string(&device.DeviceString)),
    )
}

pub fn list_displays() -> Vec<RecordingDisplay> {
    unsafe {
        let mut context = DisplayEnumerationContext {
            primary: MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY),
            displays: Vec::new(),
        };
        EnumDisplayMonitors(
            ptr::null_mut(),
            ptr::null(),
            Some(collect_display_monitor),
            (&mut context as *mut DisplayEnumerationContext) as LPARAM,
        );
        context.displays
    }
}

struct DisplayEnumerationContext {
    primary: HMONITOR,
    displays: Vec<RecordingDisplay>,
}

unsafe extern "system" fn collect_display_monitor(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let context = &mut *(lparam as *mut DisplayEnumerationContext);
    let Some(monitor_info) = monitor_info_ex(monitor) else {
        return 1;
    };
    let (id, name) = monitor_id_and_name(&monitor_info);

    if let Some(dimensions) = rect_dimensions(&monitor_info.monitorInfo.rcMonitor) {
        let index = context.displays.len() + 1;
        context.displays.push(RecordingDisplay {
            id,
            name: if name.trim().is_empty() {
                format!("Display {index}")
            } else {
                name
            },
            width: dimensions.width,
            height: dimensions.height,
            primary: monitor == context.primary,
            thumbnail_data_url: None,
        });
    }
    1
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
            .unwrap_or_else(|| obs_window_selector("", "", &executable_for_obs));
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

    applications
}

pub fn list_game_processes() -> Vec<RecordingGameProcess> {
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

pub(super) fn wide_array_to_string(value: &[u16]) -> String {
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
    let obs_window = obs_window_selector(
        title.as_deref().unwrap_or_default(),
        class_name.as_deref().unwrap_or_default(),
        &process_executable(path.as_deref()).unwrap_or_default(),
    );
    let fullscreen_dimensions = fullscreen_monitor_dimensions(hwnd);
    let capture_dimensions = fullscreen_dimensions
        .or_else(|| window_dimensions(hwnd))
        .filter(|dimensions| valid_capture_dimensions(*dimensions));

    let executable = path.as_deref().and_then(path_file_name);
    let match_ = candidate_game_detection_match(
        path.as_deref(),
        executable.as_deref(),
        title.as_deref(),
        class_name.as_deref(),
        capture_dimensions,
        settings,
    )?;
    let name = readable_detected_game_name(
        &match_,
        path.as_deref(),
        title.as_deref(),
        executable.as_deref(),
    );
    let icon_url = match_
        .icon_url
        .clone()
        .or_else(|| path.as_deref().and_then(application_icon_data_url));
    let guess = RecordingGameGuess {
        source: match_.source,
        source_id: match_.source_id,
        name: match_.name,
        aliases: match_.aliases,
        executable: executable.clone(),
        path: path.clone(),
        window_title: title.clone(),
        window_class: class_name.clone(),
        icon_url: icon_url.clone(),
        confidence: match_.confidence,
        match_kind: match_.match_kind,
    };

    Some(GameDetection {
        game: DetectedGame {
            game: RecordingGame {
                id: match_.id,
                name,
                process_id,
                executable,
                icon_url,
                path,
                window_title: title,
                window_class: class_name,
                started_at: Some(now_iso()),
                guess: Some(guess),
            },
            obs_window: Some(obs_window),
            window_key: format!("pid:{process_id}"),
            window_handle: hwnd as isize,
            fullscreen: fullscreen_dimensions.is_some(),
            capture_dimensions,
            // `refresh_capture_metadata` reads HDR once this is the active game.
            hdr_enabled: false,
            detection_score: match_.detection_score,
        },
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

    let window = obs_window_selector(
        title.as_deref().unwrap_or_default(),
        class_name.as_deref().unwrap_or_default(),
        executable.as_deref().unwrap_or_default(),
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
