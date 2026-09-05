use napi::{
    Error, Status, Task,
    bindgen_prelude::{AsyncTask, Float32Array},
};
use napi_derive::napi;
use std::collections::VecDeque;

use crate::resample::{Filter, transform};

#[napi]
pub fn morphology_mask(
    data: Float32Array,
    width: u32,
    height: u32,
    radius: u32,
    operation: String,
) -> napi::Result<AsyncTask<MaskTask>> {
    if radius > 4096 {
        return Err(invalid("mask morphology radius must be at most 4096"));
    }
    let operation = match operation.as_str() {
        "dilate" => MaskOperation::Morphology {
            radius,
            dilate: true,
        },
        "erode" => MaskOperation::Morphology {
            radius,
            dilate: false,
        },
        _ => return Err(invalid("mask morphology must be dilate or erode")),
    };
    validate_mask(&data, width, height)?;
    Ok(AsyncTask::new(MaskTask {
        data: data.to_vec(),
        width,
        height,
        operation,
    }))
}

#[napi]
pub fn feather_mask(
    data: Float32Array,
    width: u32,
    height: u32,
    radius: f64,
) -> napi::Result<AsyncTask<MaskTask>> {
    validate_mask(&data, width, height)?;
    if !radius.is_finite() || radius < 0.0 || radius > 4096.0 {
        return Err(invalid(
            "mask feather radius must be finite and between 0 and 4096",
        ));
    }
    Ok(AsyncTask::new(MaskTask {
        data: data.to_vec(),
        width,
        height,
        operation: MaskOperation::Feather { radius },
    }))
}

#[napi]
#[allow(clippy::too_many_arguments)]
pub fn transform_mask_pixels(
    data: Float32Array,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
    matrix: Vec<f64>,
) -> napi::Result<AsyncTask<MaskTask>> {
    validate_mask(&data, width, height)?;
    let matrix = matrix
        .try_into()
        .map_err(|_| invalid("transform matrix must contain six values"))?;
    Ok(AsyncTask::new(MaskTask {
        data: data.to_vec(),
        width,
        height,
        operation: MaskOperation::Transform {
            output_width,
            output_height,
            matrix,
        },
    }))
}

#[napi]
pub fn lift_masked_pixels(
    content: Float32Array,
    mask: Float32Array,
    width: u32,
    height: u32,
) -> napi::Result<AsyncTask<CompositeTask>> {
    validate_rgb_and_mask(&content, &mask, width, height)?;
    Ok(AsyncTask::new(CompositeTask {
        base: vec![0.0; content.len()],
        content: content.to_vec(),
        mask: mask.to_vec(),
        opacity: 1.0,
        lift: true,
    }))
}

#[napi]
pub fn overlay_masked_pixels(
    base: Float32Array,
    content: Float32Array,
    mask: Float32Array,
    width: u32,
    height: u32,
    opacity: f64,
) -> napi::Result<AsyncTask<CompositeTask>> {
    composite_task(base, content, mask, width, height, opacity)
}

#[napi]
pub fn composite_masked_pixels(
    base: Float32Array,
    content: Float32Array,
    mask: Float32Array,
    width: u32,
    height: u32,
    opacity: f64,
) -> napi::Result<AsyncTask<CompositeTask>> {
    composite_task(base, content, mask, width, height, opacity)
}

fn composite_task(
    base: Float32Array,
    content: Float32Array,
    mask: Float32Array,
    width: u32,
    height: u32,
    opacity: f64,
) -> napi::Result<AsyncTask<CompositeTask>> {
    validate_rgb_and_mask(&base, &mask, width, height)?;
    validate_rgb_and_mask(&content, &mask, width, height)?;
    if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
        return Err(invalid("mask composite opacity must be between 0 and 1"));
    }
    Ok(AsyncTask::new(CompositeTask {
        base: base.to_vec(),
        content: content.to_vec(),
        mask: mask.to_vec(),
        opacity,
        lift: false,
    }))
}

