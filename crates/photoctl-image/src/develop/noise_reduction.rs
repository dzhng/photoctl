use std::collections::VecDeque;

use super::{REC2020_TO_XYZ, SampleStorage, rec2020_luminance};

const PATCH_RADIUS: usize = 1;
const SEARCH_RADIUS: usize = 2;
const LUMINANCE_H_AT_FULL_SCALE: f32 = 0.012;
const COLOR_H_AT_FULL_SCALE: f32 = 0.01;

#[derive(Clone, Copy)]
pub(super) enum Component {
    Luminance,
    Color,
}

pub(super) fn apply<S: SampleStorage + ?Sized>(
    data: &mut S,
    width: usize,
    height: usize,
    component: Component,
    amount: f32,
) {
    let h = amount
        * match component {
            Component::Luminance => LUMINANCE_H_AT_FULL_SCALE,
            Component::Color => COLOR_H_AT_FULL_SCALE,
        };
    let h_squared = (h * h).max(f32::MIN_POSITIVE);
    let delay = SEARCH_RADIUS + PATCH_RADIUS;
    let mut pending = VecDeque::with_capacity(delay.min(height) + 1);
    let mut next_write = 0;

    for y in 0..height {
        let mut row = Vec::with_capacity(width * 3);
        for x in 0..width {
            let source = read_pixel(data, width, x, y);
            let mut weighted = [0.0_f64; 3];
            let mut weight_sum = 0.0_f64;
            let min_y = y.saturating_sub(SEARCH_RADIUS);
            let max_y = y.saturating_add(SEARCH_RADIUS).min(height - 1);
            let min_x = x.saturating_sub(SEARCH_RADIUS);
            let max_x = x.saturating_add(SEARCH_RADIUS).min(width - 1);
            for candidate_y in min_y..=max_y {
                for candidate_x in min_x..=max_x {
                    let distance = patch_distance(
                        data,
                        width,
                        height,
                        x,
                        y,
                        candidate_x,
                        candidate_y,
                        component,
                    );
                    let weight = f64::from((-distance / h_squared).exp());
                    let candidate = components(read_pixel(data, width, candidate_x, candidate_y));
                    for channel in 0..3 {
                        weighted[channel] += weight * f64::from(candidate[channel]);
                    }
                    weight_sum += weight;
                }
            }
            let average = weighted.map(|sample| (sample / weight_sum) as f32);
            let denoised = match component {
                Component::Luminance => {
                    let delta = average[0] - rec2020_luminance(source);
                    source.map(|sample| sample + delta)
                }
                Component::Color => reconstruct_chroma(source, average),
            };
            row.extend(
                source
                    .into_iter()
                    .zip(denoised)
                    .map(|(before, after)| before + amount * (after - before)),
            );
        }
        pending.push_back(row);
        if pending.len() > delay {
            write_row(data, width, next_write, pending.pop_front().unwrap());
            next_write += 1;
        }
    }
    for row in pending {
        write_row(data, width, next_write, row);
        next_write += 1;
    }
}

fn patch_distance<S: SampleStorage + ?Sized>(
    data: &S,
    width: usize,
    height: usize,
    source_x: usize,
    source_y: usize,
    candidate_x: usize,
    candidate_y: usize,
    component: Component,
) -> f32 {
    let mut distance = 0.0_f64;
    let mut samples = 0;
    for patch_y in -(PATCH_RADIUS as isize)..=PATCH_RADIUS as isize {
        for patch_x in -(PATCH_RADIUS as isize)..=PATCH_RADIUS as isize {
            let source = components(read_pixel(
                data,
                width,
                offset_clamped(source_x, patch_x, width),
                offset_clamped(source_y, patch_y, height),
            ));
            let candidate = components(read_pixel(
                data,
                width,
                offset_clamped(candidate_x, patch_x, width),
                offset_clamped(candidate_y, patch_y, height),
            ));
            match component {
                Component::Luminance => {
                    distance += f64::from((source[0] - candidate[0]).powi(2));
                    samples += 1;
                }
                Component::Color => {
                    distance += f64::from(
                        (source[1] - candidate[1]).powi(2) + (source[2] - candidate[2]).powi(2),
                    );
                    samples += 2;
                }
            }
        }
    }
    (distance / f64::from(samples)) as f32
}

fn components(pixel: [f32; 3]) -> [f32; 3] {
    let luminance = rec2020_luminance(pixel);
    [luminance, pixel[0] - luminance, pixel[2] - luminance]
}

fn reconstruct_chroma(source: [f32; 3], average: [f32; 3]) -> [f32; 3] {
    let luminance = rec2020_luminance(source);
    let red = luminance + average[1];
    let blue = luminance + average[2];
    let weights = REC2020_TO_XYZ[1].map(|weight| weight as f32);
    let green = (luminance - weights[0] * red - weights[2] * blue) / weights[1];
    [red, green, blue]
}

fn read_pixel<S: SampleStorage + ?Sized>(data: &S, width: usize, x: usize, y: usize) -> [f32; 3] {
    let pixel = (y * width + x) * 3;
    [
        data.read_sample(pixel),
        data.read_sample(pixel + 1),
        data.read_sample(pixel + 2),
    ]
}

fn write_row<S: SampleStorage + ?Sized>(data: &mut S, width: usize, y: usize, row: Vec<f32>) {
    let offset = y * width * 3;
    for (index, sample) in row.into_iter().enumerate() {
        data.write_sample(offset + index, sample);
    }
}

fn offset_clamped(coordinate: usize, offset: isize, length: usize) -> usize {
    coordinate.saturating_add_signed(offset).min(length - 1)
}
