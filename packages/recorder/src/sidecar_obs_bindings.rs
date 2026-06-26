struct LibObs {
    _library: Library,
    obs_startup: unsafe extern "C" fn(*const c_char, *const c_char, *const c_char) -> bool,
    obs_initialized: unsafe extern "C" fn() -> bool,
    obs_shutdown: unsafe extern "C" fn(),
    obs_add_data_path: unsafe extern "C" fn(*const c_char),
    obs_add_module_path: unsafe extern "C" fn(*const c_char, *const c_char),
    obs_load_all_modules: unsafe extern "C" fn(),
    obs_open_module: unsafe extern "C" fn(*mut *mut ObsModule, *const c_char, *const c_char) -> i32,
    obs_init_module: unsafe extern "C" fn(*mut ObsModule) -> bool,
    obs_post_load_modules: unsafe extern "C" fn(),
    obs_reset_audio: unsafe extern "C" fn(*const ObsAudioInfo) -> bool,
    obs_reset_video: unsafe extern "C" fn(*mut ObsVideoInfo) -> i32,
    obs_set_video_levels: Option<unsafe extern "C" fn(f32, f32)>,
    obs_get_active_fps: Option<unsafe extern "C" fn() -> f64>,
    obs_get_average_frame_time_ns: Option<unsafe extern "C" fn() -> u64>,
    obs_get_frame_interval_ns: Option<unsafe extern "C" fn() -> u64>,
    obs_get_total_frames: Option<unsafe extern "C" fn() -> u32>,
    obs_get_lagged_frames: Option<unsafe extern "C" fn() -> u32>,
    obs_get_video: unsafe extern "C" fn() -> *mut ObsVideo,
    obs_get_audio: unsafe extern "C" fn() -> *mut ObsAudio,
    obs_enum_encoder_types: unsafe extern "C" fn(usize, *mut *const c_char) -> bool,
    obs_encoder_get_display_name: unsafe extern "C" fn(*const c_char) -> *const c_char,
    obs_get_encoder_codec: unsafe extern "C" fn(*const c_char) -> *const c_char,
    obs_get_encoder_type: unsafe extern "C" fn(*const c_char) -> c_int,
    obs_get_encoder_caps: unsafe extern "C" fn(*const c_char) -> u32,
    obs_data_create: unsafe extern "C" fn() -> *mut ObsData,
    obs_data_release: unsafe extern "C" fn(*mut ObsData),
    obs_data_set_string: unsafe extern "C" fn(*mut ObsData, *const c_char, *const c_char),
    obs_data_set_int: unsafe extern "C" fn(*mut ObsData, *const c_char, i64),
    obs_data_set_bool: unsafe extern "C" fn(*mut ObsData, *const c_char, bool),
    obs_source_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        *mut ObsData,
    ) -> *mut ObsSource,
    obs_source_release: unsafe extern "C" fn(*mut ObsSource),
    obs_source_remove: unsafe extern "C" fn(*mut ObsSource),
    obs_source_set_audio_mixers: unsafe extern "C" fn(*mut ObsSource, u32),
    obs_source_set_volume: unsafe extern "C" fn(*mut ObsSource, f32),
    obs_source_get_signal_handler: unsafe extern "C" fn(*const ObsSource) -> *mut SignalHandler,
    obs_source_get_proc_handler: unsafe extern "C" fn(*const ObsSource) -> *mut ProcHandler,
    signal_handler_connect:
        unsafe extern "C" fn(*mut SignalHandler, *const c_char, SignalCallback, *mut c_void),
    signal_handler_disconnect:
        unsafe extern "C" fn(*mut SignalHandler, *const c_char, SignalCallback, *mut c_void),
    obs_set_output_source: unsafe extern "C" fn(u32, *mut ObsSource),
    obs_scene_create_private: unsafe extern "C" fn(*const c_char) -> *mut ObsScene,
    obs_scene_release: unsafe extern "C" fn(*mut ObsScene),
    obs_scene_get_source: unsafe extern "C" fn(*const ObsScene) -> *mut ObsSource,
    obs_scene_add: unsafe extern "C" fn(*mut ObsScene, *mut ObsSource) -> *mut ObsSceneItem,
    obs_sceneitem_set_bounds_type: unsafe extern "C" fn(*mut ObsSceneItem, i32),
    obs_sceneitem_set_bounds_alignment: unsafe extern "C" fn(*mut ObsSceneItem, u32),
    obs_sceneitem_set_bounds: unsafe extern "C" fn(*mut ObsSceneItem, *const Vec2),
    obs_sceneitem_set_scale_filter: unsafe extern "C" fn(*mut ObsSceneItem, i32),
    obs_video_encoder_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        *mut ObsData,
    ) -> *mut ObsEncoder,
    obs_audio_encoder_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        usize,
        *mut ObsData,
    ) -> *mut ObsEncoder,
    obs_encoder_set_video: unsafe extern "C" fn(*mut ObsEncoder, *mut ObsVideo),
    obs_encoder_set_audio: unsafe extern "C" fn(*mut ObsEncoder, *mut ObsAudio),
    obs_encoder_release: unsafe extern "C" fn(*mut ObsEncoder),
    obs_output_create: unsafe extern "C" fn(
        *const c_char,
        *const c_char,
        *mut ObsData,
        *mut ObsData,
    ) -> *mut ObsOutput,
    obs_output_update: unsafe extern "C" fn(*mut ObsOutput, *mut ObsData),
    obs_output_start: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_stop: unsafe extern "C" fn(*mut ObsOutput),
    obs_output_force_stop: unsafe extern "C" fn(*mut ObsOutput),
    obs_output_active: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_can_pause: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_pause: unsafe extern "C" fn(*mut ObsOutput, bool) -> bool,
    obs_output_paused: unsafe extern "C" fn(*mut ObsOutput) -> bool,
    obs_output_release: unsafe extern "C" fn(*mut ObsOutput),
    obs_output_get_last_error: unsafe extern "C" fn(*mut ObsOutput) -> *const c_char,
    obs_output_get_proc_handler: unsafe extern "C" fn(*mut ObsOutput) -> *mut ProcHandler,
    obs_output_get_total_frames: Option<unsafe extern "C" fn(*mut ObsOutput) -> c_int>,
    obs_output_get_frames_dropped: Option<unsafe extern "C" fn(*mut ObsOutput) -> c_int>,
    obs_output_get_total_bytes: Option<unsafe extern "C" fn(*mut ObsOutput) -> u64>,
    obs_output_set_video_encoder: unsafe extern "C" fn(*mut ObsOutput, *mut ObsEncoder),
    obs_output_set_audio_encoder: unsafe extern "C" fn(*mut ObsOutput, *mut ObsEncoder, usize),
    proc_handler_call: unsafe extern "C" fn(*mut ProcHandler, *const c_char, *mut CallData) -> bool,
    calldata_get_data:
        unsafe extern "C" fn(*const CallData, *const c_char, *mut c_void, usize) -> bool,
    calldata_get_string:
        unsafe extern "C" fn(*const CallData, *const c_char, *mut *const c_char) -> bool,
    bfree: unsafe extern "C" fn(*mut c_void),
}


