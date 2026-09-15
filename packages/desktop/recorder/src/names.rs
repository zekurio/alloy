//! Filesystem-name sanitizers shared with the desktop host.
//!
//! Capture filenames are produced by the agent and consumed by the host's
//! library, so both sides must agree on what a safe path component looks like.

/// Turns arbitrary text (a game title, a window caption) into a single safe
/// path component, falling back to `fallback` when nothing usable remains.
pub fn file_component(value: &str, fallback: &str) -> String {
    let mut component = String::new();
    let mut previous_was_separator = false;

    for ch in value.trim().chars() {
        let replacement = if ch.is_control()
            || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        {
            '-'
        } else {
            ch
        };

        if replacement == '-' || replacement.is_whitespace() {
            if !previous_was_separator && !component.is_empty() {
                component.push(if replacement.is_whitespace() {
                    ' '
                } else {
                    '-'
                });
                previous_was_separator = true;
            }
            continue;
        }

        component.push(replacement);
        previous_was_separator = false;
    }

    let component = component.trim_matches([' ', '.', '-']).to_string();
    if component.is_empty() || is_reserved_windows_name(&component) {
        fallback.to_string()
    } else {
        component
    }
}

/// Whether the name collides with a reserved Windows device name (`CON`,
/// `COM1`, …), which cannot be used as a file name even with an extension.
pub fn is_reserved_windows_name(value: &str) -> bool {
    let base = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg(test)]
mod tests {
    use super::{file_component, is_reserved_windows_name};

    #[test]
    fn collapses_unsafe_characters() {
        assert_eq!(
            file_component("Half-Life: Alyx", "Desktop"),
            "Half-Life-Alyx"
        );
        assert_eq!(file_component("  spaced   out  ", "Desktop"), "spaced out");
    }

    #[test]
    fn falls_back_on_empty_and_reserved_names() {
        assert_eq!(file_component("   ", "Desktop"), "Desktop");
        assert_eq!(file_component("nul", "Desktop"), "Desktop");
    }

    #[test]
    fn detects_reserved_names_with_extensions() {
        assert!(is_reserved_windows_name("COM1.txt"));
        assert!(!is_reserved_windows_name("COM10"));
        assert!(!is_reserved_windows_name("console"));
    }
}
