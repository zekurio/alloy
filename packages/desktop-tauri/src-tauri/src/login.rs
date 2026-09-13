use std::time::Duration;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};
use url::Url;

use crate::server::{Server, read_body};

const MAX_TOKEN_BODY: usize = 64 * 1024;

/// Credentials stay in native memory until they are written to the selected
/// webview's cookie store. This type is never serialized into a Tauri result.
pub struct SessionTokens {
    access_token: String,
    refresh_token: String,
    access_expires_at: String,
    refresh_expires_at: String,
}

impl SessionTokens {
    pub fn cookie_headers(&self, server: &Url) -> Result<[String; 2], String> {
        let host = server
            .host_str()
            .ok_or_else(|| "The server URL has no host.".to_string())?;
        let secure = server.scheme() == "https";
        Ok([
            session_cookie(
                "alloy_access",
                &self.access_token,
                &self.access_expires_at,
                host,
                secure,
            )?,
            session_cookie(
                "alloy_refresh",
                &self.refresh_token,
                &self.refresh_expires_at,
                host,
                secure,
            )?,
        ])
    }
}

pub struct BrowserLogin {
    listener: TcpListener,
    state: String,
    verifier: String,
    pub authorize_url: Url,
}

impl BrowserLogin {
    pub async fn prepare(server: &Server) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "Could not start the login callback listener.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not read the login callback port.")?
            .port();
        let state = random_secret();
        let verifier = random_secret();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut authorize_url = server
            .origin
            .join("/api/auth/desktop/authorize")
            .map_err(|_| "Invalid server URL.")?;
        authorize_url
            .query_pairs_mut()
            .append_pair("redirect_uri", &format!("http://127.0.0.1:{port}/callback"))
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge);
        Ok(Self {
            listener,
            state,
            verifier,
            authorize_url,
        })
    }

    pub async fn finish(self, server: &Server) -> Result<SessionTokens, String> {
        timeout(
            Duration::from_secs(5 * 60),
            self.receive_and_exchange(server),
        )
        .await
        .map_err(|_| "Sign-in timed out. Connect again to retry.".to_string())?
    }

    async fn receive_and_exchange(&self, server: &Server) -> Result<SessionTokens, String> {
        loop {
            let (stream, _) = self
                .listener
                .accept()
                .await
                .map_err(|_| "Could not receive the login callback.")?;
            let host = self
                .listener
                .local_addr()
                .map_err(|_| "Could not read the callback address.")?
                .to_string();
            let callback = timeout(
                Duration::from_secs(2),
                read_callback(stream, &host, &self.state),
            )
            .await;
            if let Ok(Ok(Some(code))) = callback {
                return self.exchange(server, code).await;
            }
        }
    }

    async fn exchange(&self, server: &Server, code: String) -> Result<SessionTokens, String> {
        let response = server
            .client
            .post(
                server
                    .origin
                    .join("/api/auth/desktop/token")
                    .map_err(|_| "Invalid token URL.")?,
            )
            .json(&serde_json::json!({ "code": code, "codeVerifier": self.verifier }))
            .send()
            .await
            .map_err(|_| "Could not exchange the login code.")?;
        if !response.status().is_success() {
            return Err("The server rejected the login code.".into());
        }
        let body = read_body(response, MAX_TOKEN_BODY).await?;
        let tokens: Tokens = serde_json::from_slice(&body)
            .map_err(|_| "The server returned invalid login credentials.")?;
        SessionTokens::try_from(tokens)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    access_token: String,
    refresh_token: String,
    access_expires_at: String,
    refresh_expires_at: String,
}

impl TryFrom<Tokens> for SessionTokens {
    type Error = String;

    fn try_from(tokens: Tokens) -> Result<Self, Self::Error> {
        validate_token(&tokens.access_token)?;
        validate_token(&tokens.refresh_token)?;
        validate_expiry(&tokens.access_expires_at)?;
        validate_expiry(&tokens.refresh_expires_at)?;
        Ok(Self {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            access_expires_at: tokens.access_expires_at,
            refresh_expires_at: tokens.refresh_expires_at,
        })
    }
}

fn validate_token(token: &str) -> Result<(), String> {
    if token.is_empty()
        || token.len() > 4096
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err("The server returned an invalid session token.".into());
    }
    Ok(())
}

