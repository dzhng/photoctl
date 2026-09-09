use crate::task_memory::TaskMemory;
use napi::{
    Env, Error, Status, Task,
    bindgen_prelude::{AsyncTask, Float32Array, Uint8Array, Uint16Array},
};
use napi_derive::napi;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Filter {
    Bilinear,
    Lanczos3,
}

const MAX_LANCZOS_TRANSFORM_SAMPLES_PER_PIXEL: f64 = 4_096.0;

#[napi(object)]
pub struct PixelFrameTransform {
    pub width: u32,
    pub height: u32,
    pub matrix: Vec<f64>,
}

struct FrameTransform {
    width: u32,
    height: u32,
    matrix: [f64; 6],
}

impl TryFrom<PixelFrameTransform> for FrameTransform {
    type Error = Error;

    fn try_from(frame: PixelFrameTransform) -> napi::Result<Self> {
        let matrix: [f64; 6] = frame
            .matrix
            .try_into()
            .map_err(|_| invalid_argument("frame matrix must contain six values".to_owned()))?;
        if frame.width == 0 || frame.height == 0 || matrix.iter().any(|v| !v.is_finite()) {
            return Err(invalid_argument(
                "frame requires finite geometry and positive dimensions".to_owned(),
            ));
        }
        Ok(Self {
            width: frame.width,
            height: frame.height,
            matrix,
        })
    }
}

pub(crate) fn frame_contains(matrix: [f64; 6], width: u32, height: u32, x: u32, y: u32) -> bool {
    let [a, b, c, d, tx, ty] = matrix;
    let fx = a * (f64::from(x) + 0.5) + c * (f64::from(y) + 0.5) + tx;
    let fy = b * (f64::from(x) + 0.5) + d * (f64::from(y) + 0.5) + ty;
    !(fx < 0.0 || fy < 0.0 || fx >= f64::from(width) || fy >= f64::from(height))
}

#[napi]
pub fn project_supported_rgb_pixels(
    env: Env,
    data: Float32Array,
    width: u32,
    height: u32,
    stages: Vec<PixelFrameTransform>,
    restrictions: Vec<PixelFrameTransform>,
) -> napi::Result<AsyncTask<SupportedProjectionTask>> {
    validate(&data, width, height, 3, width, height).map_err(invalid_argument)?;
    let stages = stages
        .into_iter()
        .map(FrameTransform::try_from)
        .collect::<napi::Result<Vec<_>>>()?;
    let restrictions = restrictions
        .into_iter()
        .map(FrameTransform::try_from)
        .collect::<napi::Result<Vec<_>>>()?;
    let mut capacities = [data.len(), 0];
    for (index, stage) in stages.iter().enumerate() {
        let len = validate(&data, width, height, 3, stage.width, stage.height)
            .map_err(invalid_argument)?;
        capacities[(index + 1) % 2] = capacities[(index + 1) % 2].max(len);
    }
    // Charge actual owned allocations, not predicted work. Alternating buffers
    // keep intermediate frames off the JS heap and avoid per-stage snapshots.
    let mut owned = Vec::with_capacity(capacities[0]);
    owned.extend_from_slice(&data);
    let scratch = Vec::with_capacity(capacities[1]);
    let memory = [
        TaskMemory::for_vec(env, &owned)?,
        TaskMemory::for_vec(env, &scratch)?,
    ];
    Ok(AsyncTask::new(SupportedProjectionTask {
        data: owned,
        scratch,
        memory,
        width,
        height,
        stages,
        restrictions,
    }))
}

pub struct SupportedProjectionTask {
    data: Vec<f32>,
    scratch: Vec<f32>,
    memory: [TaskMemory; 2],
    width: u32,
    height: u32,
    stages: Vec<FrameTransform>,
    restrictions: Vec<FrameTransform>,
}

impl Task for SupportedProjectionTask {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        for stage in &self.stages {
            transform_into(
                &self.data,
                self.width,
                self.height,
                3,
                stage.width,
                stage.height,
                stage.matrix,
                Filter::Lanczos3,
                &mut self.scratch,
            )
            .map_err(invalid_argument)?;
            std::mem::swap(&mut self.data, &mut self.scratch);
            self.width = stage.width;
            self.height = stage.height;
        }
        if self.data.iter().any(|value| !value.is_finite()) {
            return Err(invalid_argument("RGB samples must be finite".to_owned()));
        }
        for y in 0..self.height {
            for x in 0..self.width {
                let supported = self
                    .restrictions
                    .iter()
                    .all(|frame| frame_contains(frame.matrix, frame.width, frame.height, x, y));
                for value in &mut self.data[((y * self.width + x) as usize) * 3..][..3] {
                    // A zero-base support composite produces positive zero,
                    // including for selected negative-zero content.
                    if !supported || *value == 0.0 {
                        *value = 0.0;
                    }
                }
            }
        }
        // Node accounts the exposed backing-store length, not spare Vec capacity.
        // Release the unused workspace before tightening the final allocation.
        self.scratch = Vec::new();
        Ok(std::mem::take(&mut self.data).into_boxed_slice().into_vec())
    }

    fn resolve(&mut self, _env: Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        self.memory[self.stages.len() % 2].release()?;
        Ok(data.into())
    }
}

#[napi]
pub fn resample_display_srgb(
    data: Uint16Array,
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
) -> napi::Result<Uint16Array> {
    Ok(resize_integer_bilinear(
        &data,
        source_width,
        source_height,
        3,
        output_width,
        output_height,
    )
    .map_err(invalid_argument)?
    .into())
}

