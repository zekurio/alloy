use std::path::Path;
use std::process::Command;

use alloy_desktop::capture_library::media::{export, generate_thumbnail, probe_file};
use alloy_desktop::capture_library::protocol::CaptureHttpServer;
use alloy_desktop::capture_library::store::{CaptureLibrary, CaptureLibraryConfig};
use alloy_desktop::capture_library::types::{
    CaptureGame, CaptureKind, CaptureRecord, CaptureSource, CommitImport, ExportRequest,
    ExportSegment, GameGuess, GameGuessMatchKind, GameGuessSource, MetaPatch, PostProcess,
    TrimUpdate,
};
use alloy_desktop::capture_library::{download::DownloadManager, types::DownloadRequest};
use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use reqwest::header::{CONTENT_RANGE, ORIGIN, RANGE};
use tempfile::TempDir;
use tokio::fs;
use url::Url;

fn library(temp: &TempDir) -> CaptureLibrary {
    CaptureLibrary::new(CaptureLibraryConfig::new(
        temp.path().join("captures"),
        temp.path().join("user-data"),
        temp.path().join("cache"),
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
    ))
    .expect("library opens")
}

fn capture(filename: &str, kind: CaptureKind) -> CaptureRecord {
    CaptureRecord {
        id: "sidecar-capture".to_string(),
        filename: filename.to_string(),
        content_type: if kind == CaptureKind::Screenshot {
            "image/png".to_string()
        } else {
            "video/mp4".to_string()
        },
        size_bytes: None,
        duration_ms: Some(2_000),
        width: Some(160),
        height: Some(90),
        game: Some(CaptureGame {
            id: Some("game-id".to_string()),
            name: "Test Game".to_string(),
            process_id: 42,
            executable: Some("game.exe".to_string()),
            path: None,
            icon_url: Some("https://example.test/icon.png".to_string()),
            window_title: Some("Test".to_string()),
            window_class: None,
            started_at: Some("2026-01-01T00:00:00Z".to_string()),
            guess: None,
        }),
        source: CaptureSource::Game,
        kind,
        post_process: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn recorder_game_guesses_survive_manifest_round_trips() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let folder = temp.path().join("captures/Clips/Test Game");
    fs::create_dir_all(&folder).await.unwrap();
    for name in ["first.mp4", "second.mp4"] {
        let media = folder.join(name);
        fs::write(&media, b"not a real mp4").await.unwrap();
        let mut record = capture(media.to_str().unwrap(), CaptureKind::Replay);
        // The recorder reports confidence in percent, like the host models.
        record.game.as_mut().unwrap().guess = Some(GameGuess {
            source: GameGuessSource::DiscordDetectable,
            source_id: Some("700136079562375258".to_string()),
            name: "Test Game".to_string(),
            aliases: Vec::new(),
            executable: Some("game.exe".to_string()),
            path: None,
            window_title: None,
            window_class: None,
            icon_url: None,
            confidence: 96,
            match_kind: GameGuessMatchKind::Executable,
        });
        library.remember_capture(&record).unwrap();
    }

    let manifest = library.read_manifest();
    assert_eq!(manifest.captures.len(), 2);
    assert!(
        manifest.captures.values().all(|entry| entry
            .game_guess
            .as_ref()
            .map(|guess| guess.confidence)
            == Some(96))
    );

    // One invalid entry must not reset the other entries.
    let path = temp.path().join("user-data/recording-library.json");
    let mut json: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).await.unwrap()).unwrap();
    let key = json["captures"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    json["captures"][&key]["gameGuess"]["confidence"] = serde_json::json!(250);
    fs::write(&path, serde_json::to_vec(&json).unwrap())
        .await
        .unwrap();
    let manifest = library.read_manifest();
    assert_eq!(manifest.captures.len(), 1);
    assert!(!manifest.captures.contains_key(&key));
}

