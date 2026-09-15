use std::path::{Component, Path, PathBuf};

use alloy_recorder::{names::file_component, protocol::CONTENT_TYPE_MP4};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

use crate::capture_library::error::{LibraryError, Result};

pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "mov", "webm"];
pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];

pub fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

pub fn is_video(path: &Path) -> bool {
    extension(path).is_some_and(|value| VIDEO_EXTENSIONS.contains(&value.as_str()))
}

pub fn is_image(path: &Path) -> bool {
    extension(path).is_some_and(|value| IMAGE_EXTENSIONS.contains(&value.as_str()))
}

pub fn is_media(path: &Path) -> bool {
    is_video(path) || is_image(path)
}

pub fn content_type(path: &Path) -> &'static str {
    match extension(path).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("mp4") => CONTENT_TYPE_MP4,
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

pub(crate) fn extension_for_content_type(value: &str) -> Option<&'static str> {
    match value {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        CONTENT_TYPE_MP4 => Some("mp4"),
        "video/quicktime" => Some("mov"),
        "video/x-matroska" => Some("mkv"),
        "video/webm" => Some("webm"),
        _ => None,
    }
}

pub fn capture_id(value: impl AsRef<Path>) -> String {
    let path = value.as_ref();
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        normalized.make_ascii_lowercase();
    }
    let digest = Sha256::digest(normalized.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)[..22].to_string()
}

pub fn manifest_key(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

pub fn normalize_absolute(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return Err(LibraryError::InvalidPath);
    }
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    Ok(normalize_path(&absolute))
}

pub fn ensure_within(root: &Path, candidate: &Path) -> Result<PathBuf> {
    let root = normalize_absolute(root)?;
    let candidate = normalize_absolute(candidate)?;
    if !candidate.starts_with(&root) {
        return Err(LibraryError::InvalidPath);
    }
    Ok(candidate)
}

/// Sanitizes one path component exactly the way the recorder does, so a clip
/// the host downloads or imports lands in the same game folder the recorder
/// would have recorded it into.
pub(crate) fn safe_component(value: Option<&str>, fallback: &str) -> String {
    file_component(value.unwrap_or_default(), fallback)
}

/// [`safe_component`] capped at 128 characters, for use as a file stem.
pub(crate) fn safe_file_stem(value: Option<&str>, fallback: &str) -> String {
    let component = safe_component(value, fallback);
    component.chars().take(128).collect()
}

pub(crate) fn unique_path(root: &Path, base: &str, extension: &str) -> PathBuf {
    let mut path = root.join(format!("{base}{extension}"));
    let mut counter = 2_u32;
    while path.exists() {
        path = root.join(format!("{base}-{counter}{extension}"));
        counter += 1;
    }
    path
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

pub fn title_for_capture(created_at: &str) -> String {
    let parsed =
        time::OffsetDateTime::parse(created_at, &time::format_description::well_known::Rfc3339);
    match parsed {
        Ok(value) => format!(
            "Clip {}",
            value
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| "capture".to_string())
        ),
        Err(_) => "Clip capture".to_string(),
    }
}

pub fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::{safe_component, safe_file_stem};

    #[test]
    fn matches_the_recorder_sanitizer() {
        // The recorder trims separators from both ends and collapses runs, so
        // the host lands in the same folder for the same game title.
        assert_eq!(
            safe_component(Some("-Half-Life: Alyx "), "x"),
            "Half-Life-Alyx"
        );
        assert_eq!(safe_component(Some(".hidden"), "x"), "hidden");
        assert_eq!(safe_component(Some("  "), "Uncategorized"), "Uncategorized");
        assert_eq!(safe_component(None, "Uncategorized"), "Uncategorized");
        assert_eq!(safe_component(Some("COM1"), "clip"), "clip");
        assert_eq!(safe_component(Some("nul.mp4"), "clip"), "clip");
    }

    #[test]
    fn file_stem_is_capped_at_128_characters() {
        let long = "a".repeat(200);
        assert_eq!(safe_file_stem(Some(&long), "import").chars().count(), 128);
    }
}
