use napi::{
    Error, Status, Task,
    bindgen_prelude::{AsyncTask, Float32Array, Uint8Array, Uint16Array},
};
use napi_derive::napi;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Filter {
    Bilinear,
    Lanczos3,
}

const MAX_LANCZOS_TRANSFORM_SAMPLES_PER_PIXEL: f64 = 4_096.0;

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
) -> napi::Result<Uint16Array> {
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

#[napi]
pub fn resample_pixels(
    data: Float32Array,
    source_width: u32,
    source_height: u32,
    channels: u32,
    output_width: u32,
    output_height: u32,
    filter: String,
) -> napi::Result<AsyncTask<ResampleF32Task>> {
    Ok(AsyncTask::new(ResampleF32Task {
        data: data.to_vec(),
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
    Ok(AsyncTask::new(TransformF32Task {
        data: data.to_vec(),
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
}

pub struct TransformF32Task {
    data: Vec<f32>,
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
    let mut output = vec![0.0; output_len];
    for output_y in 0..output_height {
        for output_x in 0..output_width {
            let output_center_x = f64::from(output_x) + 0.5;
            let output_center_y = f64::from(output_y) + 0.5;
            let source_x =
                inverse[0] * output_center_x + inverse[2] * output_center_y + inverse[4] - 0.5;
            let source_y =
                inverse[1] * output_center_x + inverse[3] * output_center_y + inverse[5] - 0.5;
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
                } else {
                    filtered_transform_sample(
                        input,
                        source_width,
                        source_height,
                        channels,
                        source_x,
                        source_y,
                        channel,
                        filter,
                        filter_support.0,
                        filter_support.1,
                    )
                };
                output[pixel_index(output_width, channels, output_x, output_y, channel)] = value;
            }
        }
    }
    Ok(output)
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

#[allow(clippy::too_many_arguments)]
fn filtered_transform_sample(
    input: &[f32],
    width: u32,
    height: u32,
    channels: u32,
    x: f64,
    y: f64,
    channel: u32,
    filter: Filter,
    x_support: f64,
    y_support: f64,
) -> f32 {
    match filter {
        Filter::Bilinear => {
            if x <= -1.0 || y <= -1.0 || x >= f64::from(width) || y >= f64::from(height) {
                0.0
            } else {
                bilinear_transparent(input, width, height, channels, x, y, channel)
            }
        }
        Filter::Lanczos3 => {
            if x <= -3.0 * x_support
                || y <= -3.0 * y_support
                || x >= f64::from(width - 1) + 3.0 * x_support
                || y >= f64::from(height - 1) + 3.0 * y_support
            {
                0.0
            } else {
                lanczos3(
                    input, width, height, channels, x, y, x_support, y_support, channel,
                )
            }
        }
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
    use super::{Filter, lanczos_contributors, resize, resize_integer_region_bilinear, transform};

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
