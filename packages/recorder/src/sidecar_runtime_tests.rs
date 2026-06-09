#[cfg(test)]
mod detection_tests {
    use super::*;

    fn hd_window() -> Option<VideoDimensions> {
        Some(VideoDimensions {
            width: 1280,
            height: 720,
        })
    }

    fn allowed_game(
        id: &str,
        name: &str,
        executable: Option<&str>,
        path: Option<&str>,
    ) -> RecordingAllowedGame {
        RecordingAllowedGame {
            id: id.to_string(),
            name: name.to_string(),
            executable: executable.map(str::to_string),
            path: path.map(str::to_string),
            window_class: None,
            icon_url: None,
        }
    }

    fn settings_with_rules(
        allowed_games: Vec<RecordingAllowedGame>,
        denied_games: Vec<RecordingAllowedGame>,
    ) -> RecordingSettings {
        RecordingSettings {
            allowed_games,
            denied_games,
            ..RecordingSettings::default()
        }
    }

    fn detected_with_settings(
        path: &str,
        executable_title: &str,
        settings: &RecordingSettings,
    ) -> Option<DetectedGame> {
        detected_game_from_parts(
            42,
            Some(path.to_string()),
            Some(executable_title.to_string()),
            Some("UnityWndClass".to_string()),
            "pid:42".to_string(),
            0,
            false,
            Some(format!("{executable_title}:UnityWndClass:{executable_title}.exe")),
            hd_window(),
            false,
            settings,
        )
    }

    #[test]
    fn allows_exact_path_matches() {
        let settings = settings_with_rules(
            vec![allowed_game(
                "game-hades",
                "Hades",
                Some("Hades.exe"),
                Some(r"C:\SteamLibrary\steamapps\common\Hades\Hades.exe"),
            )],
            vec![],
        );

        let detected = detected_with_settings(
            r"c:/steamlibrary/steamapps/common/hades/hades.exe",
            "Hades",
            &settings,
        )
        .expect("exact allow-list path should capture");

        assert_eq!(detected.game.id.as_deref(), Some("game-hades"));
        assert_eq!(detected.game.name, "Hades");
        assert_eq!(detected.detection_score, 220);
    }

    #[test]
    fn auto_detects_catalog_games() {
        let settings = RecordingSettings::default();
        let detected = detected_with_settings(
            r"C:\Games\Roblox\RobloxPlayerBeta.exe",
            "Roblox",
            &settings,
        )
        .expect("catalog game should be detected automatically");

        assert_eq!(detected.game.name, "Roblox");
        assert_eq!(detected.detection_score, 90);
    }

    #[test]
    fn auto_detected_compact_names_are_humanized() {
        let settings = RecordingSettings::default();
        let detected =
            detected_with_settings(r"C:\Games\ForzaHorizon6.exe", "ForzaHorizon6", &settings)
                .expect("heuristic game should be detected");

        assert_eq!(detected.game.name, "Forza Horizon 6");
    }

    #[test]
    fn process_display_names_use_shared_compact_name_handler() {
        let name = user_facing_process_name(ProcessDisplayName {
            path: None,
            preferred: None,
            title: None,
            executable: Some("ForzaHorizon6.exe"),
            fallback: None,
            preserve_preferred: false,
        });

        assert_eq!(name.as_deref(), Some("Forza Horizon 6"));
    }

    #[test]
    fn process_display_names_preserve_manual_preferred_names() {
        let name = user_facing_process_name(ProcessDisplayName {
            path: None,
            preferred: Some("ForzaHorizon6"),
            title: Some("Forza Horizon 6"),
            executable: Some("ForzaHorizon6.exe"),
            fallback: None,
            preserve_preferred: true,
        });

        assert_eq!(name.as_deref(), Some("ForzaHorizon6"));
    }

    #[test]
    fn manual_names_are_preserved() {
        let settings = settings_with_rules(
            vec![allowed_game(
                "manual-forza",
                "ForzaHorizon6",
                Some("ForzaHorizon6.exe"),
                None,
            )],
            vec![],
        );
        let detected =
            detected_with_settings(r"C:\Games\ForzaHorizon6.exe", "ForzaHorizon6", &settings)
                .expect("manual allow-list game should be detected");

        assert_eq!(detected.game.name, "ForzaHorizon6");
    }

    #[test]
    fn preserves_catalog_force_display_capture_rules() {
        let settings = RecordingSettings::default();
        let detected = detected_with_settings(
            r"C:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe",
            "Counter-Strike 2",
            &settings,
        )
        .expect("catalog game should be detected automatically");

        assert_eq!(detected.game.name, "Counter-Strike 2");
        assert!(detected.force_display_capture);
    }