pub struct MaskTask {
    data: Vec<f32>,
    width: u32,
    height: u32,
    operation: MaskOperation,
}

enum MaskOperation {
    Morphology {
        radius: u32,
        dilate: bool,
    },
    Feather {
        radius: f64,
    },
    Transform {
        output_width: u32,
        output_height: u32,
        matrix: [f64; 6],
    },
}

impl Task for MaskTask {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        match self.operation {
            MaskOperation::Morphology { radius, dilate } => Ok(morphology(
                &self.data,
                self.width,
                self.height,
                radius,
                dilate,
            )),
            MaskOperation::Feather { radius } => {
                Ok(feather(&self.data, self.width, self.height, radius))
            }
            MaskOperation::Transform {
                output_width,
                output_height,
                matrix,
            } => {
                let mut output = transform(
                    &self.data,
                    self.width,
                    self.height,
                    1,
                    output_width,
                    output_height,
                    matrix,
                    Filter::Lanczos3,
                )
                .map_err(|message| Error::new(Status::InvalidArg, message))?;
                output
                    .iter_mut()
                    .for_each(|sample| *sample = sample.clamp(0.0, 1.0));
                Ok(output)
            }
        }
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }
}

pub struct CompositeTask {
    base: Vec<f32>,
    content: Vec<f32>,
    mask: Vec<f32>,
    opacity: f64,
    lift: bool,
}

impl Task for CompositeTask {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        if self.lift {
            return Ok(lift(&self.content, &self.mask));
        }
        Ok(composite(
            &self.base,
            &self.content,
            &self.mask,
            self.opacity,
        ))
    }

    fn resolve(&mut self, _env: napi::Env, data: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(data.into())
    }
}

fn validate_mask(data: &[f32], width: u32, height: u32) -> napi::Result<()> {
    let expected = usize::try_from(u64::from(width) * u64::from(height))
        .map_err(|_| invalid("mask dimensions overflow"))?;
    if width == 0 || height == 0 || data.len() != expected {
        return Err(invalid("mask data does not match its dimensions"));
    }
    if data
        .iter()
        .any(|sample| !sample.is_finite() || !(0.0..=1.0).contains(sample))
    {
        return Err(invalid("mask coverage must be finite and between 0 and 1"));
    }
    Ok(())
}

