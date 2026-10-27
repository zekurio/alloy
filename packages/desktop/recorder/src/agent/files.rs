//! File moves shared by the platform recorders.

use std::{fs, io, path::Path};

/// Copies across drives through a dot-prefixed temporary file beside the
/// destination, then renames it into place. The host skips dot-prefixed
/// files when it scans the library, so a copy the watchdog kills halfway
/// never shows up as a clip, and the stray is swept at the next start.
pub(in crate::agent) fn copy_then_rename(source: &Path, output: &Path) -> io::Result<()> {
    let file_name = output
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("replay.mp4");
    let (stem, extension) = file_name.rsplit_once('.').unwrap_or((file_name, "mp4"));
    let temporary =
        output.with_file_name(format!(".{stem}.{}.tmp.{extension}", std::process::id()));
    if let Err(error) = fs::copy(source, &temporary).and_then(|_| fs::rename(&temporary, output)) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}