impl LibObs {
    fn load(runtime_dir: Option<&Path>) -> Result<Self, String> {
        let mut errors = Vec::new();
        for candidate in libobs_candidates(runtime_dir) {
            let library = match unsafe { Library::new(&candidate) } {
                Ok(library) => library,
                Err(error) => {
                    errors.push(format!("{}: {error}", candidate.display()));
                    continue;
                }
            };
            match unsafe { Self::from_library(library) } {
                Ok(obs) => return Ok(obs),
                Err(error) => {
                    errors.push(format!("{}: {error}", candidate.display()));
                }
            }
        }

        let detail = if errors.is_empty() {
            "no candidates were tried".to_string()
        } else {
            errors.join("; ")
        };
        Err(format!("Could not load libobs ({detail})."))
    }

    unsafe fn from_library(library: Library) -> Result<Self, String> {
        Ok(Self {
            obs_startup: load_symbol(&library, b"obs_startup\0")?,
            obs_initialized: load_symbol(&library, b"obs_initialized\0")?,
            obs_shutdown: load_symbol(&library, b"obs_shutdown\0")?,
            obs_add_data_path: load_symbol(&library, b"obs_add_data_path\0")?,
            obs_add_module_path: load_symbol(&library, b"obs_add_module_path\0")?,
            obs_load_all_modules: load_symbol(&library, b"obs_load_all_modules\0")?,
            obs_open_module: load_symbol(&library, b"obs_open_module\0")?,
            obs_init_module: load_symbol(&library, b"obs_init_module\0")?,
            obs_post_load_modules: load_symbol(&library, b"obs_post_load_modules\0")?,
            obs_reset_audio: load_symbol(&library, b"obs_reset_audio\0")?,
            obs_reset_video: load_symbol(&library, b"obs_reset_video\0")?,
            obs_set_video_levels: load_optional_symbol(&library, b"obs_set_video_levels\0"),
            obs_get_active_fps: load_optional_symbol(&library, b"obs_get_active_fps\0"),
            obs_get_average_frame_time_ns: load_optional_symbol(
                &library,
                b"obs_get_average_frame_time_ns\0",
            ),
            obs_get_frame_interval_ns: load_optional_symbol(
                &library,
                b"obs_get_frame_interval_ns\0",
            ),
            obs_get_total_frames: load_optional_symbol(&library, b"obs_get_total_frames\0"),
            obs_get_lagged_frames: load_optional_symbol(&library, b"obs_get_lagged_frames\0"),
            obs_get_video: load_symbol(&library, b"obs_get_video\0")?,
            obs_get_audio: load_symbol(&library, b"obs_get_audio\0")?,
            obs_enum_encoder_types: load_symbol(&library, b"obs_enum_encoder_types\0")?,
            obs_encoder_get_display_name: load_symbol(
                &library,
                b"obs_encoder_get_display_name\0",
            )?,
            obs_get_encoder_codec: load_symbol(&library, b"obs_get_encoder_codec\0")?,
            obs_get_encoder_type: load_symbol(&library, b"obs_get_encoder_type\0")?,
            obs_get_encoder_caps: load_symbol(&library, b"obs_get_encoder_caps\0")?,
            obs_data_create: load_symbol(&library, b"obs_data_create\0")?,
            obs_data_release: load_symbol(&library, b"obs_data_release\0")?,
            obs_data_set_string: load_symbol(&library, b"obs_data_set_string\0")?,
            obs_data_set_int: load_symbol(&library, b"obs_data_set_int\0")?,
            obs_data_set_bool: load_symbol(&library, b"obs_data_set_bool\0")?,
            obs_source_create: load_symbol(&library, b"obs_source_create\0")?,
            obs_source_release: load_symbol(&library, b"obs_source_release\0")?,
            obs_source_remove: load_symbol(&library, b"obs_source_remove\0")?,
            obs_source_set_audio_mixers: load_symbol(
                &library,
                b"obs_source_set_audio_mixers\0",
            )?,
            obs_source_set_volume: load_symbol(&library, b"obs_source_set_volume\0")?,
            obs_source_get_signal_handler: load_symbol(
                &library,
                b"obs_source_get_signal_handler\0",
            )?,
            obs_source_get_proc_handler: load_symbol(
                &library,
                b"obs_source_get_proc_handler\0",
            )?,
            signal_handler_connect: load_symbol(&library, b"signal_handler_connect\0")?,
            signal_handler_disconnect: load_symbol(
                &library,
                b"signal_handler_disconnect\0",
            )?,
            obs_set_output_source: load_symbol(&library, b"obs_set_output_source\0")?,
            obs_scene_create_private: load_symbol(&library, b"obs_scene_create_private\0")?,
            obs_scene_release: load_symbol(&library, b"obs_scene_release\0")?,
            obs_scene_get_source: load_symbol(&library, b"obs_scene_get_source\0")?,
            obs_scene_add: load_symbol(&library, b"obs_scene_add\0")?,
            obs_sceneitem_set_bounds_type: load_symbol(
                &library,
                b"obs_sceneitem_set_bounds_type\0",
            )?,
            obs_sceneitem_set_bounds_alignment: load_symbol(
                &library,
                b"obs_sceneitem_set_bounds_alignment\0",
            )?,
            obs_sceneitem_set_bounds: load_symbol(&library, b"obs_sceneitem_set_bounds\0")?,
            obs_sceneitem_set_scale_filter: load_symbol(
                &library,
                b"obs_sceneitem_set_scale_filter\0",
            )?,
            obs_video_encoder_create: load_symbol(&library, b"obs_video_encoder_create\0")?,
            obs_audio_encoder_create: load_symbol(&library, b"obs_audio_encoder_create\0")?,
            obs_encoder_set_video: load_symbol(&library, b"obs_encoder_set_video\0")?,
            obs_encoder_set_audio: load_symbol(&library, b"obs_encoder_set_audio\0")?,
            obs_encoder_release: load_symbol(&library, b"obs_encoder_release\0")?,
            obs_output_create: load_symbol(&library, b"obs_output_create\0")?,
            obs_output_update: load_symbol(&library, b"obs_output_update\0")?,
            obs_output_start: load_symbol(&library, b"obs_output_start\0")?,
            obs_output_stop: load_symbol(&library, b"obs_output_stop\0")?,
            obs_output_force_stop: load_symbol(&library, b"obs_output_force_stop\0")?,
            obs_output_active: load_symbol(&library, b"obs_output_active\0")?,
            obs_output_can_pause: load_symbol(&library, b"obs_output_can_pause\0")?,
            obs_output_pause: load_symbol(&library, b"obs_output_pause\0")?,
            obs_output_paused: load_symbol(&library, b"obs_output_paused\0")?,
            obs_output_release: load_symbol(&library, b"obs_output_release\0")?,
            obs_output_get_last_error: load_symbol(&library, b"obs_output_get_last_error\0")?,
            obs_output_get_proc_handler: load_symbol(
                &library,
                b"obs_output_get_proc_handler\0",
            )?,
            obs_output_get_total_frames: load_optional_symbol(
                &library,
                b"obs_output_get_total_frames\0",
            ),
            obs_output_get_frames_dropped: load_optional_symbol(
                &library,
                b"obs_output_get_frames_dropped\0",
            ),
            obs_output_get_total_bytes: load_optional_symbol(
                &library,
                b"obs_output_get_total_bytes\0",
            ),
            obs_output_set_video_encoder: load_symbol(
                &library,
                b"obs_output_set_video_encoder\0",
            )?,
            obs_output_set_audio_encoder: load_symbol(
                &library,
                b"obs_output_set_audio_encoder\0",
            )?,
            proc_handler_call: load_symbol(&library, b"proc_handler_call\0")?,
            calldata_get_data: load_symbol(&library, b"calldata_get_data\0")?,
            calldata_get_string: load_symbol(&library, b"calldata_get_string\0")?,
            bfree: load_symbol(&library, b"bfree\0")?,
            _library: library,
        })
    }