#[tokio::test]
async fn manifest_uses_renderer_wire_names_and_mutations_are_bounded() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let mut wire_capture = capture("/tmp/clip.mp4", CaptureKind::Replay);
    wire_capture.post_process = Some(PostProcess::TrimTail { keep_ms: 250 });
    let wire = serde_json::to_value(&wire_capture).unwrap();
    assert_eq!(wire["contentType"], "video/mp4");
    assert_eq!(wire["postProcess"]["keepMs"], 250);
    assert!(wire.get("content_type").is_none());
    let media = temp.path().join("captures/Clips/Test Game/clip.mp4");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    fs::write(&media, b"not a real mp4").await.unwrap();
    library
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let item = library.snapshot().unwrap().items.pop().unwrap();
    assert_eq!(item.collection, "Clips");
    assert!(library.reveal_path(&item.id).unwrap().is_file());
    let encoded = serde_json::to_value(&item).unwrap();
    assert_eq!(encoded["fileName"], "clip.mp4");
    assert!(encoded.get("file_name").is_none());
    assert_eq!(encoded["durationMs"], 2_000);

    library
        .update_metadata(MetaPatch {
            id: item.id.clone(),
            title: Some("Edited title".to_string()),
            game_name: Some(Some("Test Game".to_string())),
            game_icon_url: Some(None),
            game_guess: None,
            description: Some(Some("description".to_string())),
            tags: Some(Some("tag".to_string())),
            mentions: None,
            privacy: Some(Some("private".to_string())),
            uploaded_clip_id: None,
            uploaded_clip_source_start_ms: None,
            uploaded_clip_source_duration_ms: None,
        })
        .unwrap();
    library
        .set_trim(TrimUpdate {
            id: item.id.clone(),
            trim_start_ms: Some(100),
            trim_end_ms: Some(1_900),
        })
        .unwrap();
    assert_eq!(library.find_item(&item.id).unwrap().title, "Edited title");
    assert_eq!(
        library.find_item(&item.id).unwrap().trim_start_ms,
        Some(100)
    );
    let clear_patch: MetaPatch = serde_json::from_value(serde_json::json!({
        "id": item.id.clone(),
        "gameName": null,
        "description": null,
        "tags": null,
        "privacy": null
    }))
    .unwrap();
    assert_eq!(clear_patch.game_name, Some(None));
    library.update_metadata(clear_patch).unwrap();
    let cleared = library
        .read_manifest()
        .captures
        .into_values()
        .find(|entry| entry.id == item.id)
        .unwrap();
    assert!(cleared.game_name.is_none());
    assert!(cleared.description.is_none());
    assert!(cleared.tags.is_none());
    assert!(cleared.privacy.is_none());
    assert_eq!(cleared.title, "Edited title");
    assert!(library.export_path(&item.id, "../../outside").is_err());
    assert!(library.export_path("../../outside", &item.id).is_err());
    assert!(library.find_export_path("../../outside").is_err());
    assert!(
        library
            .update_metadata(MetaPatch {
                id: "../../outside".to_string(),
                title: None,
                game_name: None,
                game_icon_url: None,
                game_guess: None,
                description: None,
                tags: None,
                mentions: None,
                privacy: None,
                uploaded_clip_id: None,
                uploaded_clip_source_start_ms: None,
                uploaded_clip_source_duration_ms: None,
            })
            .is_err()
    );
}

#[test]
fn reopened_libraries_share_manifest_mutations() {
    let temp = TempDir::new().expect("temp dir");
    let first_output = temp.path().join("first");
    let second_output = temp.path().join("second");
    let user_data = temp.path().join("user-data");
    let first = CaptureLibrary::new(CaptureLibraryConfig::new(
        &first_output,
        &user_data,
        user_data.join("cache"),
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
    ))
    .unwrap();
    let second = CaptureLibrary::new(CaptureLibraryConfig::new(
        &second_output,
        &user_data,
        user_data.join("cache"),
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
    ))
    .unwrap();
    let first_media = first_output.join("Clips/First/first.mp4");
    let second_media = second_output.join("Clips/Second/second.mp4");
    std::fs::create_dir_all(first_media.parent().unwrap()).unwrap();
    std::fs::create_dir_all(second_media.parent().unwrap()).unwrap();
    std::fs::write(&first_media, b"first").unwrap();
    std::fs::write(&second_media, b"second").unwrap();

    let first_record = capture(first_media.to_str().unwrap(), CaptureKind::Replay);
    let second_record = capture(second_media.to_str().unwrap(), CaptureKind::Replay);
    std::thread::scope(|scope| {
        let first_task = scope.spawn(|| first.remember_capture(&first_record));
        let second_task = scope.spawn(|| second.remember_capture(&second_record));
        first_task.join().unwrap().unwrap();
        second_task.join().unwrap().unwrap();
    });
    assert_eq!(first.read_manifest().captures.len(), 2);
    assert_eq!(second.read_manifest().captures.len(), 2);
}

