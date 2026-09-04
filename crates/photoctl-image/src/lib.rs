//! Native image operations for photoctl.

mod develop;

use std::path::Path;

use napi::{
    Error, Status, Task,
    bindgen_prelude::{AsyncTask, Float32Array, Uint16Array},
};
use napi_derive::napi;

use develop::{camera_front, display_srgb_to_linear_rec2020, linear_rec2020_to_display_srgb};

#[derive(Debug)]
pub struct CameraImage {
    width: u32,
    height: u32,
    space: &'static str,
    data: Vec<f32>,
    white_level: f64,
    black_level: f64,
    cam_xyz: [f32; 9],
    as_shot_wb: [f32; 3],
    wb_pre_applied: bool,
}

fn decode_libraw(path: &Path, scale: f64) -> Result<CameraImage, String> {
    if !matches!(scale, 1.0 | 0.5 | 0.25) {
        return Err("scale must be 1, 0.5, or 0.25".to_owned());
    }
    let decoded = libraw_sys::decode(path)?;
    let source_width = decoded.metadata.width;
    let source_height = decoded.metadata.height;
    let width = (source_width as f64 * scale).floor() as u32;
    let height = (source_height as f64 * scale).floor() as u32;
    let data = if width == source_width && height == source_height {
        decoded.data
    } else {
        resample_rgb(&decoded.data, source_width, source_height, width, height)
    };
    let green = decoded.metadata.as_shot_wb[1];
    let as_shot_wb = if green.is_finite() && green > 0.0 {
        [
            decoded.metadata.as_shot_wb[0] / green,
            1.0,
            decoded.metadata.as_shot_wb[2] / green,
        ]
    } else {
        [1.0, 1.0, 1.0]
    };
    Ok(CameraImage {
        width,
        height,
        space: "camera",
        data,
        white_level: f64::from(decoded.metadata.white_level),
        black_level: f64::from(decoded.metadata.black_level),
        cam_xyz: decoded.metadata.cam_xyz[..9]
            .try_into()
            .expect("camera matrix has nine values"),
        as_shot_wb,
        wb_pre_applied: decoded.metadata.wb_pre_applied,
    })
}

#[napi(object)]
pub struct LibrawProbeResult {
    pub supported: bool,
    pub compression: Option<u32>,
    pub notes: Vec<String>,
}

#[napi(object)]
pub struct LibrawImageResult {
    pub width: u32,
    pub height: u32,
    pub space: String,
    pub data: Float32Array,
    pub white_level: f64,
    pub black_level: f64,
    pub cam_xyz: Vec<f64>,
    pub as_shot_wb: Vec<f64>,
    pub wb_pre_applied: bool,
}

#[napi(object)]
pub struct DevelopedImageResult {
    pub data: Float32Array,
    pub space: String,
    pub white_level: f64,
    pub black_level: f64,
    pub wb_pre_applied: bool,
}

#[napi]
pub fn develop_camera_front(
    data: Float32Array,
    white_level: f64,
    black_level: f64,
    cam_xyz: Vec<f64>,
    as_shot_wb: Vec<f64>,
    wb_pre_applied: bool,
) -> AsyncTask<CameraFrontTask> {
    AsyncTask::new(CameraFrontTask {
        data: data.to_vec(),
        white_level: white_level as f32,
        black_level: black_level as f32,
        cam_xyz,
        as_shot_wb,
        wb_pre_applied,
    })
}

#[napi]
pub fn convert_display_srgb_to_linear_rec2020(data: Uint16Array) -> AsyncTask<DisplayFrontTask> {
    AsyncTask::new(DisplayFrontTask {
        data: data.to_vec(),
    })
}

#[napi]
pub fn convert_linear_rec2020_to_display_srgb(data: Float32Array) -> AsyncTask<DisplayBackTask> {
    AsyncTask::new(DisplayBackTask {
        data: data.to_vec(),
    })
}

pub struct CameraFrontTask {
    data: Vec<f32>,
    white_level: f32,
    black_level: f32,
    cam_xyz: Vec<f64>,
    as_shot_wb: Vec<f64>,
    wb_pre_applied: bool,
}

impl Task for CameraFrontTask {
    type Output = Vec<f32>;
    type JsValue = DevelopedImageResult;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        camera_front(
            &self.data,
            self.white_level,
            self.black_level,
            &self.cam_xyz,
            &self.as_shot_wb,
            self.wb_pre_applied,
        )
        .map_err(|message| Error::new(Status::InvalidArg, message))
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(DevelopedImageResult {
            data: data.into(),
            space: "scene-linear-rec2020".to_owned(),
            white_level: 1.0,
            black_level: 0.0,
            wb_pre_applied: true,
        })
    }
}

pub struct DisplayFrontTask {
    data: Vec<u16>,
}