#[napi]
pub fn resample_display_srgb8(
    data: Uint8Array,
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
) -> napi::Result<Uint8Array> {
    Ok(resize_integer_bilinear(
        &data,
        source_width,
        source_height,
        3,
        output_width,
        output_height,
    )
    .map_err(invalid_argument)?
    .into())
}

#[napi]
pub fn resample_rgb8_antialiased(
    data: Uint8Array,
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
) -> napi::Result<Uint8Array> {
    Ok(resize_rgb8_antialiased(
        &data,
        source_width,
        source_height,
        output_width,
        output_height,
    )
    .map_err(invalid_argument)?
    .into())
}

#[allow(clippy::too_many_arguments)]
#[napi]
pub fn resample_display_srgb_region(
    data: Uint16Array,
    source_width: u32,
    source_height: u32,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
    base_to_source: Option<Vec<f64>>,
) -> napi::Result<Uint16Array> {
    if let Some(matrix) = base_to_source {
        if width == 0 || height == 0 {
            return Err(invalid_argument(
                "sampling region dimensions must be positive".to_owned(),
            ));
        }
        let matrix: [f64; 6] = matrix
            .try_into()
            .map_err(|_| invalid_argument("sampling matrix must contain six values".to_owned()))?;
        let sx = f64::from(width) / f64::from(output_width);
        let sy = f64::from(height) / f64::from(output_height);
        return Ok(sample_integer_affine(
            &data,
            source_width,
            source_height,
            3,
            output_width,
            output_height,
            [
                matrix[0] * sx,
                matrix[1] * sx,
                matrix[2] * sy,
                matrix[3] * sy,
                matrix[0] * f64::from(left) + matrix[2] * f64::from(top) + matrix[4],
                matrix[1] * f64::from(left) + matrix[3] * f64::from(top) + matrix[5],
            ],
        )
        .map_err(invalid_argument)?
        .into());
    }
    Ok(resize_integer_region_bilinear(
        &data,
        source_width,
        source_height,
        3,
        left,
        top,
        width,
        height,
        output_width,
        output_height,
    )
    .map_err(invalid_argument)?
    .into())
}

// This synchronous boundary borrows the source buffer; only the reduced mask is allocated.
#[allow(clippy::too_many_arguments)]
#[napi]
pub fn resample_mask_region(
    data: Float32Array,
    source_width: u32,
    source_height: u32,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
) -> napi::Result<Float32Array> {
    if width == 0
        || height == 0
        || left
            .checked_add(width)
            .is_none_or(|right| right > source_width)
        || top
            .checked_add(height)
            .is_none_or(|bottom| bottom > source_height)
    {
        return Err(invalid_argument(
            "resample region must be inside the source image".to_owned(),
        ));
    }
    let sx = f64::from(output_width) / f64::from(width);
    let sy = f64::from(output_height) / f64::from(height);
    Ok(transform(
        &data,
        source_width,
        source_height,
        1,
        output_width,
        output_height,
        [
            sx,
            0.0,
            0.0,
            sy,
            -f64::from(left) * sx,
            -f64::from(top) * sy,
        ],
        Filter::Bilinear,
    )
    .map_err(invalid_argument)?
    .into())
}

#[napi]
pub fn resample_pixels(
    env: Env,
    data: Float32Array,
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    filter: String,
) -> napi::Result<AsyncTask<ResampleF32Task>> {
    let data = data.to_vec();
    let memory = TaskMemory::for_vec(env, &data)?;
    Ok(AsyncTask::new(ResampleF32Task {
        data,
        memory,
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
        filter: parse_filter(&filter)?,
    }))
}

#[napi]
#[allow(clippy::too_many_arguments)]
pub fn transform_pixels(
    env: Env,
    data: Float32Array,
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    matrix: Vec<f64>,
    filter: String,
) -> napi::Result<AsyncTask<TransformF32Task>> {
    let matrix = matrix.try_into().map_err(|_| {
        Error::new(
            Status::InvalidArg,
            "transform matrix must contain six values",
        )
    })?;
    let data = data.to_vec();
    let memory = TaskMemory::for_vec(env, &data)?;
    Ok(AsyncTask::new(TransformF32Task {
        data,
        memory,
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
        matrix,
        filter: parse_filter(&filter)?,
    }))
}

fn parse_filter(filter: &str) -> napi::Result<Filter> {
    match filter {
        "bilinear" => Ok(Filter::Bilinear),
        "lanczos3" => Ok(Filter::Lanczos3),
        _ => Err(invalid_argument(
            "resample filter must be bilinear or lanczos3".to_owned(),
        )),
    }
}

fn invalid_argument(message: String) -> Error {
    Error::new(Status::InvalidArg, message)
}

pub struct ResampleF32Task {
    data: Vec<f32>,
    memory: TaskMemory,
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    filter: Filter,
}

impl Task for ResampleF32Task {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        resize(
            &self.data,
            self.source_width,
            self.source_height,
            self.channels,
            self.output_width,
            self.output_height,
            self.filter,
        )
        .map_err(invalid_argument)
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }

    fn finally(self, _env: Env) -> napi::Result<()> {
        // Output owns a distinct allocation. Keep input charged through output
        // registration, then free it before discharging its task-owned guard.
        drop(self.data);
        drop(self.memory);
        Ok(())
    }
}

pub struct TransformF32Task {
    data: Vec<f32>,
    memory: TaskMemory,
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    matrix: [f64; 6],
    filter: Filter,
}

