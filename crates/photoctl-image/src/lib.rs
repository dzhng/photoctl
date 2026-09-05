//! Native image operations for photoctl.

mod develop;
mod mask;
mod publication;
mod resample;
mod tone_curve;

use std::path::Path;

use napi::{
    Error, Status, Task,
    bindgen_prelude::{AsyncTask, Float32Array, Uint8Array, Uint16Array},
};
use napi_derive::napi;

use develop::{
    Develop, apply_delta_artifact_in_place, apply_develop_artifact_in_place,
    apply_develop_in_place, camera_front, display_srgb_to_linear_rec2020,
    linear_rec2020_to_display_srgb, validate_artifact_samples,
};
pub use mask::{
    composite_masked_pixels, feather_mask, lift_masked_pixels, morphology_mask,
    overlay_masked_pixels, transform_mask_pixels,
};
use publication::{AtomicRenameOutcome, atomic_rename_no_replace as rename_no_replace};
use resample::{Filter as ResampleFilter, resize};
pub use resample::{
    resample_display_srgb, resample_display_srgb_region, resample_display_srgb8, resample_pixels,
    transform_pixels,
};

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
        resize(
            &decoded.data,
            source_width,
            source_height,
            3,
            width,
            height,
            ResampleFilter::Bilinear,
        )?
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

#[napi(object)]
pub struct DevelopParameters {
    pub brilliance: Option<f64>,
    pub exposure: Option<f64>,
    pub highlights: Option<f64>,
    pub shadows: Option<f64>,
    pub brightness: Option<f64>,
    pub contrast: Option<f64>,
    pub black_point: Option<f64>,
    pub saturation: Option<f64>,
    pub vibrance: Option<f64>,
    pub temperature_offset_k: Option<f64>,
    pub tint: Option<f64>,
    pub cast: Option<f64>,
    pub curves: Option<DevelopCurvesParameters>,
    pub levels: Option<DevelopLevelsParameters>,
    pub definition: Option<f64>,
    pub sharpen: Option<f64>,
    pub noise_reduction_luminance: Option<f64>,
    pub noise_reduction_color: Option<f64>,
}

#[napi(object)]
pub struct DevelopCurvesParameters {
    pub rgb: Option<Vec<Vec<f64>>>,
    pub red: Option<Vec<Vec<f64>>>,
    pub green: Option<Vec<Vec<f64>>>,
    pub blue: Option<Vec<Vec<f64>>>,
}

#[napi(object)]
pub struct DevelopLevelsParameters {
    pub black: f64,
    pub midpoint: f64,
    pub white: f64,
}

