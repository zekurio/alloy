use std::{fs, path::Path, ptr};

use crate::agent::{
    events::emit_event,
    time::{now_iso, timestamp_file_slug, timestamp_millis},
};
use crate::types::{RecordingActionResult, RecordingCapture, RecordingCaptureKind, RecordingEvent};

use super::{replay::recording_context_folder, Recorder};

fn write_screenshot_png(
    path: &Path,
    pixels: &mut [u8],
    width: u32,
    height: u32,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::{core::GUID, Win32::Graphics::GdiPlus::*};
    let filename: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: Tightly packed BGRA buffer and NUL-terminated filename live until
    // GDI+ finishes. Dispose the bitmap before freeing pixels or shutting down.
    unsafe {
        let mut token = 0;
        let input = GdiplusStartupInput {
            GdiplusVersion: 1,
            DebugEventCallback: 0,
            SuppressBackgroundThread: 0,
            SuppressExternalCodecs: 0,
        };
        if GdiplusStartup(&mut token, &input, ptr::null_mut()) != 0 {
            return Err("Could not start PNG encoder.".into());
        }
        let mut bitmap = ptr::null_mut();
        // PixelFormat32bppRGB: ignore capture alpha; screenshots are opaque.
        let created = GdipCreateBitmapFromScan0(
            width as i32,
            height as i32,
            (width * 4) as i32,
            0x22009,
            pixels.as_mut_ptr(),
            &mut bitmap,
        );
        let result = if created != 0 || bitmap.is_null() {
            Err("Could not create screenshot bitmap.".into())
        } else {
            let encoder = GUID::from_u128(0x557cf406_1a04_11d3_9a73_0000f81ef32e);
            let saved =
                GdipSaveImageToFile(bitmap.cast(), filename.as_ptr(), &encoder, ptr::null());
            GdipDisposeImage(bitmap.cast());
            if saved == 0 {
                Result::Ok(())
            } else {
                Err("Could not save screenshot PNG.".into())
            }
        };
        GdiplusShutdown(token);
        result
    }
}

impl Recorder {
    pub(in crate::agent) fn save_screenshot(&mut self) -> RecordingActionResult {
        match self.capture_screenshot() {
            Ok(capture) => {
                self.last_capture = Some(capture.clone());
                let status = self.status();
                emit_event(RecordingEvent::CaptureReady {
                    capture: capture.clone(),
                    status: status.clone(),
                });
                RecordingActionResult {
                    ok: true,
                    status,
                    capture: Some(capture),
                    error: None,
                }
            }
            Err(error) => self.action_error(&error),
        }
    }

    fn capture_screenshot(&self) -> Result<RecordingCapture, String> {
        let session = self
            .replay_session
            .as_ref()
            .ok_or("Start capture before taking a screenshot.")?;
        if session.paused || session.game_capture_hook_wait.is_some() {
            return Err("Capture source is not ready.".into());
        }
        let obs = self.obs.as_ref().ok_or("OBS is unavailable.")?;
        let (mut pixels, width, height) =
            unsafe { obs.screenshots.capture(session.video_graph.source)? };
        let root = self
            .output_folder
            .as_ref()
            .ok_or("Capture folder is unavailable.")?;
        let game = self.capture_context_game(&session.capture);
        let directory = root
            .join("Screenshots")
            .join(recording_context_folder(game));
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let path = directory.join(format!("screenshot-{}.png", timestamp_file_slug()));
        let temporary = path.with_extension("png.tmp");
        let result = write_screenshot_png(&temporary, &mut pixels, width, height)
            .and_then(|()| fs::rename(&temporary, &path).map_err(|error| error.to_string()));
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        Ok(RecordingCapture {
            id: format!("screenshot-{}", timestamp_millis()),
            filename: path.to_string_lossy().into_owned(),
            content_type: "image/png".into(),
            size_bytes: fs::metadata(&path).ok().map(|metadata| metadata.len()),
            duration_ms: None,
            width: Some(width),
            height: Some(height),
            game: game.cloned(),
            source: session.capture.source,
            kind: RecordingCaptureKind::Screenshot,
            post_process: None,
            created_at: now_iso(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{env, ffi::CString, path::PathBuf};

    use crate::agent::obs::{types::ObsVideoConfig, LibObs};
    use crate::types::VideoDimensions;

    use super::*;

    #[test]
    #[ignore = "Requires ALLOY_TEST_OBS_RUNTIME and a D3D11 device"]
    fn renders_obs_source_and_saves_png() {
        let runtime = PathBuf::from(env::var("ALLOY_TEST_OBS_RUNTIME").expect("OBS runtime path"));
        let previous_dir = env::current_dir().unwrap();
        env::set_current_dir(runtime.join("bin/64bit")).expect("sidecar working directory");
        let obs = LibObs::load(Some(&runtime)).expect("load OBS screenshot bindings");
        let dimensions = VideoDimensions {
            width: 640,
            height: 360,
        };
        // A private empty scene exercises GPU readback without capturing the desktop.
        let result = unsafe {
            let result = obs
                .start(
                    Some(&runtime),
                    ObsVideoConfig {
                        base: dimensions,
                        output: dimensions,
                        fps: 30,
                        hdr_enabled: false,
                    },
                    0,
                )
                .and_then(|()| {
                    let name = CString::new("screenshot-test").unwrap();
                    let scene = (obs.obs_scene_create_private)(name.as_ptr());
                    if scene.is_null() {
                        return Err("Could not create test scene".into());
                    }
                    let captured = obs.screenshots.capture((obs.obs_scene_get_source)(scene));
                    (obs.obs_scene_release)(scene);
                    captured
                });
            obs.shutdown();
            result
        };
        env::set_current_dir(previous_dir).unwrap();
        let (mut pixels, width, height) = result.expect("render screenshot");
        assert_eq!((width, height), (640, 360));
        let path =
            env::temp_dir().join(format!("alloy-screenshot-test-{}.png", timestamp_millis()));
        write_screenshot_png(&path, &mut pixels, width, height).expect("encode PNG");
        let bytes = fs::read(&path).expect("read PNG");
        fs::remove_file(path).expect("remove test PNG");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 640);
        assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), 360);
    }
}
