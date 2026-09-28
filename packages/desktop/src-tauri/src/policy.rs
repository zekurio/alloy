use url::Url;

pub const CONNECT_WINDOW_LABEL: &str = "connect";
pub const SERVER_WINDOW_PREFIX: &str = "server-";

pub fn is_local_app_url(url: &Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("tauri.localhost")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn is_same_origin(url: &Url, origin: &Url) -> bool {
    url.origin() == origin.origin()
}

pub fn remote_window_label(generation: u64) -> String {
    format!("{SERVER_WINDOW_PREFIX}{generation}")
}

/// The initialization script runs in the main frame only. It still checks
/// the origin because a WebView can navigate more than once.
pub fn bridge_initialization_script(origin: &Url) -> String {
    let origin = serde_json::to_string(&origin.origin().ascii_serialization())
        .expect("a URL origin is always valid JSON");
    let script = include_str!("bridge.js");
    script.replace("\"__ALLOY_SELECTED_ORIGIN__\"", &origin)
}
