use std::sync::{Arc, Mutex};
use std::time::Duration;

use alloy_desktop::{login::BrowserLogin, server::Server};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
    time::timeout,
};
use url::Url;

struct MockServer {
    server: Server,
    tokens_received: Arc<Mutex<Option<Value>>>,
    task: JoinHandle<()>,
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn server_info() -> Value {
    let mut info: Value = serde_json::from_str(include_str!(
        "../../../contracts/fixtures/server-http-v1.json"
    ))
    .unwrap();
    info["desktopTauriBridgeContracts"] = json!([1]);
    info
}

async fn mock_server(info: Value) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = Server::new(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let tokens_received = Arc::new(Mutex::new(None));
    let received = Arc::clone(&tokens_received);
    let task = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let info = info.clone();
            let received = Arc::clone(&received);
            tokio::spawn(async move {
                timeout(Duration::from_secs(5), respond(stream, info, received))
                    .await
                    .unwrap();
            });
        }
    });
    MockServer {
        server,
        tokens_received,
        task,
    }
}

async fn respond(mut stream: TcpStream, info: Value, received: Arc<Mutex<Option<Value>>>) {
    let mut request = Vec::new();
    let header_end = loop {
        let mut bytes = [0; 1024];
        let count = stream.read(&mut bytes).await.unwrap();
        assert!(count > 0 && request.len() < 128 * 1024);
        request.extend_from_slice(&bytes[..count]);
        if let Some(end) = request.windows(4).position(|value| value == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let headers = String::from_utf8(request[..header_end].to_vec()).unwrap();
    let length = headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.trim().parse::<usize>().unwrap())
        .unwrap_or(0);
    assert!(length < 128 * 1024);
    while request.len() < header_end + length {
        let mut bytes = [0; 1024];
        let count = stream.read(&mut bytes).await.unwrap();
        assert!(count > 0);
        request.extend_from_slice(&bytes[..count]);
    }
    let first = headers.lines().next().unwrap();
    let body = if first.starts_with("GET /api/server-info ") {
        info
    } else if first.starts_with("GET /api/auth-config ") {
        json!({ "setupRequired": false, "desktopAuth": { "version": 1 } })
    } else {
        assert!(first.starts_with("POST /api/auth/desktop/token "));
        *received.lock().unwrap() =
            Some(serde_json::from_slice(&request[header_end..header_end + length]).unwrap());
        json!({
            "accessToken": "test-access-token",
            "refreshToken": "test-refresh-token",
            "accessExpiresAt": "2099-01-01T00:00:00Z",
            "refreshExpiresAt": "2099-02-01T00:00:00Z"
        })
    }
    .to_string();
    stream
        .write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn selected_server_must_advertise_the_exact_tauri_contract() {
    let compatible = mock_server(server_info()).await;
    compatible.server.check().await.unwrap();

    let mut info = server_info();
    info["desktopTauriBridgeContracts"] = json!([2]);
    let incompatible = mock_server(info).await;
    assert!(incompatible.server.check().await.is_err());
}

#[tokio::test]
async fn browser_login_rejects_wrong_state_then_exchanges_pkce_code() {
    let mock = mock_server(server_info()).await;
    let login = BrowserLogin::prepare(&mock.server).await.unwrap();
    let query: std::collections::HashMap<_, _> =
        login.authorize_url.query_pairs().into_owned().collect();
    let mut callback = Url::parse(&query["redirect_uri"]).unwrap();
    let server = mock.server.clone();
    let completion = tokio::spawn(async move { login.finish(&server).await });
    callback
        .query_pairs_mut()
        .append_pair("state", "wrong")
        .append_pair("code", "ignored");
    let response = mock
        .server
        .client
        .get(callback.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 400);
    assert!(mock.tokens_received.lock().unwrap().is_none());

    callback.set_query(None);
    callback
        .query_pairs_mut()
        .append_pair("state", &query["state"])
        .append_pair("code", "one-time-code");
    let response = mock.server.client.get(callback).send().await.unwrap();
    assert_eq!(response.status().as_u16(), 200);
    let tokens = timeout(Duration::from_secs(5), completion)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let received = mock.tokens_received.lock().unwrap();
    let request = received.as_ref().unwrap();
    assert_eq!(request["code"], "one-time-code");
    let verifier = request["codeVerifier"].as_str().unwrap();
    assert_eq!(
        URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
        query["code_challenge"]
    );
    let cookies = tokens.cookie_headers(&mock.server.origin).unwrap();
    assert!(cookies[0].starts_with("alloy_access=test-access-token;"));
    assert!(cookies[1].starts_with("alloy_refresh=test-refresh-token;"));
    assert!(cookies.iter().all(|cookie| cookie.contains("HttpOnly")));

    // The host deletes its injected cookies once the server has set its own,
    // so it has to recognise exactly its own values and nothing else.
    let injected = tokens.injected_cookies();
    assert!(injected.is_injected_cookie("alloy_access", "test-access-token"));
    assert!(injected.is_injected_cookie("alloy_refresh", "test-refresh-token"));
    assert!(!injected.is_injected_cookie("alloy_refresh", "rotated-refresh-token"));
    assert!(!injected.is_injected_cookie("alloy_access", "test-refresh-token"));
    assert!(!injected.is_injected_cookie("alloy_is_authenticated", "true"));
}
