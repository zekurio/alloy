//! Opt-in benchmark of the production loopback media server. Run in release mode:
//! cargo test -p alloy-desktop --no-default-features --release --test media_performance -- --ignored --nocapture
//! Heap figures include both the server and the streaming HTTP client, not WebView2/OBS.

use std::alloc::{GlobalAlloc, Layout, System};
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::time::{Duration, Instant};

use alloy_desktop::capture_library::{
    CaptureHttpServer, CaptureLibrary, CaptureLibraryConfig, CaptureManifest, ManifestEntry,
};
use reqwest::header::RANGE;
use tokio::task::JoinSet;

struct MeasuredAllocator;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static ALLOCATED: AtomicUsize = AtomicUsize::new(0);

fn allocated(size: usize) {
    ALLOCATED.fetch_add(size, Relaxed);
    let live = LIVE.fetch_add(size, Relaxed) + size;
    PEAK.fetch_max(live, Relaxed);
}

// SAFETY: Every operation delegates to System with the original pointer/layout.
// Counters use atomics and do not allocate.
unsafe impl GlobalAlloc for MeasuredAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            allocated(layout.size());
        }
        pointer
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc_zeroed(layout) };
        if !pointer.is_null() {
            allocated(layout.size());
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        LIVE.fetch_sub(layout.size(), Relaxed);
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let next = unsafe { System.realloc(pointer, layout, size) };
        if !next.is_null() {
            LIVE.fetch_sub(layout.size(), Relaxed);
            allocated(size);
        }
        next
    }
}

#[global_allocator]
static ALLOCATOR: MeasuredAllocator = MeasuredAllocator;

async fn transfer(client: reqwest::Client, url: String, range: Option<&str>, expected: usize) {
    let mut request = client.get(url);
    if let Some(range) = range {
        request = request.header(RANGE, range);
    }
    let mut response = request.send().await.unwrap().error_for_status().unwrap();
    assert_eq!(response.content_length(), Some(expected as u64));
    let mut count = 0;
    while let Some(chunk) = response.chunk().await.unwrap() {
        assert_eq!(chunk.first(), Some(&0x5a));
        assert_eq!(chunk.last(), Some(&0x5a));
        count += chunk.len();
    }
    assert_eq!(count, expected);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "manual performance measurement; run alone in release mode"]
async fn loopback_media_performance() {
    alloy_desktop::server::install_crypto_provider();
    let temp = tempfile::tempdir().unwrap();
    let library = CaptureLibrary::new(CaptureLibraryConfig::new(
        temp.path().join("captures"),
        temp.path().join("data"),
        temp.path().join("cache"),
        "ffmpeg",
        "ffprobe",
    ))
    .unwrap();
    let folder = library.output_folder().join("Clips/Desktop");
    std::fs::create_dir_all(&folder).unwrap();
    let mut file = std::fs::File::create(folder.join("video.mp4")).unwrap();
    let block = vec![0x5a; 1024 * 1024];
    for _ in 0..64 {
        file.write_all(&block).unwrap();
    }
    drop(file);
    drop(block);
    let id = library.snapshot().unwrap().items[0].id.clone();
    library
        .store_thumbnail(&id, &vec![0x5a; 64 * 1024])
        .unwrap();
    let server = CaptureHttpServer::start(library.clone()).await.unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let media = server.media_url(&id).unwrap();
    let thumbnail = server.thumbnail_url(&id).unwrap();

    println!("scenario,round,requests,elapsed_ms,peak_heap_delta_bytes,allocated_bytes");
    for (name, url, range, bytes, concurrency, batches) in [
        ("thumbnails", &thumbnail, None, 64 * 1024, 16, 16),
        ("seek", &media, Some("bytes=1048576-1052671"), 4096, 8, 32),
        ("video", &media, None, 64 * 1024 * 1024, 1, 4),
    ] {
        transfer(client.clone(), url.clone(), range, bytes).await;
        for round in 1..=5 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let baseline = LIVE.load(Relaxed);
            PEAK.store(baseline, Relaxed);
            let allocated_before = ALLOCATED.load(Relaxed);
            let started = Instant::now();
            for _ in 0..batches {
                let mut tasks = JoinSet::new();
                for _ in 0..concurrency {
                    tasks.spawn(transfer(client.clone(), url.clone(), range, bytes));
                }
                while let Some(result) = tasks.join_next().await {
                    result.unwrap();
                }
            }
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            let peak = PEAK.load(Relaxed).saturating_sub(baseline);
            let allocated = ALLOCATED.load(Relaxed) - allocated_before;
            println!(
                "{name},{round},{},{elapsed:.3},{peak},{allocated}",
                concurrency * batches
            );
        }
    }
    server.shutdown().await;

    // A populated manifest is read when resolving each media ID. Build the
    // fixture outside the measurement; no user library or media is touched.
    let mut manifest = CaptureManifest::default();
    for index in 0..2_000 {
        let filename = format!("C:/captures/Clips/Example Game/clip-{index:06}.mp4");
        manifest.captures.insert(
            filename.clone(),
            ManifestEntry {
                id: format!("capture-{index:012}"),
                filename,
                title: format!("Example capture {index}"),
                game_name: Some("Example Game".into()),
                description: Some("A saved moment from a game session.".repeat(4)),
                tags: Some("game,highlight".into()),
                size_bytes: Some(64 * 1024 * 1024),
                duration_ms: Some(30_000),
                width: Some(1920),
                height: Some(1080),
                created_at: "2026-09-25T12:00:00Z".into(),
                updated_at: "2026-09-25T12:00:00Z".into(),
                ..ManifestEntry::default()
            },
        );
    }
    std::fs::write(
        temp.path().join("data/recording-library.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    drop(manifest);
    assert_eq!(library.read_manifest().captures.len(), 2_000);
    for round in 1..=5 {
        let baseline = LIVE.load(Relaxed);
        PEAK.store(baseline, Relaxed);
        let allocated_before = ALLOCATED.load(Relaxed);
        let started = Instant::now();
        for _ in 0..100 {
            let manifest = library.read_manifest();
            assert_eq!(manifest.captures.len(), 2_000);
            std::hint::black_box(manifest);
        }
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let peak = PEAK.load(Relaxed).saturating_sub(baseline);
        let allocated = ALLOCATED.load(Relaxed) - allocated_before;
        println!("manifest,{round},100,{elapsed:.3},{peak},{allocated}");
    }
}