    unsafe fn start(
        &self,
        runtime_dir: Option<&Path>,
        video_config: ObsVideoConfig,
        adapter: u32,
    ) -> Result<(), String> {
        self.add_paths(runtime_dir);
        let locale = CString::new("en-US").expect("static string has no nul byte");
        if !(self.obs_startup)(locale.as_ptr(), ptr::null(), ptr::null()) {
            return Err("OBS startup failed.".to_string());
        }
        if !(self.obs_initialized)() {
            return Err("OBS did not finish initialization.".to_string());
        }

        // Graphics must be up before modules load: win-capture probes the
        // D3D11 device at module init to decide whether WGC is supported, and
        // silently falls back to DXGI duplication otherwise.
        self.reset_audio()?;
        self.reset_video(video_config, adapter)?;
        self.load_modules(runtime_dir)?;
        (self.obs_post_load_modules)();
        Ok(())
    }

    unsafe fn shutdown(&self) {
        if (self.obs_initialized)() {
            (self.obs_shutdown)();
        }
    }

    unsafe fn add_paths(&self, runtime_dir: Option<&Path>) {
        let Some(runtime_dir) = runtime_dir else {
            return;
        };

        for data_path in [
            runtime_dir.join("data/libobs"),
            runtime_dir.join("data/effects"),
            runtime_dir.join("share/obs/libobs"),
        ] {
            self.add_data_path(&data_path);
        }

        for (bin_path, data_path) in [
            (
                runtime_dir.join("obs-plugins/64bit"),
                runtime_dir.join("data/obs-plugins/%module%"),
            ),
            (
                runtime_dir.join("obs-plugins"),
                runtime_dir.join("data/obs-plugins/%module%"),
            ),
            (
                runtime_dir.join("lib/obs-plugins"),
                runtime_dir.join("share/obs/obs-plugins/%module%"),
            ),
            (
                runtime_dir.join("lib64/obs-plugins"),
                runtime_dir.join("share/obs/obs-plugins/%module%"),
            ),
        ] {
            self.add_module_path(&bin_path, &data_path);
        }
    }

