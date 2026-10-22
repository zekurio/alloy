use std::path::Path;
use std::process::Command;

use alloy_desktop::capture_library::media::{
    capture_sources_present, discard_capture_sources, export, finalize_capture, probe_file,
};
use alloy_desktop::capture_library::poster::{ensure_poster, spawn_poster};
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
    alloy_desktop::server::install_crypto_provider();
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
async fn manifest_keeps_valid_entries_beside_malformed_records() {
    let temp = TempDir::new().unwrap();
    let library = library(&temp);
    let path = temp.path().join("user-data/recording-library.json");
    let fixture = serde_json::json!({
        "version": 2,
        "captures": {
            "valid.mp4": {
                "id": "valid-capture-001",
                "filename": "valid.mp4",
                "title": "Quoted \"title\" with Unicode: 日本語",
                "unknownFutureField": {"nested": [1, true, null]}
            },
            "null.mp4": null,
            "array.mp4": [1, 2, 3],
            "wrong-type.mp4": {"id": 42},
            "invalid.mp4": {"id": "short", "title": "Invalid ID"}
        }
    });
    fs::write(&path, serde_json::to_vec(&fixture).unwrap())
        .await
        .unwrap();
    let manifest = library.read_manifest();
    assert_eq!(manifest.captures.len(), 1);
    assert_eq!(
        manifest.captures["valid.mp4"].title,
        "Quoted \"title\" with Unicode: 日本語"
    );
    let mut future_version = fixture;
    future_version["version"] = serde_json::json!(255);
    fs::write(&path, serde_json::to_vec(&future_version).unwrap())
        .await
        .unwrap();
    assert!(library.read_manifest().captures.is_empty());
    fs::write(&path, b"{\"version\":2,\"captures\":{")
        .await
        .unwrap();
    assert!(library.read_manifest().captures.is_empty());
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

#[test]
fn display_capture_with_detected_game_keeps_source_and_game_group() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let source = temp.path().join("captures/Clips/Test Game/clip.mp4");
    std::fs::create_dir_all(source.parent().unwrap()).unwrap();
    std::fs::write(&source, b"not a real mp4").unwrap();
    let mut record = capture(source.to_str().unwrap(), CaptureKind::Replay);
    record.source = CaptureSource::Display;

    library.remember_capture(&record).unwrap();

    let snapshot = library.snapshot().unwrap();
    let item = snapshot.items.first().expect("remembered capture");
    assert_eq!(item.source, CaptureSource::Display);
    assert_eq!(item.game_name.as_deref(), Some("Test Game"));
    assert_eq!(
        item.game_icon_url.as_deref(),
        Some("https://example.test/icon.png")
    );
    assert_eq!(item.group_key, "test game");
    assert_eq!(item.group_label, "Test Game");
    assert_eq!(snapshot.groups.len(), 1);
    assert_eq!(snapshot.groups[0].key, "test game");
    assert_eq!(snapshot.groups[0].label, "Test Game");
    assert_eq!(snapshot.groups[0].kind, "game");
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
    write_cached_poster(&library, &id).await;
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
    write_cached_poster(&first, &id).await;
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
    reopened.remove_orphans();

    assert_eq!(reopened.snapshot().unwrap().total_count, 1);
    assert!(!orphan_thumbnails.exists());
    assert!(!orphan_export.exists());
    assert!(thumbnails.is_dir());
    assert!(export.is_file());
}

