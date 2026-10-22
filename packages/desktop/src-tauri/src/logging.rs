//! Host diagnostics. Release builds run without a console, so every message
//! also lands in a log file under the app's local data folder.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const LOG_FILE: &str = "alloy-desktop.log";
const ROTATED_LOG_FILE: &str = "alloy-desktop.1.log";
const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;

struct FileLogger {
    file: Mutex<LogFile>,
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
        if let Ok(mut file) = self.file.lock() {
            file.write(line.as_bytes());
        }
        // A detached Windows app may not have usable stderr. Diagnostics must
        // still reach the file rather than panic while mirroring to a console.
        let _ = std::io::stderr().write_all(line.as_bytes());
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock()
            && let Some(file) = file.file.as_mut()
        {
            let _ = file.flush();
        }
    }
}

/// The log file and its size. The tray app runs for weeks, so the file rotates
/// whenever it outgrows `MAX_LOG_BYTES`, not only at launch.
struct LogFile {
    dir: PathBuf,
    file: Option<File>,
    len: u64,
}

impl LogFile {
    fn open(dir: &Path) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(LOG_FILE))?;
        let len = file.metadata().map_or(0, |metadata| metadata.len());
        Ok(Self {
            dir: dir.to_path_buf(),
            file: Some(file),
            len,
        })
    }

    fn write(&mut self, line: &[u8]) {
        if self.len > 0 && self.len + line.len() as u64 > MAX_LOG_BYTES {
            self.rotate();
        }
        if let Some(file) = self.file.as_mut()
            && file.write_all(line).is_ok()
        {
            self.len += line.len() as u64;
        }
    }

    /// Keeps the full file as the one rotated copy and starts an empty one.
    /// Windows cannot rename an open file, so the handle closes first. If the
    /// rename still fails, the file is emptied instead of growing.
    fn rotate(&mut self) {
        self.file = None;
        let path = self.dir.join(LOG_FILE);
        let rotated = fs::rename(&path, self.dir.join(ROTATED_LOG_FILE)).is_ok();
        self.file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(rotated)
            .truncate(!rotated)
            .open(&path)
            .ok();
        self.len = 0;
    }
}

/// Appends host diagnostics to `<dir>/alloy-desktop.log`, keeping one rotated
/// copy once the file grows past a few megabytes.
pub fn init(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    log::set_boxed_logger(Box::new(FileLogger {
        file: Mutex::new(LogFile::open(dir)?),
    }))
    .map_err(std::io::Error::other)?;
    log::set_max_level(log::LevelFilter::Info);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_rotates_when_it_outgrows_the_limit() {
        let temp = tempfile::TempDir::new().unwrap();
        let mut log = LogFile::open(temp.path()).unwrap();
        let mut line = vec![b'x'; 1023];
        line.push(b'\n');
        for _ in 0..3 * MAX_LOG_BYTES / 1024 {
            log.write(&line);
        }

        let current = fs::metadata(temp.path().join(LOG_FILE)).unwrap().len();
        let rotated = fs::metadata(temp.path().join(ROTATED_LOG_FILE))
            .unwrap()
            .len();
        assert!(current <= MAX_LOG_BYTES, "{current}");
        assert!(rotated <= MAX_LOG_BYTES, "{rotated}");
        assert!(rotated > MAX_LOG_BYTES - 1024, "{rotated}");
    }
}