    unsafe fn add_data_path(&self, path: &Path) {
        if !path.exists() {
            return;
        }
        if let Ok(path) = cstring_path(path) {
            (self.obs_add_data_path)(path.as_ptr());
        }
    }

    unsafe fn add_module_path(&self, bin_path: &Path, data_path: &Path) {
        if !bin_path.exists() {
            return;
        }
        let Ok(bin_path) = cstring_path(bin_path) else {
            return;
        };
        let Ok(data_path) = cstring_path(data_path) else {
            return;
        };
        (self.obs_add_module_path)(bin_path.as_ptr(), data_path.as_ptr());
    }

    unsafe fn load_modules(&self, runtime_dir: Option<&Path>) -> Result<(), String> {
        let Some(runtime_dir) = runtime_dir else {
            (self.obs_load_all_modules)();
            return Ok(());
        };

        for module in platform_modules() {
            if let Err(error) = self.load_module(runtime_dir, module.name) {
                if module.required {
                    return Err(error);
                }
                eprintln!("[{SIDE_CAR_NAME}] optional OBS module skipped: {error}");
            }
        }
        Ok(())
    }

    unsafe fn load_module(&self, runtime_dir: &Path, module: &str) -> Result<(), String> {
        let bin_path = module_bin_path(runtime_dir, module);
        if !bin_path.exists() {
            return Ok(());
        }

        let data_path = runtime_dir.join("data/obs-plugins").join(module);
        let bin_path = cstring_path(&bin_path)?;
        let data_path = if data_path.exists() {
            Some(cstring_path(&data_path)?)
        } else {
            None
        };

        let mut loaded_module: *mut ObsModule = ptr::null_mut();
        let result = (self.obs_open_module)(
            &mut loaded_module,
            bin_path.as_ptr(),
            data_path
                .as_ref()
                .map(|path| path.as_ptr())
                .unwrap_or(ptr::null()),
        );
        if result != 0 {
            return Err(format!(
                "OBS module {module} failed to open with code {result}."
            ));
        }
        if loaded_module.is_null() {
            return Err(format!("OBS module {module} did not return a module handle."));
        }
        if !(self.obs_init_module)(loaded_module) {
            return Err(format!("OBS module {module} failed to initialize."));
        }
        Ok(())
    }