    #[test]
    fn supports_executable_only_allow_entries() {
        let settings = settings_with_rules(
            vec![allowed_game(
                "game-valorant",
                "VALORANT",
                Some("VALORANT-Win64-Shipping.exe"),
                None,
            )],
            vec![],
        );

        let detected = detected_with_settings(
            r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe",
            "VALORANT",
            &settings,
        )
        .expect("executable allow-list entry should capture");

        assert_eq!(detected.game.id.as_deref(), Some("game-valorant"));
        assert_eq!(detected.detection_score, 200);
    }

    #[test]
    fn manual_allow_overrides_builtin_browser_blocklist() {
        let settings = settings_with_rules(
            vec![allowed_game(
                "browser-chrome",
                "Chrome",
                Some("chrome.exe"),
                None,
            )],
            vec![],
        );

        let detected = detected_with_settings(
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "Google Chrome",
            &settings,
        )
        .expect("manual allow-list entry should override built-in browser blocklist");

        assert_eq!(detected.game.id.as_deref(), Some("browser-chrome"));
        assert_eq!(detected.detection_score, 200);
    }

    #[test]
    fn path_allow_beats_generic_executable_deny() {
        let chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe";
        let settings = settings_with_rules(
            vec![allowed_game(
                "browser-chrome-path",
                "Chrome",
                Some("chrome.exe"),
                Some(chrome_path),
            )],
            vec![allowed_game(
                "browser-chrome-exe",
                "Chrome",
                Some("chrome.exe"),
                None,
            )],
        );

        let detected = detected_with_settings(chrome_path, "Google Chrome", &settings)
            .expect("specific manual allow should beat generic deny");

        assert_eq!(
            detected.game.id.as_deref(),
            Some("browser-chrome-path")
        );
        assert!(detected_game_allowed(&detected, &settings));
    }

    #[test]
    fn path_deny_beats_generic_executable_allow() {
        let chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe";
        let settings = settings_with_rules(
            vec![allowed_game(
                "browser-chrome-exe",
                "Chrome",
                Some("chrome.exe"),
                None,
            )],
            vec![allowed_game(
                "browser-chrome-path",
                "Chrome",
                Some("chrome.exe"),
                Some(chrome_path),
            )],
        );

        let detected = detected_with_settings(chrome_path, "Google Chrome", &settings);

        assert!(detected.is_none());
    }

    #[test]
    fn path_allow_entries_do_not_match_other_paths_by_executable() {
        let settings = settings_with_rules(
            vec![allowed_game(
                "game-private",
                "Private Test Game",
                Some("PrivateTestGame.exe"),
                Some(r"C:\Games\PrivateTestGame\PrivateTestGame.exe"),
            )],
            vec![],
        );

        let detected =
            detected_with_settings(r"D:\Other\PrivateTestGame.exe", "Private Test Game", &settings);

        assert!(detected
            .as_ref()
            .is_none_or(|game| game.game.id.as_deref() != Some("game-private")));
    }

    #[test]
    fn exact_path_beats_generic_executable_match() {
        let settings = settings_with_rules(
            vec![
                allowed_game("generic", "Generic Game", Some("Game.exe"), None),
                allowed_game(
                    "specific",
                    "Specific Game",
                    Some("Game.exe"),
                    Some(r"D:\Games\Specific\Game.exe"),
                ),
            ],
            vec![],
        );

        let detected =
            detected_with_settings(r"D:\Games\Specific\Game.exe", "Specific Game", &settings)
                .expect("allowed exact path should capture");

        assert_eq!(detected.game.id.as_deref(), Some("specific"));
        assert_eq!(detected.detection_score, 220);
    }

    #[test]
    fn active_game_is_disallowed_after_deny_entry_added() {
        let allowed = vec![allowed_game(
            "game-hades",
            "Hades",
            Some("Hades.exe"),
            Some(r"C:\Games\Hades\Hades.exe"),
        )];
        let settings = settings_with_rules(allowed.clone(), vec![]);
        let detected = detected_with_settings(r"C:\Games\Hades\Hades.exe", "Hades", &settings)
            .expect("allowed game should capture");

        assert!(detected_game_allowed(&detected, &settings));
        let denied_settings = settings_with_rules(vec![], allowed);
        assert!(!detected_game_allowed(&detected, &denied_settings));
    }

