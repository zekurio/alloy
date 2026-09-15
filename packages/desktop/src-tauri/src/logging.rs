//! Host diagnostics. Release builds run without a console, so every message
//! also lands in a log file under the app's local data folder.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

const LOG_FILE: &str = "alloy-desktop.log";
const ROTATED_LOG_FILE: &str = "alloy-desktop.1.log";
const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;

struct FileLogger {
    file: Mutex<File>,
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info && metadata.target().starts_with("alloy")
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "{} {:<5} {}\n",
            time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            record.level(),
            record.args()
        );
        eprint!("{line}");
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

/// Appends host diagnostics to `<dir>/alloy-desktop.log`. A file that has
/// grown past a few megabytes is kept as one rotated copy.
pub fn init(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(LOG_FILE);
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() > MAX_LOG_BYTES) {
        let _ = fs::rename(&path, dir.join(ROTATED_LOG_FILE));
    }
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    log::set_boxed_logger(Box::new(FileLogger {
        file: Mutex::new(file),
    }))
    .map_err(std::io::Error::other)?;
    log::set_max_level(log::LevelFilter::Info);
    Ok(())
}