#[tokio::test]
async fn sweep_forgets_captures_deleted_outside_the_app() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let kept = temp.path().join("captures/Clips/Test Game/kept.mp4");
    let deleted = temp.path().join("captures/Clips/Test Game/deleted.mp4");
    fs::create_dir_all(kept.parent().unwrap()).await.unwrap();
    for media in [&kept, &deleted] {
        fs::write(media, b"not a real mp4").await.unwrap();
        library
            .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
            .unwrap();
    }
    let deleted_id = library
        .read_manifest()
        .captures
        .into_values()
        .find(|entry| entry.filename.ends_with("deleted.mp4"))
        .unwrap()
        .id;
    write_cached_poster(&library, &deleted_id).await;
    let thumbnails = library.thumbnail_path(&deleted_id).unwrap();
    // A capture in another output folder: that folder may be unplugged, so
    // its entry must survive even though its file cannot be found.
    let elsewhere = CaptureLibrary::new(CaptureLibraryConfig::new(
        temp.path().join("elsewhere"),
        temp.path().join("user-data"),
        temp.path().join("cache"),
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
    ))
    .unwrap();
    let remote = temp.path().join("elsewhere/Clips/Other/remote.mp4");
    fs::create_dir_all(remote.parent().unwrap()).await.unwrap();
    fs::write(&remote, b"not a real mp4").await.unwrap();
    elsewhere
        .remember_capture(&capture(remote.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    assert_eq!(library.read_manifest().captures.len(), 3);

    // Deleted in Explorer, with the whole other folder gone.
    fs::remove_file(&deleted).await.unwrap();
    fs::remove_dir_all(temp.path().join("elsewhere"))
        .await
        .unwrap();
    library.remove_orphans();

    let manifest = library.read_manifest();
    assert_eq!(manifest.captures.len(), 2);
    assert!(
        !manifest
            .captures
            .values()
            .any(|entry| entry.id == deleted_id)
    );
    assert!(
        manifest
            .captures
            .values()
            .any(|entry| entry.filename.ends_with("remote.mp4"))
    );
    assert!(!thumbnails.exists());
    assert_eq!(library.snapshot().unwrap().total_count, 1);
}

#[tokio::test]
async fn manifest_writes_refuse_a_manifest_they_could_not_read() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let media = temp.path().join("captures/Clips/Test Game/clip.mp4");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    fs::write(&media, b"not a real mp4").await.unwrap();
    library
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let id = library.snapshot().unwrap().items[0].id.clone();
    library
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
    let manifest_path = temp.path().join("user-data/recording-library.json");

    // Written by a newer build, which may shape its entries differently: a
    // downgraded build must neither write its empty view of it back nor set
    // it aside as corrupt. The startup sweep keeps the cache of a capture
    // only that manifest knows about, here one in another output folder.
    let elsewhere = "capture-in-another-folder";
    write_cached_poster(&library, elsewhere).await;
    let future = serde_json::to_vec(&serde_json::json!({
        "version": 300,
        "captures": [{ "id": id, "title": "Kept" }],
    }))
    .unwrap();
    fs::write(&manifest_path, &future).await.unwrap();
    assert!(
        library
            .set_trim(TrimUpdate {
                id: id.clone(),
                trim_start_ms: Some(100),
                trim_end_ms: Some(900),
            })
            .is_err()
    );
    library.remove_orphans();
    assert_eq!(fs::read(&manifest_path).await.unwrap(), future);
    assert!(library.thumbnail_path(elsewhere).unwrap().is_dir());

    // Unreadable right now (a folder stands in for a sharing violation).
    fs::remove_file(&manifest_path).await.unwrap();
    fs::create_dir_all(&manifest_path).await.unwrap();
    assert!(
        library
            .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
            .is_err()
    );
    assert!(manifest_path.is_dir());
    fs::remove_dir_all(&manifest_path).await.unwrap();

    // Not JSON at all: set aside, never written over, and writes go on.
    fs::write(&manifest_path, b"{\"version\":2,\"captures\":{")
        .await
        .unwrap();
    library
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let mut entries = std::fs::read_dir(temp.path().join("user-data"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    entries.sort();
    assert!(
        entries
            .iter()
            .any(|name| name.starts_with("recording-library.json.corrupt-")),
        "{entries:?}"
    );
    assert_eq!(library.read_manifest().captures.len(), 1);
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
async fn loopback_streams_large_files_and_ranges_across_buffer_boundaries() {
    let temp = TempDir::new().unwrap();
    let library = library(&temp);
    let media = temp.path().join("captures/Clips/Desktop/large.mp4");
    fs::create_dir_all(media.parent().unwrap()).await.unwrap();
    let bytes: Vec<u8> = (0..3 * 1024 * 1024 + 37)
        .map(|index| (index % 251) as u8)
        .collect();
    fs::write(&media, &bytes).await.unwrap();
    library
        .remember_capture(&capture(media.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let id = library.snapshot().unwrap().items[0].id.clone();
    let server = CaptureHttpServer::start(library).await.unwrap();
    let client = reqwest::Client::new();
    let url = server.media_url(&id).unwrap();
    let response = client.get(&url).send().await.unwrap();
    assert_eq!(response.content_length(), Some(bytes.len() as u64));
    assert_eq!(response.bytes().await.unwrap().as_ref(), bytes);

    for (range, start, end) in [
        ("bytes=65530-1048590", 65530, 1048591),
        ("bytes=-43", bytes.len() - 43, bytes.len()),
        ("bytes=3145727-", 3145727, bytes.len()),
        ("bytes=0-0", 0, 1),
    ] {
        let response = client.get(&url).header(RANGE, range).send().await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.content_length(), Some((end - start) as u64));
        assert_eq!(response.bytes().await.unwrap().as_ref(), &bytes[start..end]);
    }
    let response = client.head(&url).send().await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(
        response.headers()["content-length"],
        bytes.len().to_string()
    );
    assert!(response.bytes().await.unwrap().is_empty());

    fs::write(&media, []).await.unwrap();
    let response = client.get(&url).send().await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(response.content_length(), Some(0));
    assert!(response.bytes().await.unwrap().is_empty());
    server.shutdown().await;
}

#[tokio::test]
async fn download_manager_uses_native_server_and_cookie_state() {
    let (shutdown, signal) = tokio::sync::oneshot::channel();
    let app = Router::new().route(
        "/api/clips/clip-123/download",
        get(|headers: HeaderMap| async move {
            if headers.get("cookie").and_then(|value| value.to_str().ok())
                != Some("alloy_session=secret")
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
            Some("alloy_session=secret".to_string()),
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
async fn downloads_store_the_media_version_from_the_etag() {
    let version = "0123456789abcdef";
    let longest = "a".repeat(64);
    // Clip id, the ETag its download answers with, and the version the
    // library must store. A server without media versions sends no ETag.
    let cases = [
        (
            "strong",
            Some(format!("\"src-{version}\"")),
            Some(version.to_string()),
        ),
        (
            "weak",
            Some(format!("W/\"src-{version}\"")),
            Some(version.to_string()),
        ),
        (
            "longest",
            Some(format!("\"src-{longest}\"")),
            Some(longest.clone()),
        ),
        ("absent", None, None),
        ("other-prefix", Some(format!("\"rnd-{version}\"")), None),
        ("unquoted", Some(format!("src-{version}")), None),
        ("half-quoted", Some(format!("\"src-{version}")), None),
        ("empty", Some("\"src-\"".to_string()), None),
        ("oversized", Some(format!("\"src-{longest}a\"")), None),
        ("symbols", Some("\"src-0123_4567.89\"".to_string()), None),
    ];
    let (shutdown, signal) = tokio::sync::oneshot::channel();
    let mut app = Router::new();
    for (clip_id, etag, _) in &cases {
        let etag = etag.clone();
        app = app.route(
            &format!("/api/clips/{clip_id}/download"),
            get(move || async move {
                let mut response = Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", "video/mp4")
                    .header("Content-Length", "4");
                if let Some(etag) = etag {
                    response = response.header("ETag", etag);
                }
                response
                    .body(Body::from("clip"))
                    .expect("download response")
            }),
        );
    }
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
    for (clip_id, _, _) in &cases {
        manager
            .start(DownloadRequest {
                clip_id: clip_id.to_string(),
                title: clip_id.to_string(),
                size_bytes: None,
                duration_ms: None,
                width: None,
                height: None,
                game_name: None,
            })
            .unwrap();
    }
    for _ in 0..200 {
        if manager
            .list()
            .iter()
            .all(|state| state.library_item_id.is_some())
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let states = manager.list();
    for (clip_id, _, expected) in &cases {
        let state = states
            .iter()
            .find(|state| state.clip_id == *clip_id)
            .expect("download state");
        let id = state
            .library_item_id
            .as_deref()
            .expect("download completed");
        let item = library.find_item(id).expect("downloaded item");
        assert_eq!(item.uploaded_clip_id.as_deref(), Some(*clip_id));
        assert_eq!(item.uploaded_clip_media_version, *expected, "{clip_id}");
    }
    manager.cancel_all();
    let _ = shutdown.send(());
}

#[tokio::test]
async fn downloaded_copies_keep_the_media_version_until_the_clip_link_changes() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let folder = temp.path().join("captures/Clips/Uncategorized");
    fs::create_dir_all(&folder).await.unwrap();
    let version = "0123456789abcdef";
    let register = |name: &str, media_version: Option<&str>| {
        let media = folder.join(name);
        std::fs::write(&media, b"not a real mp4").unwrap();
        library
            .register_download(
                &DownloadRequest {
                    clip_id: "clip-123".to_string(),
                    title: "Saved clip".to_string(),
                    size_bytes: None,
                    duration_ms: Some(2_000),
                    width: None,
                    height: None,
                    game_name: None,
                },
                &media,
                "video/mp4",
                14,
                media_version,
            )
            .unwrap()
    };
    let patch = |value: serde_json::Value| {
        library
            .update_metadata(serde_json::from_value(value).unwrap())
            .unwrap();
    };

    let kept = register("kept.mp4", Some(version));
    let item = library.find_item(&kept).unwrap();
    assert_eq!(item.uploaded_clip_id.as_deref(), Some("clip-123"));
    assert_eq!(item.uploaded_clip_media_version.as_deref(), Some(version));
    assert_eq!(
        serde_json::to_value(&item).unwrap()["uploadedClipMediaVersion"],
        version
    );
    let unversioned = register("unversioned.mp4", None);
    let item = library.find_item(&unversioned).unwrap();
    assert_eq!(item.uploaded_clip_id.as_deref(), Some("clip-123"));
    assert!(item.uploaded_clip_media_version.is_none());

    // Only a download writes the version. A renderer patch that names it, or
    // that repeats the current clip link, leaves it alone.
    patch(serde_json::json!({
        "id": kept,
        "title": "Renamed",
        "uploadedClipId": "clip-123",
        "uploadedClipMediaVersion": "ffffffffffffffff"
    }));
    let item = library.find_item(&kept).unwrap();
    assert_eq!(item.title, "Renamed");
    assert_eq!(item.uploaded_clip_media_version.as_deref(), Some(version));
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(temp.path().join("user-data/recording-library.json"))
            .await
            .unwrap(),
    )
    .unwrap();
    let stored = manifest["captures"]
        .as_object()
        .unwrap()
        .values()
        .find(|entry| entry["id"] == kept)
        .unwrap();
    assert_eq!(stored["uploadedClipMediaVersion"], version);

    let relinked = register("relinked.mp4", Some(version));
    patch(serde_json::json!({ "id": relinked, "uploadedClipId": "clip-456" }));
    let item = library.find_item(&relinked).unwrap();
    assert_eq!(item.uploaded_clip_id.as_deref(), Some("clip-456"));
    assert!(item.uploaded_clip_media_version.is_none());

    let unlinked = register("unlinked.mp4", Some(version));
    patch(serde_json::json!({ "id": unlinked, "uploadedClipId": null }));
    let item = library.find_item(&unlinked).unwrap();
    assert!(item.uploaded_clip_id.is_none());
    assert!(item.uploaded_clip_media_version.is_none());
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
    let meta = probe_file(&library, &media).await.unwrap();
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
            allow_server_trim: false,
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
    assert_eq!((result.source_start_ms, result.source_end_ms), (250, 1_500));
    assert_eq!(result.duration_ms, 1_250);
    let first_export = library.export_path(&id, &result.id).unwrap();
    assert!(first_export.is_file());
    assert!(library.find_export_path(&result.id).unwrap().is_file());
    assert!(media.is_file());

    let exported = probe_file(&library, &first_export).await.unwrap();
    assert!(exported.duration_ms.unwrap().abs_diff(1_250) < 150);

    // A capture keeps one render: the next export of the same capture takes
    // the place of the one before it.
    let second = export(
        &library,
        ExportRequest {
            id: id.clone(),
            allow_server_trim: false,
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

    // A selection that reaches both edges exports the whole file and reports
    // the capture's full range, not the few milliseconds short it asked for.
    let source_duration = meta.duration_ms.unwrap();
    let whole = export(
        &library,
        ExportRequest {
            id: id.clone(),
            allow_server_trim: false,
            segments: vec![ExportSegment {
                start_ms: 20,
                end_ms: source_duration - 20,
            }],
        },
    )
    .await
    .unwrap();
    assert_eq!(
        (whole.source_start_ms, whole.source_end_ms),
        (0, source_duration)
    );
    assert_eq!(whole.duration_ms, source_duration);
    // An uploadable capture is its own export: nothing is copied into the
    // cache, and the render before it is no longer kept.
    assert!(whole.whole_capture);
    assert_eq!(whole.id, id);
    assert!(!library.export_path(&id, &second.id).unwrap().exists());

    // A disk replay arrives as segments staged beside a clip that does not
    // exist yet.
    let joined_path = media.with_file_name("joined.mp4");
    let parts = [
        media.with_file_name(".joined.part00.mp4"),
        media.with_file_name(".joined.part01.mp4"),
    ];
    for part in &parts {
        fs::copy(&media, part).await.unwrap();
    }
    let mut joined = capture(joined_path.to_str().unwrap(), CaptureKind::Replay);
    joined.post_process = Some(PostProcess::ConcatSegments {
        segment_paths: parts
            .iter()
            .map(|part| part.to_string_lossy().into_owned())
            .collect(),
    });
    finalize_capture(&library, &mut joined).await.unwrap();
    assert!(joined.post_process.is_none());
    assert!(joined.duration_ms.unwrap().abs_diff(4_000) < 150);
    assert!(parts.iter().all(|part| !part.exists()));
    assert!(joined_path.is_file());
    assert!(media.is_file());

    // The joined file has keyframes at 0 s and 2 s, so keeping its last
    // 500 ms keeps everything from the keyframe at 2 s.
    joined.post_process = Some(PostProcess::TrimTail { keep_ms: 500 });
    finalize_capture(&library, &mut joined).await.unwrap();
    assert!(joined.post_process.is_none());
    assert!(joined.duration_ms.unwrap().abs_diff(2_000) < 150);
}

#[tokio::test]
async fn disk_replay_segments_are_joined_into_a_clip_that_does_not_exist_yet() {
    let temp = TempDir::new().expect("temp dir");
    let library = CaptureLibrary::new(CaptureLibraryConfig::new(
        temp.path().join("captures"),
        temp.path().join("user-data"),
        temp.path().join("cache"),
        which("ffmpeg"),
        which("ffprobe"),
    ))
    .unwrap();
    // The recorder stages the segments beside the clip it names, dot-prefixed
    // so a library scan does not list them, and reports the clip before it
    // exists.
    let folder = temp.path().join("captures/Clips/Test Game");
    let clip = folder.join("clip-20260101-000000.mp4");
    let parts = [
        folder.join(".clip-20260101-000000.part00.mp4"),
        folder.join(".clip-20260101-000000.part01.mp4"),
    ];
    for part in &parts {
        write_recording(part);
    }
    let mut joined = capture(clip.to_str().unwrap(), CaptureKind::Replay);
    joined.post_process = Some(PostProcess::ConcatSegments {
        segment_paths: parts
            .iter()
            .map(|part| part.to_string_lossy().into_owned())
            .collect(),
    });
    assert!(capture_sources_present(&joined));
    assert_eq!(library.snapshot().unwrap().total_count, 0);

    finalize_capture(&library, &mut joined).await.unwrap();

    assert!(clip.is_file());
    assert!(parts.iter().all(|part| !part.exists()));
    assert!(joined.post_process.is_none());
    assert!(joined.duration_ms.unwrap().abs_diff(6_000) < 150);
    assert!(std::fs::read_dir(&folder).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with('.')
    }));
    library.remember_capture(&joined).unwrap();
    assert_eq!(library.snapshot().unwrap().total_count, 1);

    // Joined, but the host stopped before it deleted every segment or
    // recorded the clip: finalizing again keeps the clip as it is and only
    // drops the segment left over.
    let modified = std::fs::metadata(&clip).unwrap().modified().unwrap();
    write_recording(&parts[1]);
    joined.post_process = Some(PostProcess::ConcatSegments {
        segment_paths: parts
            .iter()
            .map(|part| part.to_string_lossy().into_owned())
            .collect(),
    });
    assert!(capture_sources_present(&joined));
    finalize_capture(&library, &mut joined).await.unwrap();
    assert_eq!(
        std::fs::metadata(&clip).unwrap().modified().unwrap(),
        modified
    );
    assert!(joined.duration_ms.unwrap().abs_diff(6_000) < 150);
    assert!(!parts[1].exists());

    // A segment went missing before the join, so the clip can never be
    // made. Dropping the capture deletes the segments it staged, and nothing
    // else it names.
    let other = folder.join("other.mp4");
    write_recording(&other);
    let remaining = folder.join(".lost.part01.mp4");
    write_recording(&remaining);
    let mut lost = capture(
        folder.join("lost.mp4").to_str().unwrap(),
        CaptureKind::Replay,
    );
    lost.post_process = Some(PostProcess::ConcatSegments {
        segment_paths: [
            folder.join(".lost.part00.mp4"),
            remaining.clone(),
            other.clone(),
        ]
        .iter()
        .map(|part| part.to_string_lossy().into_owned())
        .collect(),
    });
    assert!(!capture_sources_present(&lost));
    discard_capture_sources(&lost).await;
    assert!(!remaining.exists());
    assert!(other.is_file());

    // A join that fails keeps its segments, the only copy of the replay, for
    // the next attempt, and leaves no temporary files behind.
    let broken = folder.join(".broken.part00.mp4");
    std::fs::write(&broken, b"not a real mp4").unwrap();
    let mut unjoinable = capture(
        folder.join("broken.mp4").to_str().unwrap(),
        CaptureKind::Replay,
    );
    unjoinable.post_process = Some(PostProcess::ConcatSegments {
        segment_paths: vec![broken.to_string_lossy().into_owned()],
    });
    finalize_capture(&library, &mut unjoinable)
        .await
        .unwrap_err();
    assert!(broken.is_file());
    assert!(!folder.join("broken.mp4").exists());
    let mut names = std::fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(
        names,
        [
            ".broken.part00.mp4",
            "clip-20260101-000000.mp4",
            "other.mp4"
        ]
    );
}

/// Writes a 30 fps recording that shows red, green, blue and white for two
/// seconds each, in turn, over a tone, with a keyframe every `gop` frames.
fn write_color_recording(path: &Path, codec: &str, seconds: u32, gop: u32) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let colors = ["red", "green", "blue", "white"];
    let count = seconds.div_ceil(2) as usize;
    let mut graph = (0..count)
        .map(|index| {
            format!(
                "color=c={}:s=160x90:r=30:d=2[c{index}];",
                colors[index % colors.len()]
            )
        })
        .collect::<String>();
    graph.push_str(
        &(0..count)
            .map(|index| format!("[c{index}]"))
            .collect::<String>(),
    );
    graph.push_str(&format!(
        "concat=n={count}:v=1:a=0[v];sine=f=440:d={seconds}[a]"
    ));
    let gop = gop.to_string();
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-filter_complex",
        &graph,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        codec,
        "-g",
        &gop,
        "-keyint_min",
        &gop,
        "-sc_threshold",
        "0",
        "-bf",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
    ];
    if codec == "libx265" {
        args.extend([
            "-x265-params",
            "log-level=error:scenecut=0",
            "-tag:v",
            "hvc1",
        ]);
    }
    args.push(path.to_str().unwrap());
    let output = Command::new("ffmpeg")
        .args(&args)
        .output()
        .expect("ffmpeg starts");
    assert!(
        output.status.success(),
        "ffmpeg failed: {:?}",
        output.stderr
    );
}

fn video_codec(path: &Path) -> String {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str().unwrap(),
        ])
        .output()
        .expect("ffprobe starts");
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

/// The average color of the frame shown at `at_ms`.
fn frame_color(path: &Path, at_ms: u64) -> [u8; 3] {
    let output = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-ss",
            &format!("{}.{:03}", at_ms / 1_000, at_ms % 1_000),
            "-i",
            path.to_str().unwrap(),
            "-frames:v",
            "1",
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ])
        .output()
        .expect("ffmpeg starts");
    output.stdout.try_into().expect("one RGB pixel")
}

fn is_white([red, green, blue]: [u8; 3]) -> bool {
    red > 200 && green > 200 && blue > 200
}

fn is_red([red, green, blue]: [u8; 3]) -> bool {
    red > 200 && green < 60 && blue < 60
}

fn is_blue([red, green, blue]: [u8; 3]) -> bool {
    red < 60 && green < 60 && blue > 200
}

#[tokio::test]
async fn trimmed_publishes_copy_the_recording_and_leave_the_cut_to_the_server() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let media = temp.path().join("captures/Clips/Test Game/hevc.mp4");
    write_color_recording(&media, "libx265", 8, 60);
    let mut record = capture(media.to_str().unwrap(), CaptureKind::Replay);
    record.duration_ms = Some(8_000);
    let id = library.remember_capture(&record).unwrap();
    let selection = ExportSegment {
        start_ms: 4_500,
        end_ms: 7_000,
    };

    let copied = export(
        &library,
        ExportRequest {
            id: id.clone(),
            allow_server_trim: true,
            segments: vec![selection],
        },
    )
    .await
    .unwrap();
    let file = library.find_export_path(&copied.id).unwrap();
    // The recording's own HEVC packets, not a local H.264 encode.
    assert_eq!(video_codec(&file), "hevc");
    assert!(!copied.whole_capture);
    // The copy starts on the keyframe at 4 s; audio from just before it may
    // pull its time zero a little earlier.
    let start = copied.source_start_ms;
    assert!((3_850..=4_000).contains(&start), "copy starts at {start}");
    assert_eq!(copied.source_end_ms, start + copied.duration_ms);
    assert_eq!(copied.trim_start_ms, Some(selection.start_ms - start));
    assert_eq!(copied.trim_end_ms, Some(selection.end_ms - start));
    assert!(copied.duration_ms + 50 >= selection.end_ms - start);
    // The reported offset maps the copy onto the recording to the frame:
    // white starts at 6 s in the recording.
    let white_at = 6_000 - start;
    assert!(is_blue(frame_color(&file, white_at - 50)));
    assert!(is_white(frame_color(&file, white_at + 40)));

    // From the recording's first keyframe on, the copy keeps its timeline.
    let opening = export(
        &library,
        ExportRequest {
            id: id.clone(),
            allow_server_trim: true,
            segments: vec![ExportSegment {
                start_ms: 300,
                end_ms: 2_500,
            }],
        },
    )
    .await
    .unwrap();
    let file = library.find_export_path(&opening.id).unwrap();
    assert_eq!(opening.source_start_ms, 0);
    assert_eq!(
        (opening.trim_start_ms, opening.trim_end_ms),
        (Some(300), Some(2_500))
    );
    assert!(is_red(frame_color(&file, 1_950)));
    assert!(!is_red(frame_color(&file, 2_040)));

    // Without the server's cut, a selection is still re-encoded exactly.
    let exact = export(
        &library,
        ExportRequest {
            id: id.clone(),
            allow_server_trim: false,
            segments: vec![selection],
        },
    )
    .await
    .unwrap();
    assert_eq!(
        video_codec(&library.find_export_path(&exact.id).unwrap()),
        "h264"
    );
    assert_eq!((exact.source_start_ms, exact.source_end_ms), (4_500, 7_000));
    assert_eq!((exact.trim_start_ms, exact.trim_end_ms), (None, None));

    // A keyframe too far before the selection would upload a long lead-in,
    // so that selection is re-encoded exactly instead.
    let sparse = temp.path().join("captures/Clips/Test Game/sparse.mp4");
    write_color_recording(&sparse, "libx264", 14, 900);
    let sparse_id = library
        .remember_capture(&capture(sparse.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let fallback = export(
        &library,
        ExportRequest {
            id: sparse_id,
            allow_server_trim: true,
            segments: vec![ExportSegment {
                start_ms: 12_000,
                end_ms: 13_500,
            }],
        },
    )
    .await
    .unwrap();
    assert_eq!(
        (fallback.source_start_ms, fallback.source_end_ms),
        (12_000, 13_500)
    );
    assert_eq!((fallback.trim_start_ms, fallback.trim_end_ms), (None, None));

    // Keeping a replay's tail copies from the keyframe before it too.
    let mut replay = capture(media.to_str().unwrap(), CaptureKind::Replay);
    replay.post_process = Some(PostProcess::TrimTail { keep_ms: 3_000 });
    finalize_capture(&library, &mut replay).await.unwrap();
    assert_eq!(video_codec(&media), "hevc");
    assert!(replay.duration_ms.unwrap().abs_diff(4_000) < 150);
    assert!(is_blue(frame_color(&media, 100)));
}

#[tokio::test]
async fn replay_tails_copy_only_from_a_keyframe_close_to_the_tail() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    // Keyframes at 0 s and 5 s; blue shows from 4 s, white from 6 s, and red
    // again from 8 s.
    let near = temp.path().join("captures/Clips/Test Game/near.mp4");
    write_color_recording(&near, "libx265", 10, 150);
    let far = near.with_file_name("far.mp4");
    fs::copy(&near, &far).await.unwrap();

    // The last 4 s start 1 s after the keyframe at 5 s, so the tail copies
    // the recording's packets from there.
    let mut replay = capture(near.to_str().unwrap(), CaptureKind::Replay);
    replay.post_process = Some(PostProcess::TrimTail { keep_ms: 4_000 });
    finalize_capture(&library, &mut replay).await.unwrap();
    assert_eq!(video_codec(&near), "hevc");
    assert!(replay.duration_ms.unwrap().abs_diff(5_000) < 150);
    assert!(is_blue(frame_color(&near, 100)));

    // The last second starts 4 s after it. A copy would save five times the
    // length asked for, so the tail is re-encoded exactly.
    let mut replay = capture(far.to_str().unwrap(), CaptureKind::Replay);
    replay.post_process = Some(PostProcess::TrimTail { keep_ms: 1_000 });
    finalize_capture(&library, &mut replay).await.unwrap();
    assert_eq!(video_codec(&far), "h264");
    assert!(replay.duration_ms.unwrap().abs_diff(1_000) < 150);
    assert!(is_red(frame_color(&far, 100)));
}

#[cfg(unix)]
#[tokio::test]
async fn saving_a_clip_does_not_wait_for_exports() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let temp = TempDir::new().expect("temp dir");
    // Stands in for ffmpeg. Encodes wait until `release` exists, so two
    // exports hold every export slot for as long as the test needs them to.
    let gate = temp.path().join("gate");
    std::fs::create_dir_all(&gate).unwrap();
    let script = temp.path().join("gated-ffmpeg");
    let body = r#"#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = libx264 ]; then
    touch "GATE/encode.$$"
    while [ ! -e "GATE/release" ]; do sleep 0.05; done
  fi
done
exec ffmpeg "$@"
"#;
    std::fs::write(&script, body.replace("GATE", gate.to_str().unwrap())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    alloy_desktop::server::install_crypto_provider();
    let library = CaptureLibrary::new(CaptureLibraryConfig::new(
        temp.path().join("captures"),
        temp.path().join("user-data"),
        temp.path().join("cache"),
        &script,
        Path::new("ffprobe"),
    ))
    .unwrap();
    let exported = temp.path().join("captures/Clips/Test Game/exported.mp4");
    write_color_recording(&exported, "libx264", 6, 60);
    let exported_id = library
        .remember_capture(&capture(exported.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let saved = exported.with_file_name("saved.mp4");
    write_color_recording(&saved, "libx264", 6, 60);
    let mut replay = capture(saved.to_str().unwrap(), CaptureKind::Replay);
    replay.post_process = Some(PostProcess::TrimTail { keep_ms: 3_000 });

    let reencode = |start_ms, end_ms| ExportRequest {
        id: exported_id.clone(),
        allow_server_trim: false,
        segments: vec![ExportSegment { start_ms, end_ms }],
    };
    let exports = async {
        tokio::join!(
            export(&library, reencode(500, 2_500)),
            export(&library, reencode(1_000, 3_000)),
        )
    };
    let finalized = async {
        tokio::time::timeout(Duration::from_secs(30), async {
            while std::fs::read_dir(&gate).unwrap().count() < 2 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("both exports start encoding");
        let finalized = tokio::time::timeout(
            Duration::from_secs(30),
            finalize_capture(&library, &mut replay),
        )
        .await;
        std::fs::write(gate.join("release"), b"").unwrap();
        finalized
    };
    let ((first, second), finalized) = tokio::join!(exports, finalized);
    finalized
        .expect("the clip finalizes while both exports encode")
        .unwrap();
    assert!(replay.duration_ms.unwrap().abs_diff(4_000) < 150);
    // Both exports still finish once their encodes may run.
    for export in [first.unwrap(), second.unwrap()] {
        assert!(export.size_bytes > 0);
    }
}

#[tokio::test]
async fn shutdown_media_cancels_future_tool_work() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let source = temp.path().join("captures/Clips/Unknown/video.mp4");
    fs::create_dir_all(source.parent().unwrap()).await.unwrap();
    fs::write(&source, b"not a video").await.unwrap();

    let id = library.snapshot().unwrap().items[0].id.clone();
    library.cancel_media();
    let error = ensure_poster(&library, &id)
        .await
        .expect_err("cancelled media should fail");
    assert!(matches!(
        error,
        alloy_desktop::capture_library::LibraryError::MediaCancelled
    ));
    library.shutdown_media().await;
    assert!(source.is_file());
}

/// Stands in for a poster the library made earlier.
async fn write_cached_poster(library: &CaptureLibrary, id: &str) {
    let folder = library.thumbnail_path(id).unwrap();
    fs::create_dir_all(&folder).await.unwrap();
    fs::write(folder.join("poster.jpg"), b"poster")
        .await
        .unwrap();
}

/// Writes a short H.264 recording whose first second is black and whose
/// rest is a test pattern.
fn write_recording(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=10:d=3",
            "-vf",
            "drawbox=c=black:t=fill:enable='lt(t,1)'",
            "-c:v",
            "libx264",
            "-g",
            "5",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-y",
            path.to_str().unwrap(),
        ])
        .output()
        .expect("ffmpeg starts");
    assert!(
        output.status.success(),
        "ffmpeg failed: {:?}",
        output.stderr
    );
}

fn write_screenshot(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=1920x1080",
            "-frames:v",
            "1",
            "-y",
            path.to_str().unwrap(),
        ])
        .output()
        .expect("ffmpeg starts");
    assert!(
        output.status.success(),
        "ffmpeg failed: {:?}",
        output.stderr
    );
}

/// Width and height from a baseline or progressive JPEG's frame header.
fn jpeg_size(bytes: &[u8]) -> (u16, u16) {
    let mut index = 2;
    while index + 9 < bytes.len() {
        let marker = bytes[index + 1];
        let length = usize::from(u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]));
        if (0xc0..=0xc2).contains(&marker) {
            let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]);
            let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]);
            return (width, height);
        }
        index += 2 + length;
    }
    panic!("not a JPEG");
}