#[test]
fn display_metadata_moves_capture_to_game_folder() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let source = temp.path().join("captures/Screenshots/Desktop/screen.png");
    std::fs::create_dir_all(source.parent().unwrap()).unwrap();
    std::fs::write(&source, b"png").unwrap();
    let mut record = capture(source.to_str().unwrap(), CaptureKind::Screenshot);
    record.source = CaptureSource::Display;
    record.game = None;
    library.remember_capture(&record).unwrap();
    let id = library.snapshot().unwrap().items[0].id.clone();

    let patch: MetaPatch = serde_json::from_value(serde_json::json!({
        "id": id,
        "gameName": "Moved Game",
        "gameIconUrl": null
    }))
    .unwrap();
    library.update_metadata(patch).unwrap();
    let item = library.find_item(&id).unwrap();
    // Windows paths use backslashes; compare on a normalized form.
    assert!(
        item.filename
            .replace('\\', "/")
            .contains("Screenshots/Moved Game/")
    );
    assert!(Path::new(&item.filename).is_file());
    assert!(!source.exists());
}

#[tokio::test]
async fn staged_image_import_commits_with_safe_path() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let source = temp.path().join("picked screenshot.png");
    // A valid PNG header is enough for staging when ffprobe is unavailable.
    fs::write(&source, b"\x89PNG\r\n\x1a\n").await.unwrap();
    let staged = library.stage_files(std::slice::from_ref(&source)).await;
    assert_eq!(staged.failed.len(), 0);
    assert_eq!(staged.staged.len(), 1);
    let id = library
        .commit_staged(CommitImport {
            id: staged.staged[0].id.clone(),
            title: "Picked screenshot".to_string(),
            game_name: None,
            game_icon_url: None,
        })
        .await
        .unwrap();
    let item = library.find_item(&id).expect("imported item");
    assert_eq!(item.kind, CaptureKind::Screenshot);
    assert!(
        item.filename
            .starts_with(temp.path().canonicalize().unwrap().to_str().unwrap())
    );
}

#[tokio::test]
async fn deleting_a_capture_drops_its_cached_thumbnails_and_exports() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let media = temp.path().join("captures/Screenshots/Desktop/screen.png");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    fs::write(&media, b"\x89PNG\r\n\x1a\n").await.unwrap();
    library
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Screenshot))
        .unwrap();
    let id = library.snapshot().unwrap().items[0].id.clone();
    library.store_thumbnail(&id, b"thumbnail").unwrap();
    let export = library.export_path(&id, "export-id-12345678").unwrap();
    fs::create_dir_all(export.parent().unwrap()).await.unwrap();
    fs::write(&export, b"render").await.unwrap();
    let thumbnails = library.thumbnail_path(&id).unwrap();
    assert!(thumbnails.is_dir());

    library.delete(&id).unwrap();

    assert!(!media.exists());
    assert!(!thumbnails.exists());
    assert!(!export.parent().unwrap().exists());
}

