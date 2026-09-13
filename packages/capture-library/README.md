# Alloy capture library

This crate owns the local capture library used by the Tauri desktop shell.
It scans the configured output folder and stores capture metadata in an atomic
JSON manifest under the user data folder.

`CaptureLibrary` provides snapshot, metadata, trim, trash, import staging,
thumbnail, and download registration operations. `media` runs the configured
`ffmpeg` and `ffprobe` binaries with argument arrays. It writes exports and
post-process results to temporary files before replacing the destination.
Failed trim and concat operations keep the source files so the recorder can
retry.

Call `cancel_media` to stop new media tool work and
`shutdown_media().await` to cancel active work and wait for child processes
to exit before the shell closes.

`CaptureHttpServer` binds to loopback on a random port. Each URL carries a
random capability token. Routes accept capture IDs and stream regular files
with `GET`, `HEAD`, `OPTIONS`, CORS, and byte ranges. The selected server
origin rotates the token and controls the CORS origin.

`DownloadManager` builds the clip download URL from the native selected-server
state. The renderer never supplies that URL. The manager sends the shell's
cookie snapshot, rejects redirects, caps the response size, reports progress,
and removes partial files on failure or cancellation.

The crate is standalone. The Tauri shell supplies output and user data folders
and the bundled `ffmpeg` and `ffprobe` paths through `CaptureLibraryConfig`.

Run `cargo test --locked` with `ffmpeg` and `ffprobe` on PATH. The media test
creates a real recording and checks export, segment joining, tail trimming,
and thumbnail generation.
