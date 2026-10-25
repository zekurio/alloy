use url::Url;

pub const CONNECT_WINDOW_LABEL: &str = "connect";
pub const SERVER_WINDOW_PREFIX: &str = "server-";

/// Whether `url` belongs to the bundled connect screen. Tauri serves it
/// from `http://tauri.localhost` on Windows and from `tauri://localhost` on
/// Linux and macOS, where WebKit registers `tauri` as a custom scheme.
pub fn is_local_app_url(url: &Url) -> bool {
    let bundled = if cfg!(windows) {
        url.scheme() == "http" && url.host_str() == Some("tauri.localhost")
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost")
    };
    bundled && url.port().is_none() && url.username().is_empty() && url.password().is_none()
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

#[cfg(test)]
mod tests {
    use super::is_local_app_url;
    use url::Url;

    fn local(url: &str) -> bool {
        is_local_app_url(&Url::parse(url).expect("valid test URL"))
    }

    #[test]
    fn accepts_the_platform_app_origin() {
        let bundled = if cfg!(windows) {
            "http://tauri.localhost/index.html"
        } else {
            "tauri://localhost/index.html"
        };
        assert!(local(bundled));
    }

    #[test]
    fn rejects_other_origins() {
        assert!(!local("https://alloy.example/index.html"));
        assert!(!local("http://tauri.localhost:8080/index.html"));
        assert!(!local("http://user@tauri.localhost/index.html"));
        assert!(!local("about:blank"));
        // The other platform's bundled origin is not served here.
        let foreign = if cfg!(windows) {
            "tauri://localhost/index.html"
        } else {
            "http://tauri.localhost/index.html"
        };
        assert!(!local(foreign));
    }
}
