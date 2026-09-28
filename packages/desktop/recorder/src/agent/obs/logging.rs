use std::{
    ffi::{c_char, c_int, c_void},
    io::{self, Write},
    ptr,
};

use libloading::Library;

use super::load_symbol;

// OBS and the Windows CRT pass va_list as a char pointer. Keep the argument
// list opaque and let the CRT format it using the same ABI as libobs.
type LogHandler = unsafe extern "C" fn(c_int, *const c_char, *mut c_char, *mut c_void);
type SetLogHandler = unsafe extern "C" fn(Option<LogHandler>, *mut c_void);

#[cfg_attr(target_env = "msvc", link(name = "legacy_stdio_definitions"))]
unsafe extern "C" {
    fn vsnprintf(
        buffer: *mut c_char,
        count: usize,
        format: *const c_char,
        args: *mut c_char,
    ) -> c_int;
}

pub(super) unsafe fn install(library: &Library) -> Result<(), String> {
    let set_log_handler: SetLogHandler = load_symbol(library, b"base_set_log_handler\0")?;
    // The default OBS handler writes most levels to stdout, which is reserved
    // for the sidecar JSON protocol. Install before any OBS initialization.
    set_log_handler(Some(log_to_stderr), ptr::null_mut());
    Ok(())
}

unsafe extern "C" fn log_to_stderr(
    level: c_int,
    format: *const c_char,
    args: *mut c_char,
    _param: *mut c_void,
) {
    // Match the default OBS handler's bounded formatting buffer.
    let mut buffer = [0u8; 8192];
    let written = vsnprintf(buffer.as_mut_ptr().cast(), buffer.len(), format, args);
    let message = if written < 0 {
        "Could not format OBS log message.".into()
    } else {
        let length = (written as usize).min(buffer.len() - 1);
        String::from_utf8_lossy(&buffer[..length])
    };
    let level = match level {
        100 => "error",
        200 => "warning",
        300 => "info",
        400 => "debug",
        _ => "unknown",
    };
    // Unlike eprintln!, this does not panic if the host closes its log pipe.
    let _ = writeln!(io::stderr().lock(), "[obs] {level}: {message}");
}