#[napi]
pub fn atomic_rename_no_replace(source: String, destination: String) -> napi::Result<String> {
    let outcome = rename_no_replace(Path::new(&source), Path::new(&destination))
        .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
    Ok(match outcome {
        AtomicRenameOutcome::Installed => "installed",
        AtomicRenameOutcome::Exists => "exists",
        AtomicRenameOutcome::Unsupported => "unsupported",
    }
    .to_owned())
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

#[napi]
pub fn apply_develop_pixels(
    data: Float32Array,
    width: u32,
    height: u32,
    parameters: DevelopParameters,
) -> AsyncTask<DevelopTask> {
    AsyncTask::new(DevelopTask {
        data: data.to_vec(),
        width: width as usize,
        height: height as usize,
        parameters: develop_parameters(parameters),
    })
}

#[napi]
pub fn apply_develop_artifact(
    data: Uint8Array,
    pixel_offset: u32,
    pixel_bytes: u32,
    width: u32,
    height: u32,
    parameters: DevelopParameters,
) -> AsyncTask<DevelopArtifactTask> {
    AsyncTask::new(DevelopArtifactTask {
        data: data.to_vec(),
        pixel_offset: pixel_offset as usize,
        pixel_bytes: pixel_bytes as usize,
        width: width as usize,
        height: height as usize,
        parameters: develop_parameters(parameters),
        delta: false,
    })
}

#[napi]
pub fn apply_delta_artifact(
    data: Uint8Array,
    pixel_offset: u32,
    pixel_bytes: u32,
    width: u32,
    height: u32,
    parameters: DevelopParameters,
) -> AsyncTask<DevelopArtifactTask> {
    AsyncTask::new(DevelopArtifactTask {
        data: data.to_vec(),
        pixel_offset: pixel_offset as usize,
        pixel_bytes: pixel_bytes as usize,
        width: width as usize,
        height: height as usize,
        parameters: develop_parameters(parameters),
        delta: true,
    })
}

#[napi]
#[allow(clippy::too_many_arguments)]
pub fn transform_artifact_pixels(
    data: Uint8Array,
    pixel_offset: u32,
    pixel_bytes: u32,
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
    matrix: Vec<f64>,
    filter: String,
) -> napi::Result<AsyncTask<TransformArtifactTask>> {
    let matrix = matrix.try_into().map_err(|_| {
        Error::new(
            Status::InvalidArg,
            "transform matrix must contain six values",
        )
    })?;
    let filter = match filter.as_str() {
        "bilinear" => ResampleFilter::Bilinear,
        "lanczos3" => ResampleFilter::Lanczos3,
        _ => return Err(Error::new(Status::InvalidArg, "unknown resample filter")),
    };
    Ok(AsyncTask::new(TransformArtifactTask {
        data: data.to_vec(),
        pixel_offset: pixel_offset as usize,
        pixel_bytes: pixel_bytes as usize,
        source_width,
        source_height,
        output_width,
        output_height,
        matrix,
        filter,
    }))
}

fn develop_parameters(parameters: DevelopParameters) -> Develop {
    Develop {
        brilliance: parameters.brilliance.unwrap_or_default() as f32,
        exposure: parameters.exposure.unwrap_or_default() as f32,
        highlights: parameters.highlights.unwrap_or_default() as f32,
        shadows: parameters.shadows.unwrap_or_default() as f32,
        brightness: parameters.brightness.unwrap_or_default() as f32,
        contrast: parameters.contrast.unwrap_or_default() as f32,
        black_point: parameters.black_point.unwrap_or_default() as f32,
        saturation: parameters.saturation.unwrap_or_default() as f32,
        vibrance: parameters.vibrance.unwrap_or_default() as f32,
        temperature_offset_k: parameters.temperature_offset_k.unwrap_or_default() as f32,
        tint: parameters.tint.unwrap_or_default() as f32,
        cast: parameters.cast.unwrap_or_default() as f32,
        curves: parameters.curves.map(|curves| develop::CurveParameters {
            rgb: curves.rgb.map(curve_points),
            red: curves.red.map(curve_points),
            green: curves.green.map(curve_points),
            blue: curves.blue.map(curve_points),
        }),
        levels: parameters.levels.map(|levels| develop::LevelsParameters {
            black: levels.black as f32,
            midpoint: levels.midpoint as f32,
            white: levels.white as f32,
        }),
        definition: parameters.definition.unwrap_or_default() as f32,
        sharpen: parameters.sharpen.unwrap_or_default() as f32,
        noise_reduction_luminance: parameters.noise_reduction_luminance.unwrap_or_default() as f32,
        noise_reduction_color: parameters.noise_reduction_color.unwrap_or_default() as f32,
    }
}

fn curve_points(points: Vec<Vec<f64>>) -> Vec<Vec<f32>> {
    points
        .into_iter()
        .map(|point| point.into_iter().map(|value| value as f32).collect())
        .collect()
}

#[napi]
pub fn validate_linear_artifact_samples(
    data: Uint8Array,
    pixel_offset: u32,
    pixel_bytes: u32,
) -> AsyncTask<ValidateLinearArtifactTask> {
    AsyncTask::new(ValidateLinearArtifactTask {
        data: data.to_vec(),
        pixel_offset: pixel_offset as usize,
        pixel_bytes: pixel_bytes as usize,
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

pub struct DevelopTask {
    data: Vec<f32>,
    width: usize,
    height: usize,
    parameters: Develop,
}

pub struct DevelopArtifactTask {
    data: Vec<u8>,
    pixel_offset: usize,
    pixel_bytes: usize,
    width: usize,
    height: usize,
    parameters: Develop,
    delta: bool,
}

pub struct TransformArtifactTask {
    data: Vec<u8>,
    pixel_offset: usize,
    pixel_bytes: usize,
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
    matrix: [f64; 6],
    filter: ResampleFilter,
}

pub struct ValidateLinearArtifactTask {
    data: Vec<u8>,
    pixel_offset: usize,
    pixel_bytes: usize,
}

impl Task for DevelopTask {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        // N-API typed arrays may still be mutated by JavaScript, so the entry point owns a copy.
        // Spatial passes delay only the source slices still needed by the moving kernel; scanning
        // the long axis keeps this ring a radius-sized fraction of a frame.
        apply_develop_in_place(
            &mut self.data,
            self.width,
            self.height,
            std::mem::take(&mut self.parameters),
        )
        .map_err(|message| Error::new(Status::InvalidArg, message))?;
        Ok(std::mem::take(&mut self.data))
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }
}

impl Task for DevelopArtifactTask {
    type Output = Vec<u8>;
    type JsValue = Uint8Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let apply = if self.delta {
            apply_delta_artifact_in_place
        } else {
            apply_develop_artifact_in_place
        };
        apply(
            &mut self.data,
            self.pixel_offset,
            self.pixel_bytes,
            self.width,
            self.height,
            std::mem::take(&mut self.parameters),
        )
        .map_err(|message| Error::new(Status::InvalidArg, message))?;
        Ok(std::mem::take(&mut self.data))
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }
}

impl Task for TransformArtifactTask {
    type Output = Vec<u8>;
    type JsValue = Uint8Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        validate_artifact_samples(&self.data, self.pixel_offset, self.pixel_bytes)
            .map_err(|message| Error::new(Status::InvalidArg, message))?;
        let mut header = self.data[..self.pixel_offset].to_vec();
        let input = self.data[self.pixel_offset..self.pixel_offset + self.pixel_bytes]
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().expect("four-byte float sample")))
            .collect::<Vec<_>>();
        self.data = Vec::new();
        let output = resample::transform(
            &input,
            self.source_width,
            self.source_height,
            3,
            self.output_width,
            self.output_height,
            self.matrix,
            self.filter,
        )
        .map_err(|message| Error::new(Status::InvalidArg, message))?;
        drop(input);
        patch_tiff_scalar(&mut header, 256, self.output_width)?;
        patch_tiff_scalar(&mut header, 257, self.output_height)?;
        patch_tiff_scalar(&mut header, 278, self.output_height)?;
        patch_tiff_scalar(&mut header, 279, (output.len() * 4) as u32)?;
        header.reserve(output.len() * 4);
        for sample in output {
            header.extend_from_slice(&sample.to_le_bytes());
        }
        Ok(header)
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }
}