#[tokio::test]
async fn pruning_drops_cache_folders_without_a_capture() {
    let temp = TempDir::new().expect("temp dir");
    let first = library(&temp);
    let media = temp.path().join("captures/Clips/Test Game/clip.mp4");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    fs::write(&media, b"not a real mp4").await.unwrap();
    first
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let id = first.snapshot().unwrap().items[0].id.clone();
    first.store_thumbnail(&id, b"thumbnail").unwrap();
    let thumbnails = first.thumbnail_path(&id).unwrap();
    let export = first.export_path(&id, "export-id-12345678").unwrap();
    fs::create_dir_all(export.parent().unwrap()).await.unwrap();
    fs::write(&export, b"render").await.unwrap();
    // Cache folders whose capture is gone: the file they described was
    // deleted outside the app, or by an older build that left them behind.
    let orphan_thumbnails = temp
        .path()
        .join("cache/recording-thumbnails/gone-id-123456");
    let orphan_export = temp.path().join("cache/recording-exports/gone-id-123456");
    fs::create_dir_all(&orphan_thumbnails).await.unwrap();
    fs::create_dir_all(&orphan_export).await.unwrap();
    drop(first);

    let reopened = library(&temp);
    reopened.remove_orphan_cache_folders();

    assert_eq!(reopened.snapshot().unwrap().total_count, 1);
    assert!(!orphan_thumbnails.exists());
    assert!(!orphan_export.exists());
    assert!(thumbnails.is_dir());
    assert!(export.is_file());
}

#[tokio::test]
async fn loopback_server_streams_ranges_and_rotates_tokens() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let media = temp.path().join("captures/Screenshots/Desktop/screen.png");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    fs::write(&media, b"0123456789").await.unwrap();
    library
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Screenshot))
        .unwrap();
    let id = library.snapshot().unwrap().items[0].id.clone();
    let server = CaptureHttpServer::start(library).await.unwrap();
    let client = reqwest::Client::new();
    let old_url = server.media_url(&id).unwrap();

    let response = client.get(&old_url).send().await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"0123456789");
    let response = client
        .get(&old_url)
        .header(RANGE, "bytes=2-5")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()[CONTENT_RANGE], "bytes 2-5/10");
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"2345");
    let response = client
        .get(&old_url)
        .header(RANGE, "bytes=90-100")
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        reqwest::StatusCode::RANGE_NOT_SATISFIABLE
    );
    assert_eq!(response.headers()[CONTENT_RANGE], "bytes */10");

    server
        .set_selected_origin(Some(Url::parse("https://alloy.example").unwrap()))
        .await
        .unwrap();
    let response = client.get(&old_url).send().await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::FORBIDDEN);
    let new_url = server.media_url(&id).unwrap();
    let response = client
        .get(new_url)
        .header(ORIGIN, "https://alloy.example")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        "https://alloy.example"
    );
    server.shutdown().await;
}