impl Task for TransformF32Task {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        transform(
            &self.data,
            self.source_width,
            self.source_height,
            self.channels,
            self.output_width,
            self.output_height,
            self.matrix,
            self.filter,
        )
        .map_err(invalid_argument)
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }

    fn finally(self, _env: Env) -> napi::Result<()> {
        drop(self.data);
        drop(self.memory);
        Ok(())
    }
}

pub fn resize(
    input: &[f32],
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    filter: Filter,
) -> Result<Vec<f32>, String> {
    let output_len = validate(
        input,
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
    )?;
    if filter == Filter::Lanczos3 {
        return Ok(resize_lanczos3(
            input,
            source_width,
            source_height,
            channels,
            output_width,
            output_height,
        ));
    }
    let mut output = vec![0.0; output_len];
    let x_scale = source_width as f64 / output_width as f64;
    let y_scale = source_height as f64 / output_height as f64;
    for output_y in 0..output_height {
        let source_y = (output_y as f64 + 0.5) * y_scale - 0.5;
        for output_x in 0..output_width {
            let source_x = (output_x as f64 + 0.5) * x_scale - 0.5;
            for channel in 0..channels {
                output[pixel_index(output_width, channels, output_x, output_y, channel)] = bilinear(
                    input,
                    source_width,
                    source_height,
                    channels,
                    source_x,
                    source_y,
                    channel,
                );
            }
        }
    }
    Ok(output)
}

fn resize_lanczos3(
    input: &[f32],
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
) -> Vec<f32> {
    let horizontal = lanczos_contributors(source_width, output_width);
    let vertical = lanczos_contributors(source_height, output_height);
    if output_width as u64 * source_height as u64 <= source_width as u64 * output_height as u64 {
        let mut intermediate =
            vec![0.0; output_width as usize * source_height as usize * channels as usize];
        for y in 0..source_height {
            for (output_x, contributors) in horizontal.iter().enumerate() {
                for channel in 0..channels {
                    intermediate
                        [pixel_index(output_width, channels, output_x as u32, y, channel)] =
                        weighted_axis_sample(
                            input,
                            source_width,
                            channels,
                            y,
                            channel,
                            contributors,
                            true,
                        );
                }
            }
        }
        filter_vertical(
            &intermediate,
            output_width,
            channels,
            output_height,
            &vertical,
        )
    } else {
        let mut intermediate =
            vec![0.0; source_width as usize * output_height as usize * channels as usize];
        for (output_y, contributors) in vertical.iter().enumerate() {
            for x in 0..source_width {
                for channel in 0..channels {
                    intermediate
                        [pixel_index(source_width, channels, x, output_y as u32, channel)] =
                        weighted_axis_sample(
                            input,
                            source_width,
                            channels,
                            x,
                            channel,
                            contributors,
                            false,
                        );
                }
            }
        }
        filter_horizontal(
            &intermediate,
            source_width,
            output_height,
            channels,
            output_width,
            &horizontal,
        )
    }
}

fn filter_horizontal(
    input: &[f32],
    source_width: u32,
    height: u32,
    channels: u32,
    output_width: u32,
    contributors: &[Vec<(u32, f64)>],
) -> Vec<f32> {
    let mut output = vec![0.0; output_width as usize * height as usize * channels as usize];
    for y in 0..height {
        for (output_x, samples) in contributors.iter().enumerate() {
            for channel in 0..channels {
                output[pixel_index(output_width, channels, output_x as u32, y, channel)] =
                    weighted_axis_sample(input, source_width, channels, y, channel, samples, true);
            }
        }
    }
    output
}

fn filter_vertical(
    input: &[f32],
    width: u32,
    channels: u32,
    output_height: u32,
    contributors: &[Vec<(u32, f64)>],
) -> Vec<f32> {
    let mut output = vec![0.0; width as usize * output_height as usize * channels as usize];
    for (output_y, samples) in contributors.iter().enumerate() {
        for x in 0..width {
            for channel in 0..channels {
                output[pixel_index(width, channels, x, output_y as u32, channel)] =
                    weighted_axis_sample(input, width, channels, x, channel, samples, false);
            }
        }
    }
    output
}

fn weighted_axis_sample(
    input: &[f32],
    width: u32,
    channels: u32,
    fixed: u32,
    channel: u32,
    contributors: &[(u32, f64)],
    horizontal: bool,
) -> f32 {
    contributors
        .iter()
        .map(|(varying, weight)| {
            let (x, y) = if horizontal {
                (*varying, fixed)
            } else {
                (fixed, *varying)
            };
            f64::from(input[pixel_index(width, channels, x, y, channel)]) * weight
        })
        .sum::<f64>() as f32
}

fn lanczos_contributors(source_length: u32, output_length: u32) -> Vec<Vec<(u32, f64)>> {
    let scale = f64::from(source_length) / f64::from(output_length);
    let support = scale.max(1.0);
    (0..output_length)
        .map(|output| {
            let center = (f64::from(output) + 0.5) * scale - 0.5;
            let start = (center - 3.0 * support).floor() as i64 + 1;
            let end = (center + 3.0 * support).floor() as i64;
            let mut contributors: Vec<(u32, f64)> = Vec::new();
            for sample in start..=end {
                let index = sample.clamp(0, i64::from(source_length - 1)) as u32;
                let weight = lanczos((center - sample as f64) / support) / support;
                if let Some((_, current)) =
                    contributors.last_mut().filter(|(seen, _)| *seen == index)
                {
                    *current += weight;
                } else {
                    contributors.push((index, weight));
                }
            }
            let sum = contributors.iter().map(|(_, weight)| weight).sum::<f64>();
            for (_, weight) in &mut contributors {
                *weight /= sum;
            }
            contributors
        })
        .collect()
}