    #[test]
    fn manual_only_active_game_is_disallowed_after_allow_entry_removed() {
        let settings = settings_with_rules(
            vec![allowed_game(
                "browser-chrome",
                "Chrome",
                Some("chrome.exe"),
                None,
            )],
            vec![],
        );
        let detected = detected_with_settings(
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "Google Chrome",
            &settings,
        )
        .expect("manual browser allow should capture");

        assert!(detected_game_allowed(&detected, &settings));
        assert!(!detected_game_allowed(
            &detected,
            &RecordingSettings::default(),
        ));
    }
}

#[cfg(test)]
mod recording_tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        let directory = env::temp_dir().join(format!(
            "alloy-recorder-test-{name}-{}",
            timestamp_millis()
        ));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    fn detected_game() -> DetectedGame {
        DetectedGame {
            game: RecordingGame {
                id: Some("game-test".to_string()),
                name: "Test Game".to_string(),
                process_id: 42,
                executable: Some("TestGame.exe".to_string()),
                path: Some(r"C:\Games\TestGame\TestGame.exe".to_string()),
                icon_url: None,
                window_title: Some("Test Game".to_string()),
                window_class: Some("GameWindow".to_string()),
                started_at: None,
            },
            obs_window: Some("Test Game:GameWindow:TestGame.exe".to_string()),
            window_key: "pid:42".to_string(),
            window_handle: 0,
            fullscreen: false,
            force_display_capture: false,
            capture_dimensions: Some(VideoDimensions {
                width: 1280,
                height: 720,
            }),
            hdr_enabled: false,
            detection_score: 100,
        }
    }

    #[test]
    fn focus_loss_keeps_game_capture_running() {
        let settings = RecordingSettings {
            enabled: true,
            ..RecordingSettings::default()
        };
        let game = detected_game();

        assert!(!should_pause_for_focus(&settings, Some(&game), false));
        assert_eq!(
            source_kind_for_focus(&settings, false),
            OutputSourceKind::Game,
        );
    }

    #[test]
    fn fullscreen_games_use_any_fullscreen_capture_mode() {
        let mut game = detected_game();
        game.fullscreen = true;

        assert_eq!(game_capture_mode(Some(&game)), "any_fullscreen");
    }

    #[test]
    fn fullscreen_games_keep_specific_obs_target_window() {
        let mut game = detected_game();
        game.fullscreen = true;

        assert_eq!(
            game_capture_target_window(Some(&game)),
            Some("Test Game:GameWindow:TestGame.exe"),
        );
    }

    #[test]
    fn windowed_games_use_specific_window_capture_mode() {
        let game = detected_game();

        assert_eq!(game_capture_mode(Some(&game)), "window");
    }

    #[test]
    fn hdr_games_use_hdr_game_capture_color_space() {
        let mut game = detected_game();
        game.hdr_enabled = true;

        assert_eq!(game_capture_rgb10a2_space(Some(&game)), "2100pq");
        game.hdr_enabled = false;
        assert_eq!(game_capture_rgb10a2_space(Some(&game)), "srgb");
    }

    #[test]
    fn force_display_capture_games_use_display_source() {
        let mut game = detected_game();
        game.force_display_capture = true;

        assert_eq!(
            source_kind(&RecordingSettings::default(), Some(&game)),
            OutputSourceKind::Display,
        );
    }

    #[test]
    fn game_capture_hook_wait_uses_plays_tv_style_budget() {
        assert_eq!(GAME_CAPTURE_HOOK_RETRY_INTERVAL, Duration::from_secs(2));
        assert_eq!(GAME_CAPTURE_HOOK_POLL_INTERVAL, Duration::from_millis(100));
        assert_eq!(GAME_CAPTURE_HOOK_MAX_RETRIES, 20);
    }

    #[test]
    fn game_window_size_wait_uses_plays_tv_style_budget() {
        assert_eq!(
            windows_detector::WINDOW_DIMENSION_RETRY_INTERVAL,
            Duration::from_secs(2),
        );
        assert_eq!(windows_detector::WINDOW_DIMENSION_MAX_RETRIES, 20);
        assert!(windows_detector::window_dimensions_need_retry(Some(
            VideoDimensions {
                width: 500,
                height: 500,
            },
        )));
        assert!(!windows_detector::window_dimensions_need_retry(Some(
            VideoDimensions {
                width: 1280,
                height: 720,
            },
        )));
    }

    #[test]
    fn game_capture_fallback_base_prefers_display_size() {
        let settings = RecordingSettings {
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::R720p,
                fps: 60,
                bitrate: RecordingBitrate::Auto("auto".to_string()),
            },
            ..RecordingSettings::default()
        };

        assert_eq!(
            capture_base_dimensions_with_display(
                &settings,
                None,
                OutputSourceKind::Game,
                Some(VideoDimensions {
                    width: 2560,
                    height: 1440,
                }),
            ),
            VideoDimensions {
                width: 2560,
                height: 1440,
            },
        );
    }

    #[test]
    fn game_capture_fallback_base_uses_selected_output_size_without_display() {
        let settings = RecordingSettings {
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::R720p,
                fps: 60,
                bitrate: RecordingBitrate::Auto("auto".to_string()),
            },
            ..RecordingSettings::default()
        };

        assert_eq!(
            capture_base_dimensions_with_display(&settings, None, OutputSourceKind::Game, None),
            VideoDimensions {
                width: 1280,
                height: 720,
            },
        );
    }

    #[test]
    fn source_resolution_uses_capture_base_for_output() {
        let settings = RecordingSettings {
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::Source,
                fps: 60,
                bitrate: RecordingBitrate::Auto("auto".to_string()),
            },
            ..RecordingSettings::default()
        };
        let mut game = detected_game();
        game.capture_dimensions = Some(VideoDimensions {
            width: 2560,
            height: 1440,
        });

        assert_eq!(
            obs_video_config(&settings, Some(&game), OutputSourceKind::Game),
            ObsVideoConfig {
                base: VideoDimensions {
                    width: 2560,
                    height: 1440,
                },
                output: VideoDimensions {
                    width: 2560,
                    height: 1440,
                },
                fps: 60,
                hdr_enabled: false,
            },
        );
    }

    #[test]
    fn hdr_games_enable_obs_video_config() {
        let settings = RecordingSettings {
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::Source,
                fps: 60,
                bitrate: RecordingBitrate::Auto("auto".to_string()),
            },
            ..RecordingSettings::default()
        };
        let mut game = detected_game();
        game.hdr_enabled = true;

        assert!(obs_video_config(&settings, Some(&game), OutputSourceKind::Game).hdr_enabled);
    }

    #[test]
    fn fixed_output_resolution_preserves_capture_aspect_ratio() {
        let settings = RecordingSettings {
            custom_quality: RecordingQualitySettings {
                resolution: RecordingResolution::R1080p,
                fps: 60,
                bitrate: RecordingBitrate::Auto("auto".to_string()),
            },
            ..RecordingSettings::default()
        };

        assert_eq!(
            effective_quality_for_base(
                &settings,
                VideoDimensions {
                    width: 3440,
                    height: 1440,
                },
            ),
            EffectiveQuality {
                width: 2580,
                height: 1080,
                fps: 60,
                bitrate: RecordingBitrate::Auto("auto".to_string()),
            },
        );
    }

    #[test]
    fn memory_replay_fallback_ignores_disk_segments() {
        let directory = test_directory("memory-replay-fallback");
        let disk_segment = directory.join("alloy-replay-buffer-20260609-120000.mp4");
        let memory_replay = directory.join("alloy-replay-20260609-120001.mp4");
        fs::write(&disk_segment, b"disk").expect("disk segment should be written");
        fs::write(&memory_replay, b"memory").expect("memory replay should be written");

        let replay = newest_memory_replay_file(&directory, UNIX_EPOCH)
            .expect("memory replay should be found");

        assert_eq!(replay.path, memory_replay);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn memory_replay_fallback_ignores_files_older_than_save() {
        let directory = test_directory("memory-replay-cutoff");
        let stale_replay = directory.join("alloy-replay-20260609-120000.mp4");
        fs::write(&stale_replay, b"stale").expect("stale replay should be written");
        thread::sleep(Duration::from_millis(20));
        let modified_after = SystemTime::now();
        thread::sleep(Duration::from_millis(20));
        let current_replay = directory.join("alloy-replay-20260609-120001.mp4");
        fs::write(&current_replay, b"current").expect("current replay should be written");

        let replay = newest_memory_replay_file(&directory, modified_after)
            .expect("current replay should be found");

        assert_eq!(replay.path, current_replay);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn reported_replay_paths_must_be_fresh() {
        let directory = test_directory("reported-replay-freshness");
        let stale_replay = directory.join("alloy-replay-20260609-120000.mp4");
        fs::write(&stale_replay, b"stale").expect("stale replay should be written");
        thread::sleep(Duration::from_millis(20));
        let modified_after = SystemTime::now();

        assert!(!replay_file_modified_at_or_after(
            &stale_replay,
            modified_after,
        ));
        let _ = fs::remove_dir_all(directory);
    }
}