    unsafe fn reset_audio(&self) -> Result<(), String> {
        let info = ObsAudioInfo {
            samples_per_sec: 48_000,
            speakers: SPEAKERS_STEREO,
        };
        if !(self.obs_reset_audio)(&info) {
            return Err("OBS audio reset failed.".to_string());
        }
        Ok(())
    }

    unsafe fn reset_video(&self, video_config: ObsVideoConfig, adapter: u32) -> Result<(), String> {
        let graphics_module =
            CString::new(platform_graphics_module()).expect("static string has no nul byte");
        let mut info = ObsVideoInfo {
            graphics_module: graphics_module.as_ptr(),
            fps_num: video_config.fps,
            fps_den: 1,
            base_width: video_config.base.width,
            base_height: video_config.base.height,
            output_width: video_config.output.width,
            output_height: video_config.output.height,
            output_format: VIDEO_FORMAT_NV12,
            adapter,
            gpu_conversion: true,
            colorspace: VIDEO_CS_DEFAULT,
            range: VIDEO_RANGE_DEFAULT,
            scale_type: OBS_SCALE_BILINEAR,
        };
        if video_config.hdr_enabled {
            if let Some(obs_set_video_levels) = self.obs_set_video_levels {
                obs_set_video_levels(300.0, 1000.0);
            } else {
                eprintln!(
                    "[{SIDE_CAR_NAME}] OBS HDR video levels are unavailable in this libobs build."
                );
            }
        }
        let code = (self.obs_reset_video)(&mut info);
        if code != OBS_VIDEO_SUCCESS {
            return Err(format!("OBS video reset failed with code {code}."));
        }
        Ok(())
    }

