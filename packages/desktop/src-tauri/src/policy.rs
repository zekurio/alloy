use url::Url;

/// Where WebView2 serves the bundled connect screen from.
pub const LOCAL_APP_ORIGIN: &str = "http://tauri.localhost";

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

#[cfg(test)]
mod tests {
    use super::{
        LOCAL_APP_ORIGIN, bridge_initialization_script, is_local_app_url, is_same_origin,
        remote_window_label,
    };
    use crate::server::TAURI_BRIDGE_CONTRACT_1;
    use url::Url;

    #[test]
    fn origin_checks_are_exact() {
        let local = Url::parse(&format!("{LOCAL_APP_ORIGIN}/index.html")).unwrap();
        assert!(is_local_app_url(&local));
        assert!(!is_local_app_url(
            &Url::parse("https://tauri.localhost/index.html").unwrap()
        ));

        let selected = Url::parse("https://alloy.example/").unwrap();
        assert!(is_same_origin(
            &Url::parse("https://alloy.example/dashboard").unwrap(),
            &selected
        ));
        assert!(!is_same_origin(
            &Url::parse("https://evil.example/dashboard").unwrap(),
            &selected
        ));
    }

    #[test]
    fn bridge_script_is_origin_bound() {
        let origin = Url::parse("https://alloy.example/").unwrap();
        let script = bridge_initialization_script(&origin);
        assert!(script.contains("window.location.origin !== selectedOrigin"));
        assert!(script.contains("desktop_shell"));
        assert!(script.contains("minimizeWindow"));
        assert!(script.contains("toggleMaximizeWindow"));
        assert!(script.contains("openConnect"));
        assert!(script.contains(&format!("bridgeContract: {TAURI_BRIDGE_CONTRACT_1}")));
        assert!(!script.contains("accessToken"));
        assert!(!script.contains("refreshToken"));
    }

    #[test]
    fn remote_labels_are_unique_per_lifecycle() {
        assert_eq!(remote_window_label(1), "server-1");
        assert_ne!(remote_window_label(1), remote_window_label(2));
    }
}
