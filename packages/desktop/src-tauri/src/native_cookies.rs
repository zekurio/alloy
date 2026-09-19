//! Cookie deletion must retain WebView2's native domain identity. Wry 0.55
//! converts through cookie::Cookie, whose domain() strips the leading dot.
//! Recreating that cookie for deletion can target the host-only server cookie
//! instead of the domain-scoped bootstrap cookie.

use alloy_desktop::login::InjectedCookies;
use tauri::WebviewWindow;
use url::Url;
#[cfg(windows)]
use webview2_com::{
    GetCookiesCompletedHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2_2, take_pwstr,
};
#[cfg(windows)]
use windows::core::{HSTRING, Interface, PWSTR};

/// None clears every Alloy session cookie for this host, including stale path
/// variants. Some waits for a rotated refresh cookie and deletes only injected
/// values. All inspection and deletion stay on the WebView2 UI thread.
#[cfg(windows)]
pub async fn remove(
    window: &WebviewWindow,
    origin: &Url,
    injected: Option<InjectedCookies>,
) -> Result<bool, String> {
    let host = origin
        .host_str()
        .ok_or("The server URL has no host.")?
        .to_owned();
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    window
        .with_webview(move |webview| {
            let callback_tx = tx.clone();
            // SAFETY: Tauri dispatches this closure to the UI thread. The
            // callback also runs there; no COM cookie leaves that thread.
            let result = unsafe {
                (|| -> windows::core::Result<()> {
                    let core = webview
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_2>()?;
                    let manager = core.CookieManager()?;
                    let callback_manager = manager.clone();
                    manager.GetCookies(
                        &HSTRING::new(),
                        &GetCookiesCompletedHandler::create(Box::new(move |status, cookies| {
                            if callback_tx.is_closed() {
                                return Ok(());
                            }
                            let result = (|| -> windows::core::Result<bool> {
                                status?;
                                let Some(cookies) = cookies else {
                                    return Ok(injected.is_none());
                                };
                                let mut count = 0;
                                cookies.Count(&mut count)?;
                                let mut selected = Vec::new();
                                let mut replaced = injected.is_none();
                                for index in 0..count {
                                    let cookie = cookies.GetValueAtIndex(index)?;
                                    let mut domain = PWSTR::null();
                                    cookie.Domain(&mut domain)?;
                                    let domain = take_pwstr(domain);
                                    if domain.strip_prefix('.').unwrap_or(&domain) != host {
                                        continue;
                                    }
                                    let mut name = PWSTR::null();
                                    cookie.Name(&mut name)?;
                                    let name = take_pwstr(name);
                                    if !matches!(name.as_str(), "alloy_access" | "alloy_refresh") {
                                        continue;
                                    }
                                    if let Some(injected) = &injected {
                                        let mut value = PWSTR::null();
                                        cookie.Value(&mut value)?;
                                        let value = take_pwstr(value);
                                        let mut path = PWSTR::null();
                                        cookie.Path(&mut path)?;
                                        let path = take_pwstr(path);
                                        replaced |= injected
                                            .has_replacement(&name, &value, &domain, &path, &host);
                                        // Cookie scope determines identity, not value.
                                        // Never delete a host-only cookie during handoff.
                                        // On loopback, injection itself is host-only and
                                        // rotation replaces it in place.
                                        if !injected.should_remove(&name, &value, &domain, &host) {
                                            continue;
                                        }
                                    }
                                    selected.push(cookie);
                                }
                                if replaced {
                                    for cookie in selected {
                                        callback_manager.DeleteCookie(&cookie)?;
                                    }
                                }
                                Ok(replaced)
                            })();
                            let _ = callback_tx.try_send(result);
                            Ok(())
                        })),
                    )
                })()
            };
            if let Err(error) = result {
                let _ = tx.try_send(Err(error));
            }
        })
        .map_err(|_| "Could not access the native session cookie store.")?;
    match tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv()).await {
        Ok(Some(Ok(replaced))) => Ok(replaced),
        Ok(Some(Err(error))) => {
            log::warn!("Native session cookie cleanup failed: {}", error.code());
            Err("Could not clear the native session cookies.".into())
        }
        _ => Err("The native session cookie store did not respond.".into()),
    }
}

#[cfg(not(windows))]
pub async fn remove(
    _window: &WebviewWindow,
    _origin: &Url,
    _injected: Option<InjectedCookies>,
) -> Result<bool, String> {
    Err("Native session cookies require Windows WebView2.".into())
}