fn patch_tiff_scalar(data: &mut [u8], tag: u16, value: u32) -> napi::Result<()> {
    if data.len() < 10 || &data[..2] != b"II" {
        return Err(Error::new(
            Status::InvalidArg,
            "invalid artifact TIFF header",
        ));
    }
    let ifd_offset = u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize;
    if ifd_offset + 2 > data.len() {
        return Err(Error::new(
            Status::InvalidArg,
            "invalid artifact TIFF directory",
        ));
    }
    let count = u16::from_le_bytes(data[ifd_offset..ifd_offset + 2].try_into().unwrap()) as usize;
    for index in 0..count {
        let entry = ifd_offset + 2 + index * 12;
        if entry + 12 > data.len() {
            return Err(Error::new(
                Status::InvalidArg,
                "invalid artifact TIFF directory",
            ));
        }
        if u16::from_le_bytes(data[entry..entry + 2].try_into().unwrap()) == tag {
            data[entry + 8..entry + 12].copy_from_slice(&value.to_le_bytes());
            return Ok(());
        }
    }
    Err(Error::new(
        Status::InvalidArg,
        "artifact TIFF tag is missing",
    ))
}

impl Task for ValidateLinearArtifactTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        validate_artifact_samples(&self.data, self.pixel_offset, self.pixel_bytes)
            .map_err(|message| Error::new(Status::InvalidArg, message))
    }

    fn resolve(&mut self, _env: napi::Env, _data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
