//! The protocol channel to the host: one JSON line per response or event.

use std::{
    io::{self, LineWriter, Write},
    sync::{Mutex, OnceLock},
};

use crate::types::{EventEnvelope, RecordingEvent};

static PROTOCOL_OUTPUT: OnceLock<Mutex<Box<dyn Write + Send>>> = OnceLock::new();

/// Takes stdout for the protocol. Call once, before OBS loads.
pub(super) fn claim_protocol_output() {
    PROTOCOL_OUTPUT.get_or_init(|| Mutex::new(protocol_output()));
}

/// On Linux the protocol writes to a private copy of stdout and file
/// descriptor 1 points at stderr, so nothing libobs, a plugin or a helper
/// process prints can split a line: OBS's muxer helper inherits stdout and
/// reports its settings there.
#[cfg(target_os = "linux")]
fn protocol_output() -> Box<dyn Write + Send> {
    use std::{fs::File, os::fd::FromRawFd};

    // SAFETY: descriptors 1 and 2 are the process's standard streams; the
    // duplicate is owned by the returned file from here on.
    unsafe {
        let protocol = libc::fcntl(libc::STDOUT_FILENO, libc::F_DUPFD_CLOEXEC, 3);
        if protocol < 0 {
            return Box::new(io::stdout());
        }
        libc::dup2(libc::STDERR_FILENO, libc::STDOUT_FILENO);
        Box::new(LineWriter::new(File::from_raw_fd(protocol)))
    }
}

#[cfg(windows)]
fn protocol_output() -> Box<dyn Write + Send> {
    Box::new(LineWriter::new(io::stdout()))
}

pub(super) fn write_protocol_line(line: &str) {
    let output = PROTOCOL_OUTPUT.get_or_init(|| Mutex::new(protocol_output()));
    let mut output = output
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _ = writeln!(output, "{line}");
    let _ = output.flush();
}

pub(super) fn emit_event(event: RecordingEvent) {
    let envelope = EventEnvelope { event };
    if let Ok(line) = serde_json::to_string(&envelope) {
        write_protocol_line(&line);
    }
}