pub struct DisplayBackTask {
    data: Vec<f32>,
}

impl Task for DisplayFrontTask {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        display_srgb_to_linear_rec2020(&self.data)
            .map_err(|message| Error::new(Status::InvalidArg, message))
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }
}

impl Task for DisplayBackTask {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        linear_rec2020_to_display_srgb(&self.data)
            .map_err(|message| Error::new(Status::InvalidArg, message))
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }
}

#[napi]
pub fn libraw_version() -> String {
    libraw_sys::version().to_owned()
}

#[napi]
pub fn probe_libraw(path: String) -> LibrawProbeResult {
    match libraw_sys::probe(Path::new(&path)) {
        Ok(probe) => LibrawProbeResult {
            supported: true,
            compression: Some(probe.compression),
            notes: vec![format!("LibRaw {}", libraw_sys::version())],
        },
        Err(message) => LibrawProbeResult {
            supported: false,
            compression: None,
            notes: vec![message],
        },
    }
}

#[napi]
pub fn decode_libraw_image(path: String, scale: f64) -> AsyncTask<DecodeLibrawTask> {
    AsyncTask::new(DecodeLibrawTask { path, scale })
}

pub struct DecodeLibrawTask {
    path: String,
    scale: f64,
}

impl Task for DecodeLibrawTask {
    type Output = CameraImage;
    type JsValue = LibrawImageResult;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        decode_libraw(Path::new(&self.path), self.scale)
            .map_err(|message| Error::new(Status::GenericFailure, message))
    }

    fn resolve(&mut self, _env: napi::Env, image: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(image.into())
    }
}

impl From<CameraImage> for LibrawImageResult {
    fn from(image: CameraImage) -> Self {
        Self {
            width: image.width,
            height: image.height,
            space: image.space.to_owned(),
            data: image.data.into(),
            white_level: image.white_level,
            black_level: image.black_level,
            cam_xyz: image.cam_xyz.into_iter().map(f64::from).collect(),
            as_shot_wb: image.as_shot_wb.into_iter().map(f64::from).collect(),
            wb_pre_applied: image.wb_pre_applied,
        }
    }
}

fn resample_rgb(
    input: &[f32],
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
) -> Vec<f32> {
    assert_eq!(
        input.len(),
        source_width as usize * source_height as usize * 3
    );
    assert!(output_width > 0 && output_height > 0);
    let mut output = vec![0.0; output_width as usize * output_height as usize * 3];
    let x_scale = source_width as f32 / output_width as f32;
    let y_scale = source_height as f32 / output_height as f32;
    for y in 0..output_height {
        let source_y = ((y as f32 + 0.5) * y_scale - 0.5).clamp(0.0, source_height as f32 - 1.0);
        let y0 = source_y.floor() as u32;
        let y1 = (y0 + 1).min(source_height - 1);
        let y_fraction = source_y - y0 as f32;
        for x in 0..output_width {
            let source_x = ((x as f32 + 0.5) * x_scale - 0.5).clamp(0.0, source_width as f32 - 1.0);
            let x0 = source_x.floor() as u32;
            let x1 = (x0 + 1).min(source_width - 1);
            let x_fraction = source_x - x0 as f32;
            for channel in 0..3usize {
                let sample = |sample_x: u32, sample_y: u32| {
                    input[((sample_y * source_width + sample_x) * 3) as usize + channel]
                };
                let top = sample(x0, y0) * (1.0 - x_fraction) + sample(x1, y0) * x_fraction;
                let bottom = sample(x0, y1) * (1.0 - x_fraction) + sample(x1, y1) * x_fraction;
                output[((y * output_width + x) * 3) as usize + channel] =
                    top * (1.0 - y_fraction) + bottom * y_fraction;
            }
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_camera_rgb_at_pixel_centers() {
        let input = vec![0.0, 0.0, 0.0, 2.0, 2.0, 2.0, 4.0, 4.0, 4.0, 6.0, 6.0, 6.0];

        assert_eq!(resample_rgb(&input, 2, 2, 1, 1), vec![3.0, 3.0, 3.0]);
    }

    #[test]
    fn decodes_the_libraw_fixture_at_the_requested_scale() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/a7c2.ARW");

        let image = decode_libraw(&fixture, 0.25).expect("fixture decodes");

        assert_eq!((image.width, image.height), (1752, 1168));
        assert_eq!(image.data.len(), 1752 * 1168 * 3);
        assert_eq!(image.space, "camera");
        assert!((image.cam_xyz[0] - 0.7460).abs() < 5e-4);
        assert!((image.as_shot_wb[0] - 2.3164).abs() < 1e-3);
        assert_eq!(image.as_shot_wb[1], 1.0);
        assert!(!image.wb_pre_applied);
    }
}
