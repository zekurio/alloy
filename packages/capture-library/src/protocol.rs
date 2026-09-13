use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path as RoutePath, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::any;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_util::io::ReaderStream;
use url::Url;
use uuid::Uuid;

use crate::error::{LibraryError, Result};
use crate::media::generate_thumbnail;
use crate::paths::{content_type, extension, is_media};
use crate::store::CaptureLibrary;

const TOKEN_QUERY: &str = "token";
const MAX_ID_LENGTH: usize = 64;

#[derive(Clone)]
struct HttpState {
    library: CaptureLibrary,
    access: Arc<RwLock<AccessState>>,
}

#[derive(Clone, Debug)]
struct AccessState {
    token: String,
    selected_origin: Option<String>,
}

/// Loopback file server used by the web renderer for local media. The token
/// is required on every route, and changes whenever the selected server origin
/// changes. Routes accept capture IDs only; they never accept file paths.
pub struct CaptureHttpServer {
    state: Arc<HttpState>,
    addr: std::net::SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl CaptureHttpServer {
    pub async fn start(library: CaptureLibrary) -> Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let addr = listener.local_addr()?;
        let access = Arc::new(RwLock::new(AccessState {
            token: new_token(),
            selected_origin: None,
        }));
        let state = Arc::new(HttpState { library, access });
        let router = Router::new()
            .route("/{kind}/{id}", any(handle_request))
            .with_state(state.clone());
        let (shutdown, signal) = oneshot::channel();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = signal.await;
                })
                .await;
        });
        Ok(Self {
            state,
            addr,
            shutdown: Some(shutdown),
            task: Some(task),
        })
    }

    pub fn addr(&self) -> std::net::SocketAddr {
        self.addr
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.addr.port())
    }

    pub fn media_url(&self, id: &str) -> Result<String> {
        self.url_for("media", id)
    }

    pub fn thumbnail_url(&self, id: &str) -> Result<String> {
        self.url_for("thumbnail", id)
    }

    pub fn export_url(&self, id: &str) -> Result<String> {
        self.url_for("export", id)
    }

    /// Selects the origin allowed to read local media. Rotating the token
    /// makes URLs issued for the previous server unusable.
    pub async fn set_selected_origin(&self, origin: Option<Url>) -> Result<()> {
        let normalized = origin.map(normalize_origin).transpose()?;
        let mut access = self
            .state
            .access
            .write()
            .map_err(|_| LibraryError::InvalidPath)?;
        access.selected_origin = normalized;
        access.token = new_token();
        Ok(())
    }

    pub fn selected_origin(&self) -> Option<String> {
        self.state
            .access
            .read()
            .ok()
            .and_then(|access| access.selected_origin.clone())
    }

    pub async fn shutdown(mut self) {
        if let Some(signal) = self.shutdown.take() {
            let _ = signal.send(());
        }
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }

    fn url_for(&self, kind: &str, id: &str) -> Result<String> {
        if !valid_id(id) {
            return Err(LibraryError::InvalidPath);
        }
        let token = self
            .state
            .access
            .read()
            .map_err(|_| LibraryError::InvalidPath)?
            .token
            .clone();
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        serializer.append_pair(TOKEN_QUERY, &token);
        Ok(format!(
            "{}/{kind}/{id}?{}",
            self.base_url(),
            serializer.finish()
        ))
    }
}

impl Drop for CaptureHttpServer {
    fn drop(&mut self) {
        if let Some(signal) = self.shutdown.take() {
            let _ = signal.send(());
        }
    }
}

