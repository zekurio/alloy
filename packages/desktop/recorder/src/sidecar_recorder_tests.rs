use super::*;

fn detected_game(name: &str) -> DetectedGame {
    DetectedGame {
        game: RecordingGame {
            id: Some(name.into()),
            name: name.into(),
            process_id: 42,
            executable: Some(format!("{name}.exe")),
            path: None,
            icon_url: Some(format!("data:image/png;base64,{name}")),
            window_title: Some(name.into()),
            window_class: None,
            started_at: Some("2026-01-01T00:00:00Z".into()),
            guess: Some(RecordingGameGuess {
                source: RecordingGameGuessSource::DiscordDetectable,
                source_id: Some(name.into()),
                name: name.into(),
                aliases: vec![],
                executable: Some(format!("{name}.exe")),
                path: None,
                window_title: Some(name.into()),
                window_class: None,
                icon_url: None,
                confidence: 100,
                match_kind: RecordingGameGuessMatchKind::Executable,
            }),
        },
        obs_window: Some(format!("{name}:GameWindow:{name}.exe")),
        window_key: name.into(),
        window_handle: 0,
        fullscreen: true,
        capture_dimensions: Some(VideoDimensions {
            width: 1280,
            height: 800,
        }),
        hdr_enabled: true,
        detection_score: 100,
    }
}

fn capture(source: RecordingCaptureSource, game: Option<RecordingGame>) -> RecordingCapture {
    RecordingCapture {
        id: "capture".into(),
        filename: "Clips/Desktop/clip.mp4".into(),
        content_type: CONTENT_TYPE_MP4.into(),
        size_bytes: None,
        duration_ms: None,
        width: Some(1920),
        height: Some(1080),
        game,
        source,
        kind: RecordingCaptureKind::Replay,
        post_process: None,
        created_at: "2026-01-01T00:00:00Z".into(),
    }
}

// No OBS instance is needed to exercise game transitions. Null handles must
// never reach OBS; Recorder::drop returns early when obs is absent.
fn display_session(settings: &RecordingSettings, capture: RecordingCapture) -> ActiveSession {
    ActiveSession {
        output: ptr::null_mut(),
        video_encoder: ptr::null_mut(),
        audio_encoder: ptr::null_mut(),
        video_encoder_id: "test-video".into(),
        audio_encoder_id: "test-audio".into(),
        video_codec: RecordingCodec::H264,
        video_graph: VideoGraph {
            scene: ptr::null_mut(),
            source: ptr::null_mut(),
            output_source: ptr::null_mut(),
            source_kind: OutputSourceKind::Display,
        },
        video_config: obs_video_config(settings, None, OutputSourceKind::Display),
        audio_graph: AudioGraph { sources: vec![] },
        source_kind: OutputSourceKind::Display,
        output_config: ReplayBufferConfig {
            scratch_directory: PathBuf::new(),
            output_directory: PathBuf::new(),
            storage: RecordingBufferStorage::Memory,
            replay_seconds: 120,
        },
        capture,
        target_game_key: None,
        game_content_expires_at: None,
        game_capture_hook_wait: None,
        can_pause: false,
        paused: false,
    }
}

#[test]
fn desktop_saves_follow_detected_game_without_retargeting_or_restarting_capture() {
    let settings = RecordingSettings {
        capture_mode: RecordingCaptureMode::Display,
        ..RecordingSettings::default()
    };
    let mut recorder = Recorder::default();
    recorder.settings = Some(settings.clone());
    recorder.replay_session = Some(display_session(
        &settings,
        capture(RecordingCaptureSource::Display, None),
    ));

    // The display buffer starts before any game, then survives both detections.
    for name in ["First Game", "Second Game"] {
        let detected = detected_game(name);
        recorder.observe_game(Some(GameDetection {
            game: detected.clone(),
            focused: true,
        }));
        recorder
            .handle_game_boundary(&settings, GameBoundaryReason::Changed)
            .unwrap();
        assert!(recorder
            .capture_target_game("missing game")
            .unwrap()
            .is_none());
        assert!(!recorder.active_video_config_changed(&settings));

        let session = recorder
            .replay_session
            .as_ref()
            .expect("display buffer survives");
        let game = recorder.capture_context_game(&session.capture);
        assert_eq!(game, Some(&detected.game));
        assert_eq!(
            saved_recording_path(Path::new("library"), game).parent(),
            Some(Path::new("library").join("Clips").join(name).as_path())
        );
        assert_eq!(recording_context_folder(game), name);
        assert_eq!(session.source_kind, OutputSourceKind::Display);
        assert!(session.game_capture_hook_wait.is_none());
        assert!(session.game_content_expires_at.is_none());

        let status = recorder.status();
        assert_eq!(status.active_game.as_deref(), Some(name));
        let current = status.current_capture.unwrap();
        assert_eq!(current.source, RecordingCaptureSource::Display);
        assert_eq!(current.game, Some(detected.game));
    }

    // Closing or excluding a game must not expire or discard a display buffer.
    recorder.clear_active_game("test game closed");
    for reason in [GameBoundaryReason::Closed, GameBoundaryReason::Disallowed] {
        recorder.handle_game_boundary(&settings, reason).unwrap();
        let session = recorder
            .replay_session
            .as_ref()
            .expect("display buffer survives");
        let game = recorder.capture_context_game(&session.capture);
        assert!(game.is_none());
        assert_eq!(recording_context_folder(game), "Desktop");
        assert!(session.game_content_expires_at.is_none());
    }
}

#[test]
fn desktop_capture_keeps_game_metadata_separate_from_video_target() {
    let settings = RecordingSettings {
        capture_mode: RecordingCaptureMode::Display,
        ..RecordingSettings::default()
    };
    let detected = detected_game("Test Game");
    let mut recorder = Recorder::default();
    recorder.settings = Some(settings.clone());
    recorder.active_game = Some(detected.clone());
    let target = recorder.capture_target_game("missing game").unwrap();
    assert!(target.is_none());
    let capture = recorder.new_capture(
        &settings,
        target.as_ref(),
        RecordingCaptureKind::Replay,
        "Clips/Test Game/clip.mp4".into(),
    );
    let display_config = obs_video_config(&settings, None, OutputSourceKind::Display);
    assert_eq!(capture.source, RecordingCaptureSource::Display);
    assert_eq!(capture.game, Some(detected.game));
    assert_eq!(capture.width, Some(display_config.output.width));
    assert_eq!(capture.height, Some(display_config.output.height));
    assert!(!display_config.hdr_enabled);

    // Unlike game-hook replays, display captures must not retain stale metadata.
    recorder.clear_active_game("test game closed");
    assert!(recorder.capture_context_game(&capture).is_none());
}

#[test]
fn game_replays_keep_the_recorded_game_during_post_close_grace() {
    let recorded = detected_game("Recorded Game").game;
    let capture = capture(RecordingCaptureSource::Game, Some(recorded.clone()));
    let mut recorder = Recorder::default();
    assert_eq!(recorder.capture_context_game(&capture), Some(&recorded));

    recorder.active_game = Some(detected_game("Another Game"));
    assert_eq!(recorder.capture_context_game(&capture), Some(&recorded));
}