#[tokio::test]
async fn download_manager_uses_native_server_and_cookie_state() {
    let (shutdown, signal) = tokio::sync::oneshot::channel();
    let app = Router::new().route(
        "/api/clips/clip-123/download",
        get(|headers: HeaderMap| async move {
            if headers.get("cookie").and_then(|value| value.to_str().ok())
                != Some("alloy_access=secret")
            {
                return (StatusCode::UNAUTHORIZED, "missing native cookie").into_response();
            }
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "image/png")
                .header("Content-Length", "3")
                .body(Body::from("PNG"))
                .expect("download response")
        }),
    );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = signal.await;
            })
            .await;
    });

    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let manager = DownloadManager::new(library.clone()).unwrap();
    manager
        .set_selected_server(
            Url::parse(&format!("http://127.0.0.1:{port}")).unwrap(),
            Some("alloy_access=secret".to_string()),
        )
        .unwrap();
    let initial = manager
        .start(DownloadRequest {
            clip_id: "clip-123".to_string(),
            title: "Saved shot".to_string(),
            size_bytes: Some(3),
            duration_ms: None,
            width: None,
            height: None,
            game_name: None,
        })
        .unwrap();
    assert_eq!(
        initial.status,
        alloy_desktop::capture_library::DownloadStatus::Downloading
    );
    let mut completed = None;
    for _ in 0..200 {
        if let Some(state) = manager.list().into_iter().find(|state| {
            state.clip_id == "clip-123"
                && matches!(
                    state.status,
                    alloy_desktop::capture_library::DownloadStatus::Completed
                )
        }) {
            completed = Some(state);
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let completed = completed.expect("download completed");
    assert_eq!(completed.received_bytes, 3);
    assert!(completed.library_item_id.is_some());
    assert_eq!(library.snapshot().unwrap().total_count, 1);
    manager.cancel_all();
    let _ = shutdown.send(());
}

#[tokio::test]
async fn concurrent_downloads_with_one_title_keep_separate_files() {
    let (shutdown, signal) = tokio::sync::oneshot::channel();
    let body = |clip: &'static str| {
        get(move || async move {
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "video/mp4")
                .header("Content-Length", clip.len().to_string())
                .body(Body::from(clip))
                .expect("download response")
        })
    };
    let app = Router::new()
        .route("/api/clips/clip-a/download", body("aaaa"))
        .route("/api/clips/clip-b/download", body("bbbbbbbb"));
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = signal.await;
            })
            .await;
    });

    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let manager = DownloadManager::new(library.clone()).unwrap();
    manager
        .set_selected_server(
            Url::parse(&format!("http://127.0.0.1:{port}")).unwrap(),
            None,
        )
        .unwrap();
    for clip_id in ["clip-a", "clip-b"] {
        manager
            .start(DownloadRequest {
                clip_id: clip_id.to_string(),
                title: "Same title".to_string(),
                size_bytes: None,
                duration_ms: None,
                width: None,
                height: None,
                game_name: None,
            })
            .unwrap();
    }
    for _ in 0..200 {
        if library.snapshot().unwrap().total_count == 2 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let snapshot = library.snapshot().unwrap();
    assert_eq!(snapshot.total_count, 2);
    let mut sizes = snapshot
        .items
        .iter()
        .map(|item| item.size_bytes)
        .collect::<Vec<_>>();
    sizes.sort_unstable();
    assert_eq!(sizes, vec![4, 8]);
    let mut names = snapshot
        .items
        .iter()
        .map(|item| item.file_name.clone())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    assert_eq!(names.len(), 2);
    manager.cancel_all();
    let _ = shutdown.send(());
}

#[tokio::test]
async fn ffmpeg_exports_and_finalizes_recordings() {
    let temp = TempDir::new().expect("temp dir");
    let ffmpeg = which("ffmpeg");
    let ffprobe = which("ffprobe");
    let library = CaptureLibrary::new(CaptureLibraryConfig::new(
        temp.path().join("captures"),
        temp.path().join("user-data"),
        temp.path().join("cache"),
        ffmpeg,
        ffprobe.clone(),
    ))
    .unwrap();
    let media = temp.path().join("captures/Clips/Test Game/synthetic.mp4");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x90:r=10",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            "-y",
            media.to_str().unwrap(),
        ])
        .output()
        .expect("ffmpeg starts");
    assert!(
        output.status.success(),
        "ffmpeg failed: {:?}",
        output.stderr
    );
    let meta = probe_file(&which("ffprobe"), &media).await.unwrap();
    let mut recorded = capture(media.to_str().unwrap(), CaptureKind::Replay);
    // Export must probe files that were discovered without a manifest entry
    // duration.
    recorded.duration_ms = None;
    recorded.width = meta.width;
    recorded.height = meta.height;
    library.remember_capture(&recorded).unwrap();
    let id = library.snapshot().unwrap().items[0].id.clone();
    let result = export(
        &library,
        ExportRequest {
            id: id.clone(),
            segments: vec![ExportSegment {
                start_ms: 250,
                end_ms: 1_500,
            }],
        },
    )
    .await
    .unwrap();
    assert_eq!(result.content_type, "video/mp4");
    assert!(result.size_bytes > 0);
    let first_export = library.export_path(&id, &result.id).unwrap();
    assert!(first_export.is_file());
    assert!(library.find_export_path(&result.id).unwrap().is_file());
    assert!(media.is_file());

    let exported = probe_file(&ffprobe, &first_export).await.unwrap();
    assert!(exported.duration_ms.unwrap().abs_diff(1_250) < 150);

    // A capture keeps one render: the next export of the same capture takes
    // the place of the one before it.
    let second = export(
        &library,
        ExportRequest {
            id: id.clone(),
            segments: vec![ExportSegment {
                start_ms: 500,
                end_ms: 1_800,
            }],
        },
    )
    .await
    .unwrap();
    assert_ne!(second.id, result.id);
    assert!(library.export_path(&id, &second.id).unwrap().is_file());
    assert!(!first_export.exists());
    assert!(library.find_export_path(&result.id).is_err());

    let first_segment = media.with_file_name("first-segment.mp4");
    fs::copy(&media, &first_segment).await.unwrap();
    let mut joined = capture(media.to_str().unwrap(), CaptureKind::Replay);
    joined.post_process = Some(PostProcess::ConcatSegments {
        segment_paths: vec![
            first_segment.to_string_lossy().into_owned(),
            media.to_string_lossy().into_owned(),
        ],
    });
    alloy_desktop::capture_library::media::finalize_capture_record(&library, &mut joined)
        .await
        .unwrap();
    assert!(joined.post_process.is_none());
    assert!(joined.duration_ms.unwrap().abs_diff(4_000) < 150);
    assert!(!first_segment.exists());
    assert!(media.is_file());

    joined.post_process = Some(PostProcess::TrimTail { keep_ms: 500 });
    alloy_desktop::capture_library::media::finalize_capture_record(&library, &mut joined)
        .await
        .unwrap();
    assert!(joined.post_process.is_none());
    assert!(joined.duration_ms.unwrap().abs_diff(500) < 150);
    let thumbnail = generate_thumbnail(&library, "capture-id-1234", &media)
        .await
        .unwrap();
    assert!(fs::metadata(thumbnail).await.unwrap().len() > 0);
}