fn validate_rgb_and_mask(rgb: &[f32], mask: &[f32], width: u32, height: u32) -> napi::Result<()> {
    validate_mask(mask, width, height)?;
    if rgb.len() != mask.len() * 3 || rgb.iter().any(|sample| !sample.is_finite()) {
        return Err(invalid("RGB data does not match the mask dimensions"));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn morphology(input: &[f32], width: u32, height: u32, radius: u32, dilate: bool) -> Vec<f32> {
    if radius == 0 {
        return input.to_vec();
    }
    let mut horizontal = vec![0.0; input.len()];
    for y in 0..height as usize {
        filter_extreme_line(
            &input[y * width as usize..(y + 1) * width as usize],
            &mut horizontal[y * width as usize..(y + 1) * width as usize],
            radius as usize,
            dilate,
        );
    }
    let mut column = vec![0.0; height as usize];
    let mut filtered = vec![0.0; height as usize];
    let mut output = vec![0.0; input.len()];
    for x in 0..width as usize {
        for y in 0..height as usize {
            column[y] = horizontal[y * width as usize + x];
        }
        filter_extreme_line(&column, &mut filtered, radius as usize, dilate);
        for y in 0..height as usize {
            output[y * width as usize + x] = filtered[y];
        }
    }
    output
}

fn feather(input: &[f32], width: u32, height: u32, radius: f64) -> Vec<f32> {
    if radius == 0.0 {
        return input.to_vec();
    }
    let box_radius = (radius / 3.0_f64.sqrt()).ceil().max(1.0) as usize;
    let mut output = input.to_vec();
    for _ in 0..3 {
        output = box_blur(&output, width as usize, height as usize, box_radius);
    }
    output
}

fn filter_extreme_line(input: &[f32], output: &mut [f32], radius: usize, maximum: bool) {
    let radius = radius as i64;
    let mut queue: VecDeque<(i64, f32)> = VecDeque::new();
    for right in -radius..input.len() as i64 + radius {
        let value = if (0..input.len() as i64).contains(&right) {
            input[right as usize]
        } else {
            0.0
        };
        while queue.back().is_some_and(|(_, back)| {
            if maximum {
                *back <= value
            } else {
                *back >= value
            }
        }) {
            queue.pop_back();
        }
        queue.push_back((right, value));
        let left = right - radius * 2;
        while queue.front().is_some_and(|(index, _)| *index < left) {
            queue.pop_front();
        }
        if right >= radius {
            output[(right - radius) as usize] = queue.front().expect("window is nonempty").1;
        }
    }
}

fn box_blur(input: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    let divisor = (radius * 2 + 1) as f64;
    let mut horizontal = vec![0.0; input.len()];
    for y in 0..height {
        let row = &input[y * width..(y + 1) * width];
        let mut sum = 0.0_f64;
        for x in 0..width + radius {
            if x < width {
                sum += f64::from(row[x]);
            }
            if x > radius * 2 {
                sum -= f64::from(row[x - radius * 2 - 1]);
            }
            if x >= radius {
                horizontal[y * width + x - radius] = (sum / divisor) as f32;
            }
        }
    }
    let mut output = vec![0.0; input.len()];
    for x in 0..width {
        let mut sum = 0.0_f64;
        for y in 0..height + radius {
            if y < height {
                sum += f64::from(horizontal[y * width + x]);
            }
            if y > radius * 2 {
                sum -= f64::from(horizontal[(y - radius * 2 - 1) * width + x]);
            }
            if y >= radius {
                output[(y - radius) * width + x] = (sum / divisor) as f32;
            }
        }
    }
    output
}

fn lift(content: &[f32], mask: &[f32]) -> Vec<f32> {
    let mut output = vec![0.0; content.len()];
    for (pixel, coverage) in mask.iter().copied().enumerate() {
        if coverage == 0.0 {
            continue;
        }
        output[pixel * 3..pixel * 3 + 3].copy_from_slice(&content[pixel * 3..pixel * 3 + 3]);
    }
    output
}

fn composite(base: &[f32], content: &[f32], mask: &[f32], opacity: f64) -> Vec<f32> {
    let mut output = base.to_vec();
    for (pixel, coverage) in mask.iter().copied().enumerate() {
        let alpha = f64::from(coverage) * opacity;
        if alpha == 0.0 {
            continue;
        }
        for channel in 0..3 {
            let index = pixel * 3 + channel;
            output[index] = (f64::from(base[index])
                + (f64::from(content[index]) - f64::from(base[index])) * alpha)
                as f32;
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asymmetric_morphology_uses_a_square_zero_outside_footprint() {
        let input = vec![0.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        assert_eq!(morphology(&input, 3, 2, 1, true), vec![1.0; 6]);
        assert_eq!(morphology(&vec![1.0; 6], 3, 2, 1, false), vec![0.0; 6]);
    }

    #[test]
    fn composite_preserves_every_zero_coverage_sample_bit_exactly() {
        let base = vec![-0.25, 0.5, 2.0, 10.0, 20.0, 30.0];
        let content = vec![1.0, 1.0, 1.0, 30.0, 40.0, 50.0];
        let output = composite(&base, &content, &[0.0, 0.5], 0.5);
        assert_eq!(&output[..3], &base[..3]);
        assert_eq!(&output[3..], &[15.0, 25.0, 35.0]);
    }

    #[test]
    fn lift_zeros_the_exterior_and_preserves_selected_rgb_values() {
        let content = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        assert_eq!(
            lift(&content, &[0.0, 0.25]),
            vec![0.0, 0.0, 0.0, 4.0, 5.0, 6.0]
        );
    }
}
