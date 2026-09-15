use std::io;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum LibraryError {
    #[error("capture was not found")]
    CaptureNotFound,
    #[error("staged import was not found")]
    StagedImportNotFound,
    #[error("invalid capture metadata: {0}")]
    InvalidMetadata(String),
    #[error("invalid trim range")]
    InvalidTrim,
    #[error("invalid export selection: {0}")]
    InvalidExport(String),
    #[error("invalid media path")]
    InvalidPath,
    #[error("unsupported media format")]
    UnsupportedMedia,
    #[error("media tool failed: {0}")]
    MediaTool(String),
    #[error("media tool timed out")]
    MediaToolTimeout,
    #[error("media operation was cancelled")]
    MediaCancelled,
    #[error("download failed: {0}")]
    Download(String),
    #[error("download was cancelled")]
    DownloadCancelled,
    #[error("HTTP request is not allowed")]
    HttpForbidden,
    #[error("HTTP range is not satisfiable")]
    RangeNotSatisfiable,
    #[error("manifest is invalid")]
    InvalidManifest,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
}

pub type Result<T> = std::result::Result<T, LibraryError>;