async fn handle_request(
    State(state): State<Arc<HttpState>>,
    RoutePath((kind, id)): RoutePath<(String, String)>,
    method: Method,
    headers: HeaderMap,
    uri: axum::http::Uri,
) -> Response {
    let access = match authorize(&state.access, &headers, uri.query()) {
        Ok(access) => access,
        Err(status) => return plain_response(status, "forbidden"),
    };
    if method == Method::OPTIONS {
        return cors_response(access.as_deref());
    }
    if method != Method::GET && method != Method::HEAD {
        return plain_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    if !valid_id(&id) {
        return plain_response(StatusCode::NOT_FOUND, "not found");
    }

    let path = match kind.as_str() {
        "media" => state.library.media_path(&id),
        "export" => state
            .library
            .export_path(&id)
            .and_then(canonical_file_in_parent),
        "thumbnail" => thumbnail_file(&state.library, &id).await,
        _ => Err(LibraryError::CaptureNotFound),
    };
    let path = match path {
        Ok(path) if path.is_file() => path,
        _ => return plain_response(StatusCode::NOT_FOUND, "not found"),
    };
    if !is_media(&path) && kind != "export" {
        return plain_response(StatusCode::NOT_FOUND, "not found");
    }
    match ranged_response(&path, &method, headers.get("range"), access.as_deref()).await {
        Ok(response) => response,
        Err(LibraryError::RangeNotSatisfiable) => {
            let mut response =
                plain_response(StatusCode::RANGE_NOT_SATISFIABLE, "range not satisfiable");
            if let Ok(metadata) = tokio::fs::metadata(&path).await
                && let Ok(value) =
                    http::HeaderValue::from_str(&format!("bytes */{}", metadata.len()))
            {
                response.headers_mut().insert("Content-Range", value);
            }
            response.headers_mut().insert(
                "Access-Control-Expose-Headers",
                http::HeaderValue::from_static("Content-Length, Content-Range, Accept-Ranges"),
            );
            response.headers_mut().insert(
                "Access-Control-Allow-Origin",
                http::HeaderValue::from_str(access.as_deref().unwrap_or("*"))
                    .unwrap_or_else(|_| http::HeaderValue::from_static("*")),
            );
            response
        }
        Err(_) => plain_response(StatusCode::NOT_FOUND, "not found"),
    }
}

fn authorize(
    access: &RwLock<AccessState>,
    headers: &HeaderMap,
    query: Option<&str>,
) -> std::result::Result<Option<String>, StatusCode> {
    let token = url::form_urlencoded::parse(query.unwrap_or_default().as_bytes())
        .find_map(|(key, value)| (key == TOKEN_QUERY).then(|| value.into_owned()));
    let access = access
        .read()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if token.as_deref() != Some(access.token.as_str()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if let Some(selected) = &access.selected_origin
        && let Some(origin) = headers.get("origin").and_then(|value| value.to_str().ok())
        && origin.trim_end_matches('/') != selected
    {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(access.selected_origin.clone())
}

async fn thumbnail_file(library: &CaptureLibrary, id: &str) -> Result<PathBuf> {
    let folder = library.thumbnail_path(id)?;
    if let Ok(mut entries) = tokio::fs::read_dir(&folder).await {
        let mut newest: Option<(SystemTime, PathBuf)> = None;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let file_type = entry.file_type().await?;
            if !file_type.is_file() || extension(&path).as_deref() != Some("jpg") {
                continue;
            }
            let metadata = entry.metadata().await?;
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            if newest.as_ref().is_none_or(|(time, _)| modified > *time) {
                newest = Some((modified, path));
            }
        }
        if let Some((_, path)) = newest {
            let folder = folder.canonicalize()?;
            let path = path.canonicalize()?;
            if !path.starts_with(&folder) {
                return Err(LibraryError::InvalidPath);
            }
            return Ok(path);
        }
    }
    let item = library.find_item(id).ok_or(LibraryError::CaptureNotFound)?;
    let source = PathBuf::from(&item.filename).canonicalize()?;
    if item.kind == crate::types::CaptureKind::Screenshot {
        return Ok(source);
    }
    generate_thumbnail(library, id, &source).await
}

async fn ranged_response(
    path: &Path,
    method: &Method,
    range_header: Option<&http::HeaderValue>,
    origin: Option<&str>,
) -> Result<Response> {
    let metadata = tokio::fs::metadata(path).await?;
    if !metadata.is_file() {
        return Err(LibraryError::CaptureNotFound);
    }
    let size = metadata.len();
    let range = parse_range(range_header.and_then(|value| value.to_str().ok()), size)?;
    let (status, start, length) = match range {
        Some(range) => (
            StatusCode::PARTIAL_CONTENT,
            range.start,
            range.end.saturating_sub(range.start).saturating_add(1),
        ),
        None => (StatusCode::OK, 0, size),
    };
    let mut response = Response::builder()
        .status(status)
        .header("Content-Type", content_type(path))
        .header("Content-Length", length.to_string())
        .header("Accept-Ranges", "bytes")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
        )
        .header("Cache-Control", "no-store")
        .header("Vary", "Origin");
    if let Some(origin) = origin {
        response = response.header("Access-Control-Allow-Origin", origin);
    } else {
        response = response.header("Access-Control-Allow-Origin", "*");
    }
    if let Some(range) = range {
        response = response.header(
            "Content-Range",
            format!("bytes {}-{}/{}", range.start, range.end, size),
        );
    }
    if *method == Method::HEAD {
        return response
            .body(Body::empty())
            .map_err(|_| LibraryError::InvalidPath);
    }
    let mut file = tokio::fs::File::open(path).await?;
    if start > 0 {
        file.seek(SeekFrom::Start(start)).await?;
    }
    let stream = ReaderStream::with_capacity(file.take(length), 4 * 1024 * 1024);
    response
        .body(Body::from_stream(stream))
        .map_err(|_| LibraryError::InvalidPath)
}

#[derive(Clone, Copy)]
struct ByteRange {
    start: u64,
    end: u64,
}

fn parse_range(header: Option<&str>, size: u64) -> Result<Option<ByteRange>> {
    let Some(header) = header else {
        return Ok(None);
    };
    if size == 0 || !header.starts_with("bytes=") || header.contains(',') {
        return Err(LibraryError::RangeNotSatisfiable);
    }
    let Some((start_text, end_text)) = header[6..].trim().split_once('-') else {
        return Err(LibraryError::RangeNotSatisfiable);
    };
    if start_text.is_empty() {
        let suffix = end_text
            .parse::<u64>()
            .map_err(|_| LibraryError::RangeNotSatisfiable)?;
        if suffix == 0 {
            return Err(LibraryError::RangeNotSatisfiable);
        }
        return Ok(Some(ByteRange {
            start: size.saturating_sub(suffix),
            end: size - 1,
        }));
    }
    let start = start_text
        .parse::<u64>()
        .map_err(|_| LibraryError::RangeNotSatisfiable)?;
    if start >= size {
        return Err(LibraryError::RangeNotSatisfiable);
    }
    let end = if end_text.is_empty() {
        size - 1
    } else {
        end_text
            .parse::<u64>()
            .map_err(|_| LibraryError::RangeNotSatisfiable)?
            .min(size - 1)
    };
    if end < start {
        return Err(LibraryError::RangeNotSatisfiable);
    }
    Ok(Some(ByteRange { start, end }))
}

fn cors_response(origin: Option<&str>) -> Response {
    let mut response = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Access-Control-Allow-Headers", "Range, Content-Type")
        .header("Access-Control-Allow-Private-Network", "true")
        .header("Access-Control-Max-Age", "86400")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
        )
        .header("Vary", "Origin");
    response = response.header("Access-Control-Allow-Origin", origin.unwrap_or("*"));
    response.body(Body::empty()).expect("valid CORS response")
}

fn plain_response(status: StatusCode, message: &str) -> Response {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Body::from(message.to_string()))
        .expect("valid error response")
}

fn normalize_origin(origin: Url) -> Result<String> {
    if !matches!(origin.scheme(), "http" | "https")
        || origin.username() != ""
        || origin.password().is_some()
        || (!origin.path().is_empty() && origin.path() != "/")
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err(LibraryError::InvalidMetadata(
            "invalid server origin".into(),
        ));
    }
    Ok(origin.to_string().trim_end_matches('/').to_string())
}

fn canonical_file_in_parent(path: PathBuf) -> Result<PathBuf> {
    let parent = path
        .parent()
        .ok_or(LibraryError::InvalidPath)?
        .canonicalize()?;
    let path = path.canonicalize()?;
    if !path.starts_with(parent) {
        return Err(LibraryError::InvalidPath);
    }
    Ok(path)
}

fn new_token() -> String {
    Uuid::new_v4().simple().to_string()
}

fn valid_id(value: &str) -> bool {
    (12..=MAX_ID_LENGTH).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}