#[tokio::test]
async fn posters_finish_when_their_caller_stops_waiting() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let video = temp.path().join("captures/Clips/Test Game/clip.mp4");
    write_recording(&video);
    let id = library
        .remember_capture(&capture(video.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();

    // A thumbnail request the WebView drops stops waiting right away.
    drop(spawn_poster(&library, &id));
    let folder = library.thumbnail_path(&id).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while library.snapshot().unwrap().items[0]
        .thumb_blur_hash
        .is_none()
    {
        assert!(
            std::time::Instant::now() < deadline,
            "poster did not finish"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let files = std::fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert_eq!(files, ["poster.jpg"]);
}

#[tokio::test]
async fn posters_carry_a_blur_hash_into_the_snapshot() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let video = temp.path().join("captures/Clips/Test Game/clip.mp4");
    write_recording(&video);
    let mut record = capture(video.to_str().unwrap(), CaptureKind::Replay);
    record.duration_ms = Some(3_000);
    let video_id = library.remember_capture(&record).unwrap();
    let screenshot = temp.path().join("captures/Screenshots/Desktop/shot.png");
    write_screenshot(&screenshot);
    // No manifest entry: a file the library only found by scanning.
    let screenshot_id = library
        .snapshot()
        .unwrap()
        .items
        .into_iter()
        .find(|item| item.kind == CaptureKind::Screenshot)
        .unwrap()
        .id;
    // A thumbnail an older build cached is replaced by the poster.
    let legacy = library
        .thumbnail_path(&video_id)
        .unwrap()
        .join("generated.jpg");
    fs::create_dir_all(legacy.parent().unwrap()).await.unwrap();
    fs::write(&legacy, b"legacy").await.unwrap();
    assert!(
        library
            .snapshot()
            .unwrap()
            .items
            .iter()
            .all(|item| item.thumb_blur_hash.is_none())
    );

    // Concurrent requests for one capture share a single run.
    let (first, second) = tokio::join!(
        ensure_poster(&library, &video_id),
        ensure_poster(&library, &video_id)
    );
    let poster = first.unwrap();
    assert_eq!(poster, second.unwrap());
    let shot_poster = ensure_poster(&library, &screenshot_id).await.unwrap();

    let jpeg = fs::read(&poster).await.unwrap();
    assert_eq!(jpeg_size(&jpeg), (320, 180));
    assert!(!legacy.exists());
    // The rejected black frames leave nothing behind.
    let mut files = std::fs::read_dir(poster.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    files.sort();
    assert_eq!(files, ["poster.jpg"]);
    // Screenshots get a downscaled JPEG instead of serving the full image.
    assert_eq!(
        jpeg_size(&fs::read(&shot_poster).await.unwrap()),
        (1280, 720)
    );

    let snapshot = library.snapshot().unwrap();
    let hash = |id: &str| {
        snapshot
            .items
            .iter()
            .find(|item| item.id == id)
            .unwrap()
            .thumb_blur_hash
            .clone()
            .expect("snapshot carries the poster's BlurHash")
    };
    let video_hash = hash(&video_id);
    let shot_hash = hash(&screenshot_id);
    // 16:9 picks the same 6x4 components as `blurHashComponents`.
    assert_eq!(video_hash.len(), 4 + 2 * 6 * 4);
    assert_eq!(shot_hash.len(), 4 + 2 * 6 * 4);
    // The opening second is black, so the poster skips to a later frame: its
    // BlurHash's average color (characters 2..6) is not black.
    assert_ne!(&video_hash[2..6], "0000");
    // Adopting the scanned screenshot into the manifest kept its scan values.
    let shot = snapshot
        .items
        .iter()
        .find(|item| item.id == screenshot_id)
        .unwrap();
    assert_eq!(shot.group_label, "Uncategorized");
    assert_eq!(shot.source, CaptureSource::Display);

    // A second request reuses the poster without running ffmpeg again.
    let modified = fs::metadata(&poster).await.unwrap().modified().unwrap();
    ensure_poster(&library, &video_id).await.unwrap();
    assert_eq!(
        fs::metadata(&poster).await.unwrap().modified().unwrap(),
        modified
    );

    // The loopback server serves the poster, creating it on first request.
    fs::remove_file(&shot_poster).await.unwrap();
    let server = CaptureHttpServer::start(library.clone()).await.unwrap();
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(server.thumbnail_url(&screenshot_id).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"].to_str().unwrap(),
        "image/jpeg"
    );
    assert_eq!(jpeg_size(&response.bytes().await.unwrap()), (1280, 720));
    server.shutdown().await;

    // Filing the display screenshot under a game moves the file but keeps
    // its id, so the poster and BlurHash stay with it.
    let shot_modified = fs::metadata(&shot_poster)
        .await
        .unwrap()
        .modified()
        .unwrap();
    library
        .update_metadata(MetaPatch {
            id: screenshot_id.clone(),
            title: None,
            game_name: Some(Some("Test Game".to_string())),
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
    assert!(!screenshot.exists());
    let moved = library.snapshot().unwrap();
    let shots = moved
        .items
        .iter()
        .filter(|item| item.kind == CaptureKind::Screenshot)
        .collect::<Vec<_>>();
    assert_eq!(shots.len(), 1);
    assert_eq!(shots[0].id, screenshot_id);
    assert_eq!(shots[0].group_label, "Test Game");
    assert_eq!(
        shots[0].thumb_blur_hash.as_deref(),
        Some(shot_hash.as_str())
    );
    ensure_poster(&library, &screenshot_id).await.unwrap();
    assert_eq!(
        fs::metadata(&shot_poster)
            .await
            .unwrap()
            .modified()
            .unwrap(),
        shot_modified
    );
}

#[tokio::test]
async fn screenshots_stand_in_for_posters_they_cannot_get() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    // ffmpeg cannot read either file, so neither gets a poster.
    let broken = temp.path().join("captures/Screenshots/Desktop/broken.png");
    fs::create_dir_all(broken.parent().unwrap()).await.unwrap();
    let broken_bytes = b"\x89PNG\r\n\x1a\nnot really a png".to_vec();
    fs::write(&broken, &broken_bytes).await.unwrap();
    let broken_id = library
        .remember_capture(&capture(broken.to_str().unwrap(), CaptureKind::Screenshot))
        .unwrap();
    let video = temp.path().join("captures/Clips/Test Game/clip.mp4");
    fs::create_dir_all(video.parent().unwrap()).await.unwrap();
    fs::write(&video, b"not a real mp4").await.unwrap();
    let video_id = library
        .remember_capture(&capture(video.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    let server = CaptureHttpServer::start(library.clone()).await.unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();

    // The second round answers from the remembered failure.
    for _ in 0..2 {
        let response = client
            .get(server.thumbnail_url(&broken_id).unwrap())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["content-type"].to_str().unwrap(),
            "image/png"
        );
        assert_eq!(response.bytes().await.unwrap().as_ref(), broken_bytes);
        // A video has nothing to stand in for its poster.
        let response = client
            .get(server.thumbnail_url(&video_id).unwrap())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    // Once media work is cancelled, a screenshot still has a thumbnail.
    let shot = temp.path().join("captures/Screenshots/Desktop/shot.png");
    write_screenshot(&shot);
    let shot_id = library
        .remember_capture(&capture(shot.to_str().unwrap(), CaptureKind::Screenshot))
        .unwrap();
    library.cancel_media();
    let response = client
        .get(server.thumbnail_url(&shot_id).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.bytes().await.unwrap().as_ref(),
        fs::read(&shot).await.unwrap()
    );
    server.shutdown().await;
}

#[tokio::test]
async fn failed_posters_wait_for_their_file_to_change() {
    use alloy_desktop::capture_library::LibraryError;

    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let video = temp.path().join("captures/Clips/Test Game/clip.mp4");
    fs::create_dir_all(video.parent().unwrap()).await.unwrap();
    fs::write(&video, b"not a real mp4").await.unwrap();
    let id = library
        .remember_capture(&capture(video.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();

    let error = ensure_poster(&library, &id)
        .await
        .expect_err("a broken file has no poster");
    assert!(!matches!(error, LibraryError::PosterFailed));
    // The same file is not tried again.
    let error = ensure_poster(&library, &id)
        .await
        .expect_err("a broken file has no poster");
    assert!(matches!(error, LibraryError::PosterFailed));

    // A new file in its place is.
    write_recording(&video);
    let poster = ensure_poster(&library, &id).await.unwrap();
    assert!(poster.is_file());
    assert!(
        library.snapshot().unwrap().items[0]
            .thumb_blur_hash
            .is_some()
    );

    // Cancelled work says nothing about the file, so it is not remembered.
    let other = temp.path().join("captures/Clips/Test Game/other.mp4");
    fs::write(&other, b"not a real mp4").await.unwrap();
    let other_id = library
        .remember_capture(&capture(other.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();
    library.cancel_media();
    for _ in 0..2 {
        let error = ensure_poster(&library, &other_id)
            .await
            .expect_err("cancelled media should fail");
        assert!(matches!(error, LibraryError::MediaCancelled));
    }
}

#[tokio::test]
async fn a_new_file_at_a_capture_drops_the_old_poster() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let shot = temp.path().join("captures/Screenshots/Desktop/shot.png");
    write_screenshot(&shot);
    let record = capture(shot.to_str().unwrap(), CaptureKind::Screenshot);
    let id = library.remember_capture(&record).unwrap();
    let poster = ensure_poster(&library, &id).await.unwrap();
    assert_eq!(jpeg_size(&fs::read(&poster).await.unwrap()), (1280, 720));

    // A new file lands where the capture was and is recorded again.
    write_image(&shot, "640x360");
    assert_eq!(library.remember_capture(&record).unwrap(), id);
    assert!(!poster.exists());

    // The loopback server serves the new file's poster, not the old one.
    let server = CaptureHttpServer::start(library.clone()).await.unwrap();
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(server.thumbnail_url(&id).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(jpeg_size(&response.bytes().await.unwrap()), (640, 360));
    server.shutdown().await;
    assert!(
        library.snapshot().unwrap().items[0]
            .thumb_blur_hash
            .is_some()
    );
}

#[tokio::test]
async fn posters_keep_a_blank_frame_when_later_seeks_fail() {
    let temp = TempDir::new().expect("temp dir");
    let library = library(&temp);
    let video = temp.path().join("captures/Clips/Test Game/short.mp4");
    write_short_video_with_long_audio(&video);
    let id = library
        .remember_capture(&capture(video.to_str().unwrap(), CaptureKind::Replay))
        .unwrap();

    // Every frame is black and the seeks past the video's end find none, so
    // the opening frame is the poster.
    let poster = ensure_poster(&library, &id).await.unwrap();
    assert_eq!(jpeg_size(&fs::read(&poster).await.unwrap()), (160, 90));
    let files = std::fs::read_dir(poster.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert_eq!(files, ["poster.jpg"]);
    let hash = library.snapshot().unwrap().items[0]
        .thumb_blur_hash
        .clone()
        .expect("snapshot carries the poster's BlurHash");
    // Some ffmpeg builds convert video black to 1 rather than 0.
    assert!(blur_hash_average(&hash).iter().all(|channel| *channel <= 2));
}

/// The average color a BlurHash stores in characters 2..6.
fn blur_hash_average(hash: &str) -> [u8; 3] {
    const ALPHABET: &str =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
    let value = hash[2..6].chars().fold(0_u32, |value, digit| {
        value * 83 + ALPHABET.find(digit).unwrap() as u32
    });
    [(value >> 16) as u8, (value >> 8) as u8, value as u8]
}

/// Writes a PNG test pattern of `size`, given as `WIDTHxHEIGHT`.
fn write_image(path: &Path, size: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc2=s={size}"),
            "-frames:v",
            "1",
            "-y",
            path.to_str().unwrap(),
        ])
        .output()
        .expect("ffmpeg starts");
    assert!(
        output.status.success(),
        "ffmpeg failed: {:?}",
        output.stderr
    );
}

/// Writes a recording whose black video ends after half a second while its
/// audio runs for three, so seeking past 0.5 s finds no frame.
fn write_short_video_with_long_audio(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=160x90:r=10:d=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-y",
            path.to_str().unwrap(),
        ])
        .output()
        .expect("ffmpeg starts");
    assert!(
        output.status.success(),
        "ffmpeg failed: {:?}",
        output.stderr
    );
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
