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

#[cfg(test)]
mod tests {
    use std::{env, ffi::CString, path::PathBuf, process::Command};

    use super::*;
    use crate::agent::obs::LibObs;

    #[test]
    #[ignore = "Requires ALLOY_TEST_OBS_RUNTIME"]
    fn obs_logs_use_stderr_and_leave_protocol_stdout_clean() {
        const CHILD_ENV: &str = "ALLOY_TEST_OBS_LOG_CHILD";
        const PROTOCOL_LINE: &str = "{\"id\":1,\"ok\":true,\"result\":null}";

        if env::var_os(CHILD_ENV).is_some() {
            let runtime = PathBuf::from(env::var("ALLOY_TEST_OBS_RUNTIME").unwrap());
            env::set_current_dir(runtime.join("bin/64bit")).unwrap();
            let obs = LibObs::load(Some(&runtime)).expect("load OBS with log handler");
            // Resolve blog from the same DLL without starting graphics or capture.
            let library = unsafe { Library::new(runtime.join("bin/64bit/obs.dll")) }.unwrap();
            let blog: unsafe extern "C" fn(c_int, *const c_char, ...) =
                unsafe { load_symbol(&library, b"blog\0") }.unwrap();
            for level in [100, 200, 300, 400] {
                unsafe {
                    blog(
                        level,
                        c"log-probe %s %d %.1f".as_ptr(),
                        c"startup".as_ptr(),
                        42 as c_int,
                        1.5f64,
                    )
                };
            }
            let long_message = CString::new(format!("long-probe {}", "x".repeat(9000))).unwrap();
            unsafe { blog(300, c"%s".as_ptr(), long_message.as_ptr()) };
            // Plugin output need not be valid UTF-8; it must still stay off stdout.
            unsafe { blog(200, c"encoding-probe %s".as_ptr(), c"\xff".as_ptr()) };
            writeln!(io::stdout().lock(), "{PROTOCOL_LINE}").unwrap();
            drop(obs);
            return;
        }

        let output = Command::new(env::current_exe().unwrap())
            .args([
                "--exact",
                concat!(
                    module_path!(),
                    "::obs_logs_use_stderr_and_leave_protocol_stdout_clean"
                )
                .strip_prefix("alloy_recorder::")
                .unwrap(),
                "--ignored",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .unwrap();
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(output.status.success(), "{stdout}\n{stderr}");
        assert!(stdout.contains(PROTOCOL_LINE), "{stdout}");
        assert!(!stdout.contains("[obs]"), "{stdout}");
        assert!(!stdout.contains("-probe"), "{stdout}");
        for level in ["error", "warning", "info", "debug"] {
            assert!(
                stderr.contains(&format!("[obs] {level}: log-probe startup 42 1.5")),
                "{stderr}"
            );
        }
        let long_line = stderr
            .lines()
            .find(|line| line.contains("long-probe"))
            .unwrap();
        assert_eq!(long_line.len(), "[obs] info: ".len() + 8191);
        assert!(
            stderr.contains("[obs] warning: encoding-probe \u{fffd}"),
            "{stderr}"
        );
    }
}
