use std::{
    mem, ptr,
    sync::{mpsc, Mutex, OnceLock},
    thread,
};

use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG,
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    },
};

use super::{emit_event, RecordingEvent, RecordingSettings, SIDE_CAR_NAME};

static HOTKEY_STATE: OnceLock<Mutex<HotkeyState>> = OnceLock::new();
static HOTKEY_EVENTS: OnceLock<mpsc::SyncSender<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Modifiers {
    control: bool,
    alt: bool,
    shift: bool,
    meta: bool,
}

#[derive(Clone, Copy)]
struct NativeHotkey {
    key: u32,
    modifiers: Modifiers,
}

#[derive(Default)]
struct HotkeyState {
    hotkey: Option<NativeHotkey>,
    held_modifier_keys: u8,
    hotkey_down: bool,
}

pub(super) fn start() {
    HOTKEY_STATE.get_or_init(|| Mutex::new(HotkeyState::default()));
    let (event_tx, event_rx) = mpsc::sync_channel(8);
    if HOTKEY_EVENTS.set(event_tx).is_err() {
        return;
    }
    if let Err(error) = thread::Builder::new()
        .name("alloy-hotkey-events".to_string())
        .spawn(move || {
            while event_rx.recv().is_ok() {
                emit_event(RecordingEvent::ClipHotkey);
            }
        })
    {
        eprintln!("[{SIDE_CAR_NAME}] could not start the native hotkey event thread: {error}");
        return;
    }
    if let Err(error) = thread::Builder::new()
        .name("alloy-hotkeys".to_string())
        .spawn(run_keyboard_hook)
    {
        eprintln!("[{SIDE_CAR_NAME}] could not start the native hotkey thread: {error}");
    }
}

pub(super) fn configure(settings: &RecordingSettings) {
    let hotkey = settings
        .enabled
        .then(|| parse_hotkey(&settings.hotkeys.clip))
        .flatten();
    if settings.enabled && !settings.hotkeys.clip.trim().is_empty() && hotkey.is_none() {
        eprintln!(
            "[{SIDE_CAR_NAME}] invalid native recording hotkey: {}",
            settings.hotkeys.clip
        );
    }

    let mut state = hotkey_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    state.hotkey = hotkey;
    state.hotkey_down = false;
}

fn run_keyboard_hook() {
    // SAFETY: The callback has the required static lifetime and ABI. A
    // dedicated message loop keeps the low-level hook alive for this process.
    unsafe {
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), ptr::null_mut(), 0);
        if hook.is_null() {
            eprintln!("[{SIDE_CAR_NAME}] could not install the native keyboard hook");
            return;
        }

        let mut message: MSG = mem::zeroed();
        while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {}
        let _ = UnhookWindowsHookEx(hook);
    }
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let message = wparam as u32;
        if matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN | WM_KEYUP | WM_SYSKEYUP) {
            // SAFETY: Windows supplies a KBDLLHOOKSTRUCT pointer for every
            // non-negative WH_KEYBOARD_LL callback.
            let event = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
            if update_hotkey_state(event.vkCode, matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN)) {
                // Never block the low-level hook on stdout. Windows removes
                // hooks that overrun LowLevelHooksTimeout; the emitter thread
                // owns sidecar I/O instead.
                if let Some(events) = HOTKEY_EVENTS.get() {
                    let _ = events.try_send(());
                }
            }
        }
    }

    // SAFETY: Forwarding the original hook arguments is required by the hook
    // contract; a low-level hook does not need its own handle here.
    unsafe { CallNextHookEx(ptr::null_mut(), code, wparam, lparam) }
}

fn update_hotkey_state(key: u32, down: bool) -> bool {
    let mut state = hotkey_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(bit) = modifier_bit(key) {
        if down {
            state.held_modifier_keys |= bit;
        } else {
            state.held_modifier_keys &= !bit;
        }
        return false;
    }

    let Some(hotkey) = state.hotkey else {
        return false;
    };
    if key != hotkey.key {
        return false;
    }
    if !down {
        state.hotkey_down = false;
        return false;
    }
    if state.hotkey_down {
        return false;
    }

    state.hotkey_down = true;
    active_modifiers(state.held_modifier_keys) == hotkey.modifiers
}

fn hotkey_state() -> &'static Mutex<HotkeyState> {
    HOTKEY_STATE.get_or_init(|| Mutex::new(HotkeyState::default()))
}