trait IntegerSample: Copy + Default {
    const MAX: f64;

    fn to_f64(self) -> f64;
    fn from_f64(value: f64) -> Self;
}

impl IntegerSample for u8 {
    const MAX: f64 = u8::MAX as f64;

    fn to_f64(self) -> f64 {
        f64::from(self)
    }

    fn from_f64(value: f64) -> Self {
        value.round().clamp(0.0, <Self as IntegerSample>::MAX) as Self
    }
}

impl IntegerSample for u16 {
    const MAX: f64 = u16::MAX as f64;

    fn to_f64(self) -> f64 {
        f64::from(self)
    }

    fn from_f64(value: f64) -> Self {
        value.round().clamp(0.0, <Self as IntegerSample>::MAX) as Self
    }
}

fn resize_rgb8_antialiased(
    input: &[u8],
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
) -> Result<Vec<u8>, String> {
    let output_len = validate_len(
        input.len(),
        source_width,
        source_height,
        3,
        output_width,
        output_height,
    )?;
    let horizontal_len = validate_len(
        input.len(),
        source_width,
        source_height,
        3,
        output_width,
        source_height,
    )?;
    let columns = byte_bilinear_weights(source_width, output_width);
    let rows = byte_bilinear_weights(source_height, output_height);
    let mut horizontal = vec![0; horizontal_len];
    for y in 0..source_height as usize {
        for (x, (start, weights)) in columns.iter().enumerate() {
            for channel in 0..3 {
                let sum = weights
                    .iter()
                    .enumerate()
                    .fold(1_i64 << 21, |sum, (offset, weight)| {
                        sum + i64::from(
                            input[(y * source_width as usize + start + offset) * 3 + channel],
                        ) * weight
                    });
                horizontal[(y * output_width as usize + x) * 3 + channel] =
                    (sum >> 22).clamp(0, 255) as u8;
            }
        }
    }
    let stride = output_width as usize * 3;
    let mut output = vec![0; output_len];
    for (y, (start, weights)) in rows.iter().enumerate() {
        for x in 0..stride {
            let sum = weights
                .iter()
                .enumerate()
                .fold(1_i64 << 21, |sum, (offset, weight)| {
                    sum + i64::from(horizontal[(start + offset) * stride + x]) * weight
                });
            output[y * stride + x] = (sum >> 22).clamp(0, 255) as u8;
        }
    }
    Ok(output)
}

// PIL-compatible RGB resizing rounds each separable pass using 22-bit weights.
// The widened triangle when shrinking is essential to the model's input contract.
fn byte_bilinear_weights(source: u32, output: u32) -> Vec<(usize, Vec<i64>)> {
    let scale = f64::from(source) / f64::from(output);
    let support = scale.max(1.0);
    (0..output)
        .map(|position| {
            let center = (f64::from(position) + 0.5) * scale;
            let start = ((center - support + 0.5) as i64).max(0) as usize;
            let end = ((center + support + 0.5) as usize).min(source as usize);
            let weights: Vec<_> = (start..end)
                .map(|index| (1.0 - ((index as f64 + 0.5 - center) / support).abs()).max(0.0))
                .collect();
            let total: f64 = weights.iter().sum();
            (
                start,
                weights
                    .into_iter()
                    .map(|weight| (weight / total * f64::from(1 << 22) + 0.5) as i64)
                    .collect(),
            )
        })
        .collect()
}

fn resize_integer_bilinear<T: IntegerSample>(
    input: &[T],
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
) -> Result<Vec<T>, String> {
    resize_integer_region_bilinear(
        input,
        source_width,
        source_height,
        channels,
        0,
        0,
        source_width,
        source_height,
        output_width,
        output_height,
    )
}

// Borrow the full source. Work and allocation are bounded by the requested output, not source size.
#[allow(clippy::too_many_arguments)]
fn sample_integer_affine<T: IntegerSample>(
    input: &[T],
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    output_to_source: [f64; 6],
) -> Result<Vec<T>, String> {
    let len = validate_len(
        input.len(),
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
    )?;
    if output_to_source.iter().any(|value| !value.is_finite()) {
        return Err("sampling matrix values must be finite".to_owned());
    }
    let mut output = vec![T::default(); len];
    let [a, b, c, d, tx, ty] = output_to_source;
    for y in 0..output_height {
        for x in 0..output_width {
            let source_x = a * (f64::from(x) + 0.5) + c * (f64::from(y) + 0.5) + tx;
            let source_y = b * (f64::from(x) + 0.5) + d * (f64::from(y) + 0.5) + ty;
            if source_x < 0.0
                || source_y < 0.0
                || source_x >= f64::from(source_width)
                || source_y >= f64::from(source_height)
            {
                continue;
            }
            let (x0, x1, fx) = linear_coordinates(source_x - 0.5, source_width);
            let (y0, y1, fy) = linear_coordinates(source_y - 0.5, source_height);
            for channel in 0..channels {
                let sample =
                    |x, y| input[pixel_index(source_width, channels, x, y, channel)].to_f64();
                let upper = sample(x0, y0) * (1.0 - fx) + sample(x1, y0) * fx;
                let lower = sample(x0, y1) * (1.0 - fx) + sample(x1, y1) * fx;
                output[pixel_index(output_width, channels, x, y, channel)] =
                    T::from_f64(upper * (1.0 - fy) + lower * fy);
            }
        }
    }
    Ok(output)
}

