use std::{
    ffi::{CStr, CString},
    path::Path,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
struct NativeProbe {
    width: u32,
    height: u32,
    compression: u32,
    black_level: u32,
    white_level: u32,
    cam_xyz: [f32; 12],
    as_shot_wb: [f32; 4],
    wb_pre_applied: u8,
    orientation: i32,
}

#[repr(C)]
#[derive(Debug, Default)]
struct NativeImage {
    metadata: NativeProbe,
    pixels: *mut u16,
    pixel_count: u64,
}

unsafe extern "C" {
    fn photoctl_libraw_probe_file(path: *const std::ffi::c_char, probe: *mut NativeProbe) -> i32;
    fn photoctl_libraw_decode_file(path: *const std::ffi::c_char, image: *mut NativeImage) -> i32;
    fn photoctl_libraw_free_image(image: *mut NativeImage);
    fn photoctl_libraw_version() -> *const std::ffi::c_char;
    fn photoctl_libraw_error(code: i32) -> *const std::ffi::c_char;
}

#[derive(Clone, Debug, PartialEq)]
pub struct Probe {
    pub width: u32,
    pub height: u32,
    pub compression: u32,
    pub black_level: u32,
    pub white_level: u32,
    pub cam_xyz: [f32; 12],
    pub as_shot_wb: [f32; 4],
    pub wb_pre_applied: bool,
    pub orientation: i32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Image {
    pub metadata: Probe,
    pub data: Vec<f32>,
}

pub fn probe(path: &Path) -> Result<Probe, String> {
    let path = CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|_| "RAW path contains a NUL byte".to_owned())?;
    let mut native = NativeProbe::default();
    // SAFETY: `path` is NUL terminated and `native` remains writable for the call.
    let code = unsafe { photoctl_libraw_probe_file(path.as_ptr(), &mut native) };
    if code != 0 {
        return Err(error_message(code));
    }
    Ok(probe_from_native(native))
}

pub fn decode(path: &Path) -> Result<Image, String> {
    let path = CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|_| "RAW path contains a NUL byte".to_owned())?;
    let mut native = NativeImage::default();
    // SAFETY: `path` is NUL terminated and `native` remains writable for the call.
    let code = unsafe { photoctl_libraw_decode_file(path.as_ptr(), &mut native) };
    if code != 0 {
        return Err(error_message(code));
    }
    let length = usize::try_from(native.pixel_count).map_err(|_| "RAW image is too large")?;
    let expected = native.metadata.width as usize * native.metadata.height as usize * 3;
    if native.pixels.is_null() || length != expected {
        // SAFETY: the native result remains owned by its matching free function.
        unsafe { photoctl_libraw_free_image(&mut native) };
        return Err("LibRaw returned an incompatible image buffer".to_owned());
    }
    // SAFETY: the native function allocated `length` initialized u16 samples.
    let samples = unsafe { std::slice::from_raw_parts(native.pixels, length) };
    let data = samples.iter().map(|sample| f32::from(*sample)).collect();
    // SAFETY: this releases the allocation exactly once after copying it.
    unsafe { photoctl_libraw_free_image(&mut native) };
    Ok(Image {
        metadata: probe_from_native(native.metadata),
        data,
    })
}

fn probe_from_native(native: NativeProbe) -> Probe {
    Probe {
        width: native.width,
        height: native.height,
        compression: native.compression,
        black_level: native.black_level,
        white_level: native.white_level,
        cam_xyz: native.cam_xyz,
        as_shot_wb: native.as_shot_wb,
        wb_pre_applied: native.wb_pre_applied != 0,
        orientation: native.orientation,
    }
}

fn error_message(code: i32) -> String {
    // SAFETY: LibRaw owns this static, NUL-terminated error string.
    unsafe { CStr::from_ptr(photoctl_libraw_error(code)) }
        .to_string_lossy()
        .into_owned()
}

pub fn version() -> &'static str {
    // SAFETY: LibRaw owns this static, NUL-terminated version string.
    unsafe { CStr::from_ptr(photoctl_libraw_version()) }
        .to_str()
        .expect("LibRaw version is UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probes_a7c2_with_the_pinned_libraw_matrix_and_compression_tag() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/a7c2.ARW");
        let result = probe(&fixture).expect("fixture is supported");

        assert_eq!(version(), "0.22.2-Release");
        assert_eq!((result.width, result.height), (7008, 4672));
        assert_eq!(result.compression, 1);
        assert!(
            (result.cam_xyz[0] - 0.7460).abs() < 5e-4,
            "{:?}",
            result.cam_xyz
        );
    }

    #[test]
    fn decodes_a7c2_as_oriented_camera_space_without_white_balance() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/a7c2.ARW");
        let image = decode(&fixture).expect("fixture decodes");

        assert_eq!((image.metadata.width, image.metadata.height), (7008, 4672));
        assert_eq!(image.metadata.orientation, 0);
        assert_eq!(image.metadata.black_level, 0);
        assert_eq!(image.metadata.white_level, 16383 - 512);
        assert_eq!(image.data.len(), 7008 * 4672 * 3);
        assert!(image.data.iter().any(|sample| *sample > 0.0));
        assert!(!image.metadata.wb_pre_applied);
    }
}