fn active_modifiers(keys: u8) -> Modifiers {
    Modifiers {
        control: keys & 0b0000_0011 != 0,
        alt: keys & 0b0000_1100 != 0,
        shift: keys & 0b0011_0000 != 0,
        meta: keys & 0b1100_0000 != 0,
    }
}

fn modifier_bit(key: u32) -> Option<u8> {
    match key {
        0x11 => Some(0b0000_0011), // VK_CONTROL
        0x12 => Some(0b0000_1100), // VK_MENU
        0x10 => Some(0b0011_0000), // VK_SHIFT
        0xA2 => Some(0b0000_0001), // VK_LCONTROL
        0xA3 => Some(0b0000_0010), // VK_RCONTROL
        0xA4 => Some(0b0000_0100), // VK_LMENU
        0xA5 => Some(0b0000_1000), // VK_RMENU
        0xA0 => Some(0b0001_0000), // VK_LSHIFT
        0xA1 => Some(0b0010_0000), // VK_RSHIFT
        0x5B => Some(0b0100_0000), // VK_LWIN
        0x5C => Some(0b1000_0000), // VK_RWIN
        _ => None,
    }
}

fn parse_hotkey(value: &str) -> Option<NativeHotkey> {
    let parts = hotkey_parts(value);
    let (key, modifiers) = parts.split_last()?;
    let mut normalized = Modifiers::default();
    for modifier in modifiers {
        match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => normalized.control = true,
            "alt" | "option" => normalized.alt = true,
            "shift" => normalized.shift = true,
            "meta" | "cmd" | "command" => normalized.meta = true,
            _ => return None,
        }
    }

    Some(NativeHotkey {
        key: virtual_key(key)?,
        modifiers: normalized,
    })
}

fn hotkey_parts(value: &str) -> Vec<&str> {
    let trimmed = value.trim();
    if trimmed == "+" {
        return vec!["+"];
    }
    if let Some(prefix) = trimmed.strip_suffix('+') {
        let mut parts: Vec<_> = prefix
            .split('+')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect();
        parts.push("+");
        return parts;
    }
    trimmed
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn virtual_key(value: &str) -> Option<u32> {
    let upper = value.to_ascii_uppercase();
    if upper.len() == 1 {
        let key = upper.as_bytes()[0];
        if key.is_ascii_uppercase() || key.is_ascii_digit() {
            return Some(u32::from(key));
        }
    }
    if let Some(number) = upper
        .strip_prefix('F')
        .and_then(|number| number.parse::<u32>().ok())
        .filter(|number| (1..=24).contains(number))
    {
        return Some(0x70 + number - 1);
    }

    Some(match upper.as_str() {
        "+" | "PLUS" | "=" => 0xBB,
        "," => 0xBC,
        "-" => 0xBD,
        "." => 0xBE,
        "/" => 0xBF,
        ";" => 0xBA,
        "[" => 0xDB,
        "\\" => 0xDC,
        "]" => 0xDD,
        "`" => 0xC0,
        "BACKSPACE" => 0x08,
        "TAB" => 0x09,
        "ENTER" => 0x0D,
        "ESC" | "ESCAPE" => 0x1B,
        "SPACE" => 0x20,
        "PAGEUP" => 0x21,
        "PAGEDOWN" => 0x22,
        "END" => 0x23,
        "HOME" => 0x24,
        "LEFT" | "ARROWLEFT" => 0x25,
        "UP" | "ARROWUP" => 0x26,
        "RIGHT" | "ARROWRIGHT" => 0x27,
        "DOWN" | "ARROWDOWN" => 0x28,
        "INSERT" => 0x2D,
        "DELETE" => 0x2E,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_hotkey, Modifiers};

    #[test]
    fn parses_function_key_with_modifiers() {
        let hotkey = parse_hotkey("Ctrl+Shift+F8").expect("valid hotkey");
        assert_eq!(hotkey.key, 0x77);
        assert_eq!(
            hotkey.modifiers,
            Modifiers {
                control: true,
                shift: true,
                ..Modifiers::default()
            }
        );
    }

    #[test]
    fn parses_plus_key() {
        let hotkey = parse_hotkey("Ctrl+Shift++").expect("valid hotkey");
        assert_eq!(hotkey.key, 0xBB);
        assert!(hotkey.modifiers.control);
        assert!(hotkey.modifiers.shift);
    }

    #[test]
    fn rejects_unknown_keys_and_modifiers() {
        assert!(parse_hotkey("Hyper+F8").is_none());
        assert!(parse_hotkey("Ctrl+VolumeUp").is_none());
    }
}