#[allow(clippy::too_many_arguments)]
fn resize_integer_region_bilinear<T: IntegerSample>(
    input: &[T],
    source_width: u32,
    source_height: u32,
    channels: u32,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
) -> Result<Vec<T>, String> {
    let output_len = validate_len(
        input.len(),
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
    )?;
    if width == 0
        || height == 0
        || left
            .checked_add(width)
            .is_none_or(|right| right > source_width)
        || top
            .checked_add(height)
            .is_none_or(|bottom| bottom > source_height)
    {
        return Err("resample region must be inside the source image".to_owned());
    }
    let mut output = vec![T::default(); output_len];
    let x_scale = width as f64 / output_width as f64;
    let y_scale = height as f64 / output_height as f64;
    for output_y in 0..output_height {
        let source_y = (output_y as f64 + 0.5) * y_scale - 0.5;
        let (y0, y1, y_fraction) = linear_coordinates(source_y, height);
        for output_x in 0..output_width {
            let source_x = (output_x as f64 + 0.5) * x_scale - 0.5;
            let (x0, x1, x_fraction) = linear_coordinates(source_x, width);
            for channel in 0..channels {
                let sample = |x, y| {
                    input[pixel_index(source_width, channels, left + x, top + y, channel)].to_f64()
                };
                let top = sample(x0, y0) * (1.0 - x_fraction) + sample(x1, y0) * x_fraction;
                let bottom = sample(x0, y1) * (1.0 - x_fraction) + sample(x1, y1) * x_fraction;
                output[pixel_index(output_width, channels, output_x, output_y, channel)] =
                    T::from_f64(top * (1.0 - y_fraction) + bottom * y_fraction);
            }
        }
    }
    Ok(output)
}

#[allow(clippy::too_many_arguments)]
pub fn transform(
    input: &[f32],
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    matrix: [f64; 6],
    filter: Filter,
) -> Result<Vec<f32>, String> {
    let mut output = Vec::new();
    transform_into(
        input,
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
        matrix,
        filter,
        &mut output,
    )?;
    Ok(output)
}

