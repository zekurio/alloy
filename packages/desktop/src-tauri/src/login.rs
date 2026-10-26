use std::time::Duration;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};
use url::Url;

use crate::logging::logged;
use crate::server::{Server, read_body};

const MAX_TOKEN_BODY: usize = 64 * 1024;

/// The cookie that carries an Alloy session. Sessions do not rotate, so a copy
/// stays valid until the session is signed out or expires.
pub const SESSION_COOKIE: &str = "alloy_session";
/// Cookies from before sessions stopped rotating. An upgraded server still
/// accepts the refresh cookie as the session token until the web app's next
/// session check replaces it with `SESSION_COOKIE`.
pub const LEGACY_ACCESS_COOKIE: &str = "alloy_access";
pub const LEGACY_REFRESH_COOKIE: &str = "alloy_refresh";

/// The credential stays in native memory until it is written to the selected
/// webview's cookie store. This type is never serialized into a Tauri result.
pub struct SessionToken {
    token: String,
    cookie_expires_at: OffsetDateTime,
}

impl SessionToken {
    pub fn cookie_header(&self, server: &Url) -> Result<String, String> {
        let host = server
            .host_str()
            .ok_or_else(|| "The server URL has no host.".to_string())?;
        session_cookie(
            &self.token,
            self.cookie_expires_at,
            host,
            server.scheme() == "https",
        )
    }

    /// The value the host is about to inject, so it can recognise its own
    /// bootstrap cookie in the webview store once the server has set its own.
    /// Owned, because the cleanup outlives the connect call.
    pub fn injected_cookie(&self) -> InjectedCookie {
        InjectedCookie {
            token: self.token.clone(),
        }
    }
}

/// Lets the host tell its injected session cookie apart from the copy the
/// server sets itself. Both carry the same token; only their scope differs.
/// The token stays private so it cannot reach a log or a command result.
#[derive(Clone)]
pub struct InjectedCookie {
    token: String,
}

impl InjectedCookie {
    pub fn is_injected_cookie(&self, name: &str, value: &str) -> bool {
        name == SESSION_COOKIE && value == self.token
    }

    /// Uses the raw WebView2 domain, not cookie::Cookie::domain(), which strips
    /// the leading dot and loses the distinction from a host-only cookie.
    pub fn should_remove(&self, name: &str, value: &str, domain: &str, host: &str) -> bool {
        domain.strip_prefix('.') == Some(host) && self.is_injected_cookie(name, value)
    }