fn validate_expiry(expires: &str) -> Result<(), String> {
    let expires =
        time::OffsetDateTime::parse(expires, &time::format_description::well_known::Rfc3339)
            .map_err(|_| "The server returned an invalid session expiry.")?;
    if expires <= time::OffsetDateTime::now_utc() {
        return Err("The login session has expired. Connect again.".into());
    }
    Ok(())
}

fn session_cookie(
    name: &str,
    token: &str,
    expires: &str,
    host: &str,
    secure: bool,
) -> Result<String, String> {
    validate_token(token)?;
    let expires =
        time::OffsetDateTime::parse(expires, &time::format_description::well_known::Rfc3339)
            .map_err(|_| "The server returned an invalid session expiry.")?;
    let seconds = (expires - time::OffsetDateTime::now_utc()).whole_seconds();
    if seconds <= 0 {
        return Err("The login session has expired. Connect again.".into());
    }
    let secure = if secure { "; Secure" } else { "" };
    Ok(format!(
        "{name}={token}; Domain={host}; Path=/; HttpOnly; SameSite=Lax; Max-Age={seconds}{secure}"
    ))
}

fn random_secret() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

async fn read_callback(
    mut stream: TcpStream,
    host: &str,
    state: &str,
) -> Result<Option<String>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    while !bytes.windows(4).any(|value| value == b"\r\n\r\n") {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|_| "Could not read the login callback.")?;
        if count == 0 || bytes.len() + count > 8192 {
            return Ok(None);
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let request = String::from_utf8(bytes).map_err(|_| "Invalid login callback encoding.")?;
    let code = callback_code(&request, host, state);
    let (status, body) = if code.is_some() {
        ("200 OK", "You can close this page and return to Alloy.")
    } else {
        ("400 Bad Request", "Invalid login callback.")
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|_| "Could not reply to the login callback.")?;
    Ok(code)
}

fn callback_code(request: &str, host: &str, state: &str) -> Option<String> {
    let mut lines = request.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    if first.next()? != "GET" {
        return None;
    }
    let path = first.next()?;
    if !matches!(first.next()?, "HTTP/1.0" | "HTTP/1.1")
        || first.next().is_some()
        || !path.starts_with("/callback?")
    {
        return None;
    }
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim())
        .collect();
    if hosts != [host] {
        return None;
    }
    let url = Url::parse(&format!("http://{host}{path}")).ok()?;
    if url.path() != "/callback" {
        return None;
    }
    let states: Vec<_> = url
        .query_pairs()
        .filter(|(key, _)| key == "state")
        .map(|(_, value)| value)
        .collect();
    let codes: Vec<_> = url
        .query_pairs()
        .filter(|(key, _)| key == "code")
        .map(|(_, value)| value)
        .collect();
    if states.len() != 1
        || states[0] != state
        || codes.len() != 1
        || codes[0].is_empty()
        || codes[0].len() > 1024
    {
        return None;
    }
    Some(codes[0].to_string())
}

#[cfg(test)]
mod tests {
    use super::{callback_code, session_cookie};

    #[test]
    fn callback_accepts_only_one_matching_state_and_code() {
        let request = concat!(
            "GET /callback?code=one-time-code&state=expected HTTP/1.1\r\n",
            "Host: 127.0.0.1:1234\r\n",
            "Connection: close\r\n\r\n"
        );
        assert_eq!(
            callback_code(request, "127.0.0.1:1234", "expected").as_deref(),
            Some("one-time-code")
        );
    }

    #[test]
    fn callback_rejects_wrong_host_or_duplicate_parameters() {
        let wrong_host = concat!(
            "GET /callback?code=ok&state=expected HTTP/1.1\r\n",
            "Host: 127.0.0.1:4321\r\n\r\n"
        );
        assert!(callback_code(wrong_host, "127.0.0.1:1234", "expected").is_none());

        let duplicate = concat!(
            "GET /callback?code=ok&state=expected&state=expected HTTP/1.1\r\n",
            "Host: 127.0.0.1:1234\r\n\r\n"
        );
        assert!(callback_code(duplicate, "127.0.0.1:1234", "expected").is_none());
    }

    #[test]
    fn session_cookie_has_native_only_cookie_attributes() {
        let expires = (time::OffsetDateTime::now_utc() + time::Duration::hours(1))
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        let cookie = session_cookie(
            "alloy_access",
            "native-token",
            &expires,
            "alloy.example",
            true,
        )
        .unwrap();
        assert!(cookie.contains("Domain=alloy.example"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(cookie.contains("Secure"));
    }
}
