#[cfg(test)]
mod detection_tests {
    use super::*;

    fn hd_window() -> Option<VideoDimensions> {
        Some(VideoDimensions {
            width: 1280,
            height: 720,
        })
    }

    #[test]
    fn classifies_steam_path_without_fullscreen() {
        let classification = classify_game_candidate(
            Some(r"C:\SteamLibrary\steamapps\common\Hades\Hades.exe"),
            Some("Hades.exe"),
            Some("Hades"),
            Some("SDL_app"),
            false,
            hd_window(),
        )
        .expect("steam path should be enough to classify a game");

        assert!(classification.score >= 80);
        assert_eq!(classification.name.as_deref(), Some("Hades"));
    }

    #[test]
    fn classifies_engine_window_without_fullscreen() {
        let classification = classify_game_candidate(
            Some(r"C:\Games\TinyTeam\TinyGame.exe"),
            Some("TinyGame.exe"),
            Some("Tiny Game"),
            Some("UnityWndClass"),
            false,
            hd_window(),
        )
        .expect("known engine class plus game-shaped window should classify");

        assert!(classification.score >= 70);
    }

    #[test]
    fn rejects_browser_even_when_fullscreen() {
        let classification = classify_game_candidate(
            Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            Some("chrome.exe"),
            Some("YouTube"),
            Some("Chrome_WidgetWin_1"),
            true,
            hd_window(),
        );

        assert!(classification.is_none());
    }

    #[test]
    fn rejects_codex_even_when_fullscreen() {
        let classification = classify_game_candidate(
            Some(r"C:\Users\zekurio\AppData\Local\Programs\Codex\Codex.exe"),
            Some("Codex.exe"),
            Some("Codex"),
            Some("Chrome_WidgetWin_1"),
            true,
            hd_window(),
        );

        assert!(classification.is_none());
    }

    #[test]
    fn rejects_unknown_fullscreen_apps_without_game_markers() {
        let classification = classify_game_candidate(
            Some(r"C:\Tools\BigApp\BigApp.exe"),
            Some("BigApp.exe"),
            Some("Big App"),
            Some("BigAppWindow"),
            true,
            hd_window(),
        );

        assert!(classification.is_none());
    }

    #[test]
    fn classifies_fullscreen_game_install_paths() {
        let classification = classify_game_candidate(
            Some(r"C:\Games\ExampleGame\Binaries\Win64\Example.exe"),
            Some("Example.exe"),
            Some("Example"),
            Some("ExampleWindow"),
            true,
            hd_window(),
        )
        .expect("fullscreen game install path should classify");

        assert_eq!(classification.score, 55);
    }

    #[test]
    fn rejects_launcher_and_splash_windows() {
        let classification = classify_game_candidate(
            Some(r"C:\Games\Example\ExampleLauncher.exe"),
            Some("ExampleLauncher.exe"),
            Some("Example Launcher"),
            Some("SplashScreenClass"),
            true,
            hd_window(),
        );

        assert!(classification.is_none());
    }

    #[test]
    fn extracts_steam_acf_quoted_values() {
        let contents = r#"
            "appid"        "1145360"
            "name"         "Hades"
            "installdir"   "Hades"
        "#;

        assert_eq!(extract_acf_value(contents, "name").as_deref(), Some("Hades"));
        assert_eq!(
            extract_acf_value(contents, "installdir").as_deref(),
            Some("Hades")
        );
    }
}