    /// The server's own copy is host-only and set at `/`.
    pub fn has_replacement(
        &self,
        name: &str,
        value: &str,
        domain: &str,
        path: &str,
        host: &str,
    ) -> bool {
        self.is_injected_cookie(name, value) && domain == host && path == "/"
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
            .map_err(logged("Could not start the login callback listener."))?;
        let port = listener
            .local_addr()
            .map_err(logged("Could not read the login callback port."))?
            .port();
        let state = random_secret();
        let verifier = random_secret();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut authorize_url = server
            .origin
            .join("/api/auth/desktop/authorize")
            .map_err(logged("Invalid server URL."))?;
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

    pub async fn finish(self, server: &Server) -> Result<SessionToken, String> {
        timeout(
            Duration::from_secs(5 * 60),
            self.receive_and_exchange(server),
        )
        .await
        .map_err(|_| "Sign-in timed out. Connect again to retry.".to_string())?
    }

    async fn receive_and_exchange(&self, server: &Server) -> Result<SessionToken, String> {
        // A real callback names this listener in its Host header.
        let host = self
            .listener
            .local_addr()
            .map_err(logged("Could not read the callback address."))?
            .to_string();
        loop {
            let (stream, _) = self
                .listener
                .accept()
                .await
                .map_err(logged("Could not receive the login callback."))?;
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

    async fn exchange(&self, server: &Server, code: String) -> Result<SessionToken, String> {
        let mut body = serde_json::json!({ "code": code, "codeVerifier": self.verifier });
        if let Some(device_name) = device_name() {
            body["deviceName"] = device_name.into();
        }
        let response = server
            .client
            .post(
                server
                    .origin
                    .join("/api/auth/desktop/token")
                    .map_err(logged("Invalid token URL."))?,
            )
            .json(&body)
            .send()
            .await
            .map_err(logged("Could not exchange the login code."))?;
        if !response.status().is_success() {
            log::warn!(
                "The token exchange answered with HTTP {}.",
                response.status().as_u16()
            );
            return Err("The server rejected the login code.".into());
        }
        let body = read_body(response, MAX_TOKEN_BODY).await?;
        // The parse error is not logged: it can quote the token.
        let response: TokenResponse = serde_json::from_slice(&body)
            .map_err(|_| "The server returned invalid login credentials.")?;
        SessionToken::try_from(response)
    }
}

/// Servers from before sessions stopped rotating answer with an access and
/// refresh pair instead, which this host no longer injects.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    session_token: Option<String>,
    cookie_expires_at: Option<String>,
}

impl TryFrom<TokenResponse> for SessionToken {
    type Error = String;

    fn try_from(response: TokenResponse) -> Result<Self, Self::Error> {
        let (Some(token), Some(cookie_expires_at)) =
            (response.session_token, response.cookie_expires_at)
        else {
            return Err("Update the Alloy server to sign in with this version of Alloy.".into());
        };
        validate_token(&token)?;
        Ok(Self {
            token,
            cookie_expires_at: parse_expiry(&cookie_expires_at)?,
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

fn parse_expiry(expires: &str) -> Result<OffsetDateTime, String> {
    let expires = OffsetDateTime::parse(expires, &Rfc3339)
        .map_err(|_| "The server returned an invalid session expiry.")?;
    if expires <= OffsetDateTime::now_utc() {
        return Err("The login session has expired. Connect again.".into());
    }
    Ok(expires)
}

/// Builds the `Set-Cookie` header the host injects into the server webview so
/// the first page load is already signed in.
///
/// This cookie only bootstraps that first load. `Domain` is mandatory here —
/// wry hands `cookie.domain()` straight to
/// `ICoreWebView2CookieManager::CreateCookie` and WebView2's
/// `AddOrUpdateCookie` fails without one — while the server's own cookie
/// (`packages/server/src/auth/cookies.ts`) is host-only. On a registrable
/// domain Chromium stores ours as a domain cookie (`.alloy.example`), which
/// every subdomain would receive and which the server cannot delete on
/// sign-out. So the host has the loaded page check its session, which makes
/// the server set its own host-only copy, and then deletes the injected one
/// (`replace_injected_cookie` in `main.rs`). The host is written without a
/// leading dot: adding one would force a domain cookie even where Chromium
/// stores ours host-only (`localhost`, bare IPs, non-public-suffix TLDs).
///
/// `token` passed `validate_token` when the token response was parsed, so it
/// cannot carry cookie attributes of its own.
fn session_cookie(
    token: &str,
    expires: OffsetDateTime,
    host: &str,
    secure: bool,
) -> Result<String, String> {
    // The sign-in can finish a while before the window gets its cookie.
    let seconds = (expires - OffsetDateTime::now_utc()).whole_seconds();
    if seconds <= 0 {
        return Err("The login session has expired. Connect again.".into());
    }
    let secure = if secure { "; Secure" } else { "" };
    Ok(format!(
        "{SESSION_COOKIE}={token}; Domain={host}; Path=/; HttpOnly; SameSite=Lax; Max-Age={seconds}{secure}"
    ))
}

/// The computer name shown in the account's session list. The server tidies
/// it up and ignores it if it is unusable.
fn device_name() -> Option<String> {
    std::env::var("COMPUTERNAME")
        .ok()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

fn random_secret() -> String {
    let mut bytes = [0_u8; 32];
    rand::fill(&mut bytes);
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
    let strings = callback_strings(callback_locale(&request).as_deref().unwrap_or(""));
    let (status, body) = if code.is_some() {
        (
            "200 OK",
            callback_page(strings.lang, strings.success_title, strings.success_message),
        )
    } else {
        (
            "400 Bad Request",
            callback_page(strings.lang, strings.failure_title, strings.failure_message),
        )
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nX-Content-Type-Options: nosniff\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|_| "Could not reply to the login callback.")?;
    Ok(code)
}

/// Static strings for the loopback result page. The listener has no access to
/// the app's `@alloy/i18n` catalog, so this table is the page's only source:
/// a new locale means a new `CALLBACK_STRINGS_*` table plus its language
/// subtag in `callback_strings`. Anything unrecognized falls back to English.
struct CallbackStrings {
    lang: &'static str,
    success_title: &'static str,
    success_message: &'static str,
    failure_title: &'static str,
    failure_message: &'static str,
}

const CALLBACK_STRINGS_EN: CallbackStrings = CallbackStrings {
    lang: "en",
    success_title: "Signed in",
    success_message: "You can close this page and return to Alloy.",
    failure_title: "Sign-in failed",
    failure_message: "This login link is invalid or was already used. Return to Alloy and connect again.",
};

const CALLBACK_STRINGS_DE: CallbackStrings = CallbackStrings {
    lang: "de",
    success_title: "Angemeldet",
    success_message: "Du kannst diese Seite schließen und zu Alloy zurückkehren.",
    failure_title: "Anmeldung fehlgeschlagen",
    failure_message: "Dieser Anmeldelink ist ungültig oder wurde bereits verwendet. Kehre zu Alloy zurück und verbinde dich erneut.",
};

/// Language for the loopback result page. The server appends the browser
/// locale it saw (`locale=de`) to the loopback redirect; only the language
/// subtag matters, so tags like `de-DE` match too.
fn callback_strings(locale: &str) -> &'static CallbackStrings {
    let language = locale.split(['-', '_']).next().unwrap_or("");
    if language.eq_ignore_ascii_case("de") {
        &CALLBACK_STRINGS_DE
    } else {
        &CALLBACK_STRINGS_EN
    }
}

/// The `locale` hint from the loopback callback target, if any. It is read
/// even from a callback `callback_code` rejects, so the failure page is
/// translated too. Only the language table consumes it, so no validation
/// happens here.
fn callback_locale(request: &str) -> Option<String> {
    let target = request.split_whitespace().nth(1)?;
    let (_, query) = target.split_once('?')?;
    // The parser behind `Url::query_pairs`, which `callback_code` uses.
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, value)| key == "locale" && !value.is_empty())
        .map(|(_, value)| value.into_owned())
}

/// A self-contained page in the desktop theme. The browser tab has no access
/// to the app, so it only needs inline styles and static text.
fn callback_page(lang: &str, title: &str, message: &str) -> String {
    format!(
        concat!(
            "<!doctype html>",
            "<html lang=\"{lang}\"><head><meta charset=\"utf-8\">",
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
            "<meta name=\"color-scheme\" content=\"dark\">",
            "<title>{title} - Alloy</title>",
            "<style>",
            "html,body{{height:100%;margin:0}}",
            "body{{display:flex;flex-direction:column;background:oklch(0.19 0 0);color:oklch(0.98 0 0);",
            "font:16px/1.5 \"DM Sans\",ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",Helvetica,Arial,sans-serif;",
            "-webkit-font-smoothing:antialiased}}",
            "header{{display:flex;align-items:center;gap:10px;padding:32px 40px;font:700 20px/1 \"IBM Plex Mono\",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}}",
            "header svg{{display:block;width:36px;height:36px;color:#d0c4eb}}",
            "main{{flex:1;display:flex;align-items:center;justify-content:center;padding:0 24px 96px}}",
            "section{{width:100%;max-width:24rem}}",
            "h1{{margin:0 0 8px;font-size:24px;font-weight:600;letter-spacing:-0.02em}}",
            "p{{margin:0;font-size:14px;color:oklch(0.79 0 0)}}",
            "</style></head><body>",
            "<header>",
            // The page CSP blocks image requests, so the mark is drawn inline.
            "<svg viewBox=\"-20.29 -18.29 292.57 292.57\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" ",
            "stroke-width=\"14\" stroke-linejoin=\"round\" stroke-linecap=\"round\">",
            "<path d=\"M32 160 L55 220 L157 172 L220 66 L163 36 L105 72 Z\"/>",
            "<path d=\"M32 160 L98 127 L157 172 M98 127 L163 36\"/></svg>",
            "alloy</header>",
            "<main><section><h1>{title}</h1><p>{message}</p></section></main>",
            "</body></html>",
        ),
        lang = lang,
        title = title,
        message = message,
    )
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
