fn main() {
    #[cfg(feature = "shell")]
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "connect_server",
            "cancel_connect",
            "saved_servers",
            "forget_server",
            "desktop_shell",
            "desktop_api",
        ]),
    ))
    .expect("failed to build Tauri application manifest");
}