    unsafe fn enumerate_encoders(&self) -> Vec<ObsEncoderDescriptor> {
        let mut encoders = Vec::new();
        let mut index = 0usize;
        loop {
            let mut id: *const c_char = ptr::null();
            if !(self.obs_enum_encoder_types)(index, &mut id) {
                break;
            }
            if !id.is_null() {
                let codec = (self.obs_get_encoder_codec)(id);
                if codec.is_null() {
                    index += 1;
                    continue;
                }
                let kind = match (self.obs_get_encoder_type)(id) {
                    OBS_ENCODER_AUDIO => ObsEncoderKind::Audio,
                    OBS_ENCODER_VIDEO => ObsEncoderKind::Video,
                    _ => {
                        index += 1;
                        continue;
                    }
                };
                let display_name = (self.obs_encoder_get_display_name)(id);
                encoders.push(ObsEncoderDescriptor {
                    id: CStr::from_ptr(id).to_string_lossy().into_owned(),
                    kind,
                    codec: CStr::from_ptr(codec).to_string_lossy().into_owned(),
                    caps: (self.obs_get_encoder_caps)(id),
                    display_name: if display_name.is_null() {
                        None
                    } else {
                        Some(CStr::from_ptr(display_name).to_string_lossy().into_owned())
                    },
                });
            }
            index += 1;
        }
        encoders
    }

    unsafe fn create_data(&self) -> *mut ObsData {
        (self.obs_data_create)()
    }

    unsafe fn release_data(&self, data: *mut ObsData) {
        if !data.is_null() {
            (self.obs_data_release)(data);
        }
    }

    unsafe fn set_string(&self, data: *mut ObsData, key: &str, value: &str) -> Result<(), String> {
        let key =
            CString::new(key).map_err(|_| "OBS setting key contained a nul byte.".to_string())?;
        let value = CString::new(value)
            .map_err(|_| "OBS setting value contained a nul byte.".to_string())?;
        (self.obs_data_set_string)(data, key.as_ptr(), value.as_ptr());
        Ok(())
    }

    unsafe fn set_int(&self, data: *mut ObsData, key: &str, value: i64) -> Result<(), String> {
        let key =
            CString::new(key).map_err(|_| "OBS setting key contained a nul byte.".to_string())?;
        (self.obs_data_set_int)(data, key.as_ptr(), value);
        Ok(())
    }

    unsafe fn set_bool(&self, data: *mut ObsData, key: &str, value: bool) -> Result<(), String> {
        let key =
            CString::new(key).map_err(|_| "OBS setting key contained a nul byte.".to_string())?;
        (self.obs_data_set_bool)(data, key.as_ptr(), value);
        Ok(())
    }
}