#[tokio::test]
async fn shutdown_media_cancels_future_tool_work() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let source = temp.path().join("captures/Clips/Unknown/video.mp4");
    fs::create_dir_all(source.parent().unwrap()).await.unwrap();
    fs::write(&source, b"not a video").await.unwrap();

    library.cancel_media();
    let error = generate_thumbnail(&library, "capture-id-1234", &source)
        .await
        .expect_err("cancelled media should fail");
    assert!(matches!(
        error,
        alloy_desktop::capture_library::LibraryError::MediaCancelled
    ));
    library.shutdown_media().await;
    assert!(source.is_file());
}

fn which(binary: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(binary)
}

#[tokio::test]
async fn a_bad_manifest_entry_does_not_discard_the_others() {
    let temp = TempDir::new().expect("temp dir");
    let first = library(&temp);
    let media = temp.path().join("captures/Clips/Test Game/clip.mp4");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    fs::write(&media, b"not a real mp4").await.unwrap();
    first
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let id = first.snapshot().unwrap().items[0].id.clone();
    first
        .update_metadata(MetaPatch {
            id: id.clone(),
            title: Some("Kept".to_string()),
            game_name: None,
            game_icon_url: None,
            game_guess: None,
            description: None,
            tags: None,
            mentions: None,
            privacy: None,
            uploaded_clip_id: None,
            uploaded_clip_source_start_ms: None,
            uploaded_clip_source_duration_ms: None,
        })
        .unwrap();
    drop(first);

    // Corrupt a second entry the way a bug or a hand edit would: an enum field
    // with a value no build knows.
    let manifest_path = temp.path().join("user-data/recording-library.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).await.unwrap()).unwrap();
    let captures = manifest["captures"].as_object_mut().unwrap();
    let mut broken = captures.values().next().unwrap().clone();
    broken["id"] = serde_json::Value::String("brokenbrokenbrokenbrok".to_string());
    broken["filename"] = serde_json::Value::String("/nowhere/broken.mp4".to_string());
    broken["kind"] = serde_json::Value::String("bogus".to_string());
    captures.insert("/nowhere/broken.mp4".to_string(), broken);
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap())
        .await
        .unwrap();

    let reopened = library(&temp);
    let snapshot = reopened.snapshot().unwrap();
    assert_eq!(snapshot.items.len(), 1);
    assert_eq!(snapshot.items[0].title, "Kept");
}
