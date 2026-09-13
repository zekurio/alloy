use std::time::Duration;

use reqwest::{Client, redirect::Policy};
use serde::Deserialize;
use url::{Host, Url};

pub const HTTP_CONTRACT_1: u64 = 1;
pub const TAURI_BRIDGE_CONTRACT_1: u64 = 1;
const MAX_JSON_BODY: usize = 64 * 1024;

#[derive(Clone)]
pub struct Server {
    pub origin: Url,
    pub client: Client,
}

impl Server {
    pub fn new(input: &str) -> Result<Self, String> {
        let origin = server_origin(input)?;
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| "Could not create the HTTP client.")?;
        Ok(Self { origin, client })
    }

    /// Check the exact HTTP and native bridge contracts before opening a
    /// server-hosted webview.
    pub async fn check(&self) -> Result<(), String> {
        let info: ServerInfo = self.get_json("/api/server-info").await?;
        let valid_ids = |ids: &[u64]| ids.iter().all(|id| *id > 0 && *id <= 9_007_199_254_740_991);
        if info.schema != "alloy.server-info"
            || info.product != "alloy"
            || info.version.trim().is_empty()
            || !valid_ids(&info.http_contracts)
            || !info.http_contracts.contains(&HTTP_CONTRACT_1)
            || !valid_ids(&info.desktop_tauri_bridge_contracts)
            || !info
                .desktop_tauri_bridge_contracts
                .contains(&TAURI_BRIDGE_CONTRACT_1)
            || info.capabilities.auth.desktop_auth != 1
            || info.capabilities.auth.session_cookies != 1
            || info.capabilities.transport.json != 1
            || info.capabilities.transport.credentialed_fetch != 1
        {
            return Err("This server does not support Alloy desktop HTTP contract 1.".into());
        }

        let config: AuthConfig = self.get_json("/api/auth-config").await?;
        if config.setup_required {
            return Err("Finish server setup in your browser, then connect again.".into());
        }
        if config.desktop_auth.version != 1 {
            return Err("This server does not support desktop login.".into());
        }
        Ok(())
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let response = self
            .client
            .get(self.origin.join(path).map_err(|_| "Invalid API path.")?)
            .timeout(Duration::from_secs(8))
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|_| "Could not reach the Alloy server.")?;
        if !response.status().is_success() {
            return Err(format!(
                "Server check failed with HTTP {}.",
                response.status().as_u16()
            ));
        }
        let bytes = read_body(response, MAX_JSON_BODY).await?;
        serde_json::from_slice(&bytes)
            .map_err(|_| "The server returned an invalid Alloy response.".into())
    }
}

/// Read a response without allowing an untrusted server to allocate an
/// unbounded buffer. Login and capability probes use this helper.
pub async fn read_body(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("The server response is too large.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the server response.")?
    {
        if body.len().saturating_add(chunk.len()) > limit {
            return Err("The server response is too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub fn server_origin(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.is_empty() || input.contains('\\') {
        return Err("Enter an Alloy server URL.".into());
    }
    let explicit_scheme = input.contains("://");
    let mut url = Url::parse(if explicit_scheme { input } else { "" })
        .or_else(|_| Url::parse(&format!("https://{input}")))
        .map_err(|_| "Enter a valid server URL.")?;
    let loopback = is_loopback(&url);
    // A bare "localhost:5173" is a local dev server, which never speaks TLS.
    if !explicit_scheme && loopback {
        url.set_scheme("http").map_err(|_| "Enter a valid server URL.")?;
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || !(url.scheme() == "https" || url.scheme() == "http" && loopback)
        || url.host().is_none()
    {
        return Err("Use HTTPS. HTTP is allowed only for loopback development.".into());
    }
    if !matches!(url.path(), "/" | "" | "/api" | "/api/") {
        return Err("Enter the server origin without a path.".into());
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    schema: String,
    version: String,
    product: String,
    http_contracts: Vec<u64>,
    desktop_tauri_bridge_contracts: Vec<u64>,
    capabilities: Capabilities,
}

#[derive(Deserialize)]
struct Capabilities {
    auth: AuthCapabilities,
    transport: TransportCapabilities,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthCapabilities {
    desktop_auth: u64,
    session_cookies: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransportCapabilities {
    json: u64,
    credentialed_fetch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthConfig {
    setup_required: bool,
    desktop_auth: AuthVersion,
}

#[derive(Deserialize)]
struct AuthVersion {
    version: u64,
}

#[cfg(test)]
mod tests {
    use super::server_origin;

    #[test]
    fn accepts_https_and_loopback_http_origins() {
        for input in [
            "https://alloy.example/api/",
            "alloy.example",
            "http://localhost:2552",
            "http://127.0.0.1:2552",
            "http://[::1]:2552",
        ] {
            assert!(server_origin(input).is_ok(), "{input}");
        }
    }

    #[test]
    fn defaults_bare_hosts_to_https_and_bare_loopback_to_http() {
        assert_eq!(
            server_origin("alloy.example").unwrap().as_str(),
            "https://alloy.example/"
        );
        assert_eq!(
            server_origin("localhost:5173").unwrap().as_str(),
            "http://localhost:5173/"
        );
        assert_eq!(
            server_origin("127.0.0.1:5173").unwrap().as_str(),
            "http://127.0.0.1:5173/"
        );
        assert_eq!(
            server_origin("https://localhost:5173").unwrap().as_str(),
            "https://localhost:5173/"
        );
    }

    #[test]
    fn rejects_credentials_non_loopback_http_and_paths() {
        for input in [
            "",
            "http://alloy.example",
            "http://localhost.evil",
            "https://user:secret@alloy.example",
            "file:///tmp/app",
            "https://alloy.example/subpath",
            "https://alloy.example\\@evil",
        ] {
            assert!(server_origin(input).is_err(), "{input}");
        }
    }
}
