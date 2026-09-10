// OBS graphics ABI: https://docs.obsproject.com/reference-libobs-graphics-graphics
struct ScreenshotBindings {
    enter: unsafe extern "C" fn(),
    leave: unsafe extern "C" fn(),
    width: unsafe extern "C" fn(*const ObsSource) -> u32,
    height: unsafe extern "C" fn(*const ObsSource) -> u32,
    render: unsafe extern "C" fn(*mut ObsSource),
    create: unsafe extern "C" fn(i32, i32) -> *mut c_void,
    destroy: unsafe extern "C" fn(*mut c_void),
    begin: unsafe extern "C" fn(*mut c_void, u32, u32, i32) -> bool,
    end: unsafe extern "C" fn(*mut c_void),
    texture: unsafe extern "C" fn(*const c_void) -> *mut c_void,
    stage_create: unsafe extern "C" fn(u32, u32, i32) -> *mut c_void,
    stage_destroy: unsafe extern "C" fn(*mut c_void),
    stage: unsafe extern "C" fn(*mut c_void, *mut c_void),
    map: unsafe extern "C" fn(*mut c_void, *mut *mut u8, *mut u32) -> bool,
    unmap: unsafe extern "C" fn(*mut c_void),
    clear: unsafe extern "C" fn(u32, *const ScreenshotColor, f32, u8),
    ortho: unsafe extern "C" fn(f32, f32, f32, f32, f32, f32),
    blend_push: unsafe extern "C" fn(),
    blend_pop: unsafe extern "C" fn(),
    blend: unsafe extern "C" fn(i32, i32),
}

#[repr(C, align(16))]
struct ScreenshotColor([f32; 4]);

impl ScreenshotBindings {
    unsafe fn load(library: &Library) -> Result<Self, String> {
        Ok(Self {
            enter: load_symbol(library, b"obs_enter_graphics\0")?,
            leave: load_symbol(library, b"obs_leave_graphics\0")?,
            width: load_symbol(library, b"obs_source_get_width\0")?,
            height: load_symbol(library, b"obs_source_get_height\0")?,
            render: load_symbol(library, b"obs_source_video_render\0")?,
            create: load_symbol(library, b"gs_texrender_create\0")?,
            destroy: load_symbol(library, b"gs_texrender_destroy\0")?,
            begin: load_symbol(library, b"gs_texrender_begin_with_color_space\0")?,
            end: load_symbol(library, b"gs_texrender_end\0")?,
            texture: load_symbol(library, b"gs_texrender_get_texture\0")?,
            stage_create: load_symbol(library, b"gs_stagesurface_create\0")?,
            stage_destroy: load_symbol(library, b"gs_stagesurface_destroy\0")?,
            stage: load_symbol(library, b"gs_stage_texture\0")?,
            map: load_symbol(library, b"gs_stagesurface_map\0")?,
            unmap: load_symbol(library, b"gs_stagesurface_unmap\0")?,
            clear: load_symbol(library, b"gs_clear\0")?,
            ortho: load_symbol(library, b"gs_ortho\0")?,
            blend_push: load_symbol(library, b"gs_blend_state_push\0")?,
            blend_pop: load_symbol(library, b"gs_blend_state_pop\0")?,
            blend: load_symbol(library, b"gs_blend_function\0")?,
        })
    }

    unsafe fn capture(&self, source: *mut ObsSource) -> Result<(Vec<u8>, u32, u32), String> {
        // The recorder owns source for this call. Hold the OBS graphics lock only
        // through rendering/readback; PNG compression happens after releasing it.
        (self.enter)();
        let result = self.capture_locked(source);
        (self.leave)();
        result
    }

    unsafe fn capture_locked(&self, source: *mut ObsSource) -> Result<(Vec<u8>, u32, u32), String> {
        let (width, height) = ((self.width)(source), (self.height)(source));
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 64_000_000 {
            return Err("Capture source has no frame or exceeds 64 megapixels.".into());
        }
        // GS_BGRA = 5, GS_ZS_NONE = 0. Explicit sRGB target makes OBS's capture
        // source convert HDR content for the SDR PNG instead of clipping raw HDR.
        let target = (self.create)(5, 0);
        let staging = (self.stage_create)(width, height, 5);
        let result = (|| {
            if target.is_null() || staging.is_null() || !(self.begin)(target, width, height, 0) {
                return Err("Could not allocate screenshot texture.".into());
            }
            (self.clear)(1, &ScreenshotColor([0.0, 0.0, 0.0, 1.0]), 1.0, 0);
            (self.ortho)(0.0, width as f32, 0.0, height as f32, -100.0, 100.0);
            (self.blend_push)();
            (self.blend)(1, 0); // GS_BLEND_ONE, GS_BLEND_ZERO
            (self.render)(source);
            (self.blend_pop)();
            (self.end)(target);
            (self.stage)(staging, (self.texture)(target));
            let mut data = ptr::null_mut();
            let mut stride = 0;
            if !(self.map)(staging, &mut data, &mut stride) {
                return Err("Could not read screenshot pixels.".into());
            }
            let row_bytes = width as usize * 4;
            let copied = if data.is_null() || (stride as usize) < row_bytes {
                Err("Invalid screenshot stride.".into())
            } else {
                let mut pixels = vec![0; row_bytes * height as usize];
                for y in 0..height as usize {
                    ptr::copy_nonoverlapping(
                        data.add(y * stride as usize),
                        pixels.as_mut_ptr().add(y * row_bytes),
                        row_bytes,
                    );
                }
                Ok((pixels, width, height))
            };
            (self.unmap)(staging);
            copied
        })();
        if !staging.is_null() {
            (self.stage_destroy)(staging);
        }
        if !target.is_null() {
            (self.destroy)(target);
        }
        result
    }
}

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
    fn save_screenshot(&mut self) -> RecordingActionResult {
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
        let directory = root
            .join("Screenshots")
            .join(recording_context_folder(session.capture.game.as_ref()));
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
            game: session.capture.game.clone(),
            source: session.capture.source.clone(),
            kind: RecordingCaptureKind::Screenshot,
            post_process: None,
            created_at: now_iso(),
        })
    }
}

#[cfg(test)]
mod screenshot_tests {
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