#[allow(clippy::too_many_arguments)]
fn transform_into(
    input: &[f32],
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    matrix: [f64; 6],
    filter: Filter,
    output: &mut Vec<f32>,
) -> Result<(), String> {
    let output_len = validate(
        input,
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
    )?;
    if matrix.iter().any(|value| !value.is_finite()) {
        return Err("transform matrix values must be finite".to_owned());
    }
    let determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if !determinant.is_finite() {
        return Err("transform matrix must have a finite inverse".to_owned());
    }
    if determinant == 0.0 {
        return Err("transform matrix must be invertible".to_owned());
    }
    let inverse = [
        matrix[3] / determinant,
        -matrix[1] / determinant,
        -matrix[2] / determinant,
        matrix[0] / determinant,
        (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
        (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
    ];
    if inverse.iter().any(|value| !value.is_finite()) {
        return Err("transform matrix must have a finite inverse".to_owned());
    }
    let exact = is_exact_integer_transform(matrix);
    let filter_support = (
        inverse[0].hypot(inverse[2]).max(1.0),
        inverse[1].hypot(inverse[3]).max(1.0),
    );
    if !exact
        && filter == Filter::Lanczos3
        && (6.0 * filter_support.0).ceil() * (6.0 * filter_support.1).ceil()
            > MAX_LANCZOS_TRANSFORM_SAMPLES_PER_PIXEL
    {
        return Err("Lanczos3 transform kernel exceeds the safe work limit".to_owned());
    }
    output.resize(output_len, 0.0);
    let mut x_weights = TransformWeights::default();
    let mut y_weights = TransformWeights::default();
    for output_y in 0..output_height {
        for output_x in 0..output_width {
            let output_center_x = f64::from(output_x) + 0.5;
            let output_center_y = f64::from(output_y) + 0.5;
            let source_x =
                inverse[0] * output_center_x + inverse[2] * output_center_y + inverse[4] - 0.5;
            let source_y =
                inverse[1] * output_center_x + inverse[3] * output_center_y + inverse[5] - 0.5;
            if !exact && filter == Filter::Lanczos3 {
                let outside = source_x <= -3.0 * filter_support.0
                    || source_y <= -3.0 * filter_support.1
                    || source_x >= f64::from(source_width - 1) + 3.0 * filter_support.0
                    || source_y >= f64::from(source_height - 1) + 3.0 * filter_support.1;
                let offset = pixel_index(output_width, channels, output_x, output_y, 0);
                let pixel = &mut output[offset..offset + channels as usize];
                if outside {
                    pixel.fill(0.0);
                } else {
                    x_weights.prepare(source_x, filter_support.0);
                    y_weights.prepare(source_y, filter_support.1);
                    for (channel, value) in pixel.iter_mut().enumerate() {
                        let mut weighted = 0.0_f64;
                        let mut weight_sum = 0.0_f64;
                        // Reuse axis weights, but preserve each channel's original tap order.
                        for (yi, y_weight) in y_weights.values.iter().enumerate() {
                            for (xi, x_weight) in x_weights.values.iter().enumerate() {
                                let weight = x_weight * y_weight;
                                weighted += f64::from(exact_sample(
                                    input,
                                    source_width,
                                    source_height,
                                    channels,
                                    x_weights.start + xi as i64,
                                    y_weights.start + yi as i64,
                                    channel as u32,
                                )) * weight;
                                weight_sum += weight;
                            }
                        }
                        *value = (weighted / weight_sum) as f32;
                    }
                }
                continue;
            }
            for channel in 0..channels {
                let value = if exact {
                    exact_sample(
                        input,
                        source_width,
                        source_height,
                        channels,
                        source_x.round() as i64,
                        source_y.round() as i64,
                        channel,
                    )
                } else if source_x <= -1.0
                    || source_y <= -1.0
                    || source_x >= f64::from(source_width)
                    || source_y >= f64::from(source_height)
                {
                    0.0
                } else {
                    bilinear_transparent(
                        input,
                        source_width,
                        source_height,
                        channels,
                        source_x,
                        source_y,
                        channel,
                    )
                };
                output[pixel_index(output_width, channels, output_x, output_y, channel)] = value;
            }
        }
    }
    Ok(())
}

fn is_exact_integer_transform(matrix: [f64; 6]) -> bool {
    matrix
        .iter()
        .all(|value| (*value - value.round()).abs() < 1e-12)
        && matrix[0] * matrix[0] + matrix[1] * matrix[1] == 1.0
        && matrix[2] * matrix[2] + matrix[3] * matrix[3] == 1.0
        && matrix[0] * matrix[2] + matrix[1] * matrix[3] == 0.0
}

#[allow(clippy::too_many_arguments)]
fn exact_sample(
    input: &[f32],
    width: u32,
    height: u32,
    channels: u32,
    x: i64,
    y: i64,
    channel: u32,
) -> f32 {
    if x < 0 || y < 0 || x >= i64::from(width) || y >= i64::from(height) {
        return 0.0;
    }
    input[pixel_index(width, channels, x as u32, y as u32, channel)]
}

#[derive(Default)]
struct TransformWeights {
    start: i64,
    values: Vec<f64>,
}

impl TransformWeights {
    fn prepare(&mut self, position: f64, support: f64) {
        self.start = (position - 3.0 * support).floor() as i64 + 1;
        let end = (position + 3.0 * support).floor() as i64;
        self.values.clear();
        self.values.extend(
            (self.start..=end)
                .map(|sample| lanczos((position - sample as f64) / support) / support),
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn bilinear_transparent(
    input: &[f32],
    width: u32,
    height: u32,
    channels: u32,
    x: f64,
    y: f64,
    channel: u32,
) -> f32 {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let x_fraction = x - x0 as f64;
    let y_fraction = y - y0 as f64;
    let sample = |sample_x, sample_y| {
        f64::from(exact_sample(
            input, width, height, channels, sample_x, sample_y, channel,
        ))
    };
    let top = sample(x0, y0) * (1.0 - x_fraction) + sample(x0 + 1, y0) * x_fraction;
    let bottom = sample(x0, y0 + 1) * (1.0 - x_fraction) + sample(x0 + 1, y0 + 1) * x_fraction;
    (top * (1.0 - y_fraction) + bottom * y_fraction) as f32
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn lanczos3(
    input: &[f32],
    width: u32,
    height: u32,
    channels: u32,
    x: f64,
    y: f64,
    x_scale: f64,
    y_scale: f64,
    channel: u32,
) -> f32 {
    let x_support = x_scale.max(1.0);
    let y_support = y_scale.max(1.0);
    let x_start = (x - 3.0 * x_support).floor() as i64 + 1;
    let x_end = (x + 3.0 * x_support).floor() as i64;
    let y_start = (y - 3.0 * y_support).floor() as i64 + 1;
    let y_end = (y + 3.0 * y_support).floor() as i64;
    let mut weighted = 0.0_f64;
    let mut weight_sum = 0.0_f64;
    for sample_y in y_start..=y_end {
        let y_weight = lanczos((y - sample_y as f64) / y_support) / y_support;
        for sample_x in x_start..=x_end {
            let x_weight = lanczos((x - sample_x as f64) / x_support) / x_support;
            let weight = x_weight * y_weight;
            weighted += f64::from(exact_sample(
                input, width, height, channels, sample_x, sample_y, channel,
            )) * weight;
            weight_sum += weight;
        }
    }
    (weighted / weight_sum) as f32
}

fn lanczos(distance: f64) -> f64 {
    if distance == 0.0 {
        return 1.0;
    }
    if distance.abs() >= 3.0 {
        return 0.0;
    }
    let pi_distance = std::f64::consts::PI * distance;
    (pi_distance.sin() / pi_distance) * ((pi_distance / 3.0).sin() / (pi_distance / 3.0))
}

fn validate(
    input: &[f32],
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
) -> Result<usize, String> {
    validate_len(
        input.len(),
        source_width,
        source_height,
        channels,
        output_width,
        output_height,
    )
}

fn validate_len(
    input_len: usize,
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
) -> Result<usize, String> {
    if source_width == 0
        || source_height == 0
        || output_width == 0
        || output_height == 0
        || channels == 0
    {
        return Err("image dimensions and channel count must be positive".to_owned());
    }
    let expected_input_len = pixel_count(source_width, source_height, channels)?;
    if input_len != expected_input_len {
        return Err("pixel buffer length does not match its dimensions".to_owned());
    }
    pixel_count(output_width, output_height, channels)
}

fn pixel_count(width: u32, height: u32, channels: u32) -> Result<usize, String> {
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(channels as usize))
        .ok_or_else(|| "pixel buffer dimensions are too large".to_owned())
}

fn pixel_index(width: u32, channels: u32, x: u32, y: u32, channel: u32) -> usize {
    (y as usize * width as usize + x as usize) * channels as usize + channel as usize
}

fn bilinear(
    input: &[f32],
    width: u32,
    height: u32,
    channels: u32,
    x: f64,
    y: f64,
    channel: u32,
) -> f32 {
    let (x0, x1, x_fraction) = linear_coordinates(x, width);
    let (y0, y1, y_fraction) = linear_coordinates(y, height);
    let sample = |sample_x: u32, sample_y: u32| {
        input[pixel_index(width, channels, sample_x, sample_y, channel)]
    };
    let top =
        f64::from(sample(x0, y0)) * (1.0 - x_fraction) + f64::from(sample(x1, y0)) * x_fraction;
    let bottom =
        f64::from(sample(x0, y1)) * (1.0 - x_fraction) + f64::from(sample(x1, y1)) * x_fraction;
    (top * (1.0 - y_fraction) + bottom * y_fraction) as f32
}

fn linear_coordinates(position: f64, length: u32) -> (u32, u32, f64) {
    let position = position.clamp(0.0, f64::from(length - 1));
    let lower = position.floor() as u32;
    (
        lower,
        (lower + 1).min(length - 1),
        position - f64::from(lower),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        Filter, lanczos_contributors, resize, resize_integer_region_bilinear,
        sample_integer_affine, transform,
    };

    #[test]
    fn affine_weight_reuse_preserves_float_words_across_geometry_and_channels() {
        // The pre-optimization scalar filter is an exact arithmetic oracle, not a
        // different quality reference: reassociation here would change canonical pixels.
        for channels in [1, 3, 4] {
            let input: Vec<f32> = (0..7 * 5 * channels)
                .map(|i| ((i * 31 % 101) as f32 - 20.0) / 17.0)
                .collect();
            for matrix in [
                [1.0, 0.0, 0.0, 1.0, 0.125, -0.33],
                [2.0, 0.25, -0.15, 2.0, -2.1, 1.3],
                [0.37, 0.1, -0.2, 0.6, 0.2, -0.8],
                [0.8, 0.6, -0.6, 0.8, 2.2, -1.7],
                [-1.1, 0.2, 0.1, 0.9, 4.0, 0.5],
            ] {
                let [a, b, c, d, tx, ty] = matrix;
                let determinant = a * d - b * c;
                let inverse: [f64; 6] = [
                    d / determinant,
                    -b / determinant,
                    -c / determinant,
                    a / determinant,
                    (c * ty - d * tx) / determinant,
                    (b * tx - a * ty) / determinant,
                ];
                let sx = inverse[0].hypot(inverse[2]).max(1.0);
                let sy = inverse[1].hypot(inverse[3]).max(1.0);
                let output =
                    transform(&input, 7, 5, channels, 11, 9, matrix, Filter::Lanczos3).unwrap();
                for y in 0..9 {
                    for x in 0..11 {
                        let px = inverse[0] * (f64::from(x) + 0.5)
                            + inverse[2] * (f64::from(y) + 0.5)
                            + inverse[4]
                            - 0.5;
                        let py = inverse[1] * (f64::from(x) + 0.5)
                            + inverse[3] * (f64::from(y) + 0.5)
                            + inverse[5]
                            - 0.5;
                        for channel in 0..channels {
                            let expected = if px <= -3.0 * sx
                                || py <= -3.0 * sy
                                || px >= 6.0 + 3.0 * sx
                                || py >= 4.0 + 3.0 * sy
                            {
                                0.0
                            } else {
                                super::lanczos3(&input, 7, 5, channels, px, py, sx, sy, channel)
                            };
                            let actual = output[super::pixel_index(11, channels, x, y, channel)];
                            assert_eq!(
                                actual.to_bits(),
                                expected.to_bits(),
                                "matrix={matrix:?}, pixel=({x},{y}), channel={channel}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn affine_integer_sampling_preserves_quarter_turn_coordinates() {
        let input = [10_u16, 20, 30, 40, 50, 60];
        assert_eq!(
            sample_integer_affine(&input, 3, 2, 1, 2, 3, [0.0, -1.0, 1.0, 0.0, 0.0, 2.0]).unwrap(),
            [40, 10, 50, 20, 60, 30]
        );
        assert_eq!(input, [10, 20, 30, 40, 50, 60]);
    }

    #[test]
    fn affine_integer_sampling_interpolates_inside_and_zero_pads_unseen_context() {
        let input = [10_u16, 20, 30];
        assert_eq!(
            sample_integer_affine(&input, 3, 1, 1, 3, 1, [1.0, 0.0, 0.0, 1.0, 0.5, 0.0]).unwrap(),
            [15, 25, 0]
        );
        assert_eq!(
            sample_integer_affine(&input, 3, 1, 1, 5, 1, [1.0, 0.0, 0.0, 1.0, -1.0, 0.0]).unwrap(),
            [0, 10, 20, 30, 0]
        );
    }

    #[test]
    fn antialiased_rgb8_matches_integer_reference_downsampling() {
        // PIL RGB bilinear: separable, antialiased, with byte rounding after each axis.
        let input = [
            0, 12, 250, 255, 31, 0, 17, 88, 42, 194, 0, 157, 66, 245, 101, 92, 7, 39, 4, 220, 150,
            255, 19, 85, 0, 170, 221, 135, 42, 9, 255, 255, 1, 13, 97, 200, 62, 5, 179, 218, 134,
            0, 8, 233, 77,
        ];
        assert_eq!(
            super::resize_rgb8_antialiased(&input, 5, 3, 3, 2).unwrap(),
            [
                88, 49, 122, 122, 71, 85, 105, 124, 116, 115, 154, 86, 107, 70, 139, 90, 156, 65
            ],
        );
    }

    #[test]
    fn bilinear_resizes_an_asymmetric_grid_at_pixel_centers() {
        let input = [0.0, 10.0, 40.0, 80.0, 100.0, 160.0];

        assert_eq!(
            resize(&input, 3, 2, 1, 2, 1, Filter::Bilinear).unwrap(),
            vec![43.75, 88.75]
        );
    }

    #[test]
    fn integer_region_resample_maps_centers_inside_the_selected_crop() {
        let input = [0_u16, 10, 20, 30, 100, 110, 120, 130];

        assert_eq!(
            resize_integer_region_bilinear(&input, 4, 2, 1, 1, 0, 2, 2, 1, 1).unwrap(),
            vec![65]
        );
    }

    #[test]
    fn lanczos3_downsamples_an_asymmetric_row_with_scaled_support() {
        let output = resize(&[0.0, 10.0, 40.0, 100.0], 4, 1, 1, 3, 1, Filter::Lanczos3).unwrap();

        for (actual, expected) in output.iter().zip([0.536_345_54, 21.241_13, 88.545_19]) {
            assert!((actual - expected).abs() < 1e-4, "{actual} != {expected}");
        }
    }

    #[test]
    fn lanczos3_transform_scales_its_support_when_reducing() {
        let output = transform(
            &[0.0, 10.0, 40.0, 100.0],
            4,
            1,
            1,
            2,
            1,
            [0.5, 0.0, 0.0, 1.0, 0.0, 0.0],
            Filter::Lanczos3,
        )
        .unwrap();

        for (actual, expected) in output.iter().zip([3.220_333_6, 63.849_007]) {
            assert!((actual - expected).abs() < 1e-4, "{actual} != {expected}");
        }
    }

    #[test]
    fn lanczos3_transform_rejects_an_unbounded_kernel() {
        let error = transform(
            &[1.0],
            1,
            1,
            1,
            1,
            1,
            [0.01, 0.0, 0.0, 0.01, 0.0, 0.0],
            Filter::Lanczos3,
        )
        .unwrap_err();

        assert_eq!(
            error,
            "Lanczos3 transform kernel exceeds the safe work limit"
        );
    }

    #[test]
    fn fractional_translation_filters_the_part_of_an_edge_footprint_still_in_bounds() {
        for filter in [Filter::Bilinear, Filter::Lanczos3] {
            let output = transform(
                &[1.0],
                1,
                1,
                1,
                1,
                1,
                [1.0, 0.0, 0.0, 1.0, 0.001, 0.0],
                filter,
            )
            .unwrap();

            assert!(
                output[0] > 0.9,
                "{filter:?} discarded an overlapping edge footprint"
            );
        }
    }

    #[test]
    fn extreme_reduction_aggregates_clamped_edge_contributors() {
        let contributors = lanczos_contributors(8_000, 1);

        assert_eq!(contributors[0].len(), 8_000);
        assert!(
            (contributors[0]
                .iter()
                .map(|(_, weight)| weight)
                .sum::<f64>()
                - 1.0)
                .abs()
                < 1e-12
        );
    }

    #[test]
    fn horizontal_flip_moves_samples_exactly_without_filtering() {
        let input = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];

        assert_eq!(
            transform(
                &input,
                3,
                2,
                1,
                3,
                2,
                [-1.0, 0.0, 0.0, 1.0, 3.0, 0.0],
                Filter::Lanczos3,
            )
            .unwrap(),
            vec![3.0, 2.0, 1.0, 6.0, 5.0, 4.0]
        );
    }

    #[test]
    fn four_quarter_turns_restore_every_sample() {
        let original = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let mut pixels = original.clone();
        let (mut width, mut height) = (3, 2);
        for _ in 0..4 {
            pixels = transform(
                &pixels,
                width,
                height,
                1,
                height,
                width,
                [0.0, 1.0, -1.0, 0.0, f64::from(height), 0.0],
                Filter::Lanczos3,
            )
            .unwrap();
            (width, height) = (height, width);
        }

        assert_eq!(pixels, original);
        assert_eq!((width, height), (3, 2));
    }

    #[test]
    fn anchored_scale_maps_destination_and_source_pixel_centers() {
        assert_eq!(
            transform(
                &[1.0],
                1,
                1,
                1,
                1,
                1,
                [2.0, 0.0, 0.0, 2.0, -0.5, -0.5],
                Filter::Bilinear,
            )
            .unwrap(),
            vec![1.0]
        );
    }

    #[test]
    fn tiny_positive_scale_remains_an_invertible_bilinear_transform() {
        let scale = 1e-9;

        assert_eq!(
            transform(
                &[1.0],
                1,
                1,
                1,
                1,
                1,
                [
                    scale,
                    0.0,
                    0.0,
                    scale,
                    (1.0 - scale) * 0.5,
                    (1.0 - scale) * 0.5,
                ],
                Filter::Bilinear,
            )
            .unwrap(),
            vec![1.0]
        );
    }

    #[test]
    fn integer_shear_still_filters_between_pixel_centers() {
        let output = transform(
            &[1.0, 2.0, 3.0, 4.0],
            2,
            2,
            1,
            3,
            2,
            [1.0, 0.0, 1.0, 1.0, 0.0, 0.0],
            Filter::Bilinear,
        )
        .unwrap();

        assert_eq!(output[1], 1.5);
    }

    #[test]
    fn transform_rejects_a_determinant_or_inverse_that_overflows() {
        for matrix in [
            [1e308, 1e308, 1e308, 1e308, 0.0, 0.0],
            [1e308, 0.0, 0.0, 1e308, 0.0, 0.0],
        ] {
            assert_eq!(
                transform(&[1.0], 1, 1, 1, 1, 1, matrix, Filter::Bilinear).unwrap_err(),
                "transform matrix must have a finite inverse"
            );
        }
    }
}
