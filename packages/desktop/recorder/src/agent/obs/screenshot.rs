use std::{ffi::c_void, ptr};

use libloading::Library;

use super::{bindings::ObsSource, load_symbol};

// OBS graphics ABI: https://docs.obsproject.com/reference-libobs-graphics-graphics
pub(in crate::agent) struct ScreenshotBindings {
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
    pub(in crate::agent) unsafe fn load(library: &Library) -> Result<Self, String> {
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

    pub(in crate::agent) unsafe fn capture(
        &self,
        source: *mut ObsSource,
    ) -> Result<(Vec<u8>, u32, u32), String> {
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
            (self.blend)(1, 0);
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
