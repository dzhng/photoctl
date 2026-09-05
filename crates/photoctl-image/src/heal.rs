use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[derive(Clone, Copy)]
struct Front {
    distance: u32,
    index: usize,
}

impl Eq for Front {}
impl PartialEq for Front {
    fn eq(&self, other: &Self) -> bool {
        self.distance == other.distance && self.index == other.index
    }
}
impl Ord for Front {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .distance
            .cmp(&self.distance)
            .then_with(|| other.index.cmp(&self.index))
    }
}
impl PartialOrd for Front {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Project-owned fast-marching fill with local gradient extrapolation and bounded
/// harmonic refinement.
pub fn heal_pixels(
    mut pixels: Vec<f32>,
    mask: &[f32],
    width: usize,
    height: usize,
    neighborhood_radius: usize,
    refinement_iterations: usize,
    refinement_pixel_budget: usize,
) -> Result<Vec<f32>, String> {
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| "heal dimensions overflow".to_owned())?;
    let channel_count = pixel_count
        .checked_mul(3)
        .ok_or_else(|| "heal dimensions overflow".to_owned())?;
    if width == 0 || height == 0 || pixels.len() != channel_count || mask.len() != pixel_count {
        return Err("heal dimensions do not match the pixel buffers".to_owned());
    }
    if !pixels.iter().all(|value| value.is_finite()) {
        return Err("heal pixels must be finite".to_owned());
    }
    if !mask
        .iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
    {
        return Err("heal mask must contain finite coverage in [0,1]".to_owned());
    }
    if !(1..=16).contains(&neighborhood_radius) {
        return Err("heal neighborhood radius must be between 1 and 16".to_owned());
    }
    if !(1..=4096).contains(&refinement_iterations) {
        return Err("heal refinement iterations must be between 1 and 4096".to_owned());
    }
    if !(1..=100_000_000).contains(&refinement_pixel_budget) {
        return Err("heal refinement pixel budget must be between 1 and 100000000".to_owned());
    }
    let mut known = mask.iter().map(|value| *value <= 0.5).collect::<Vec<_>>();
    if known.iter().all(|value| *value) {
        return Err("heal mask must include pixels".to_owned());
    }
    let mut queued = vec![false; width * height];
    let mut front = BinaryHeap::new();
    for y in 0..height {
        for x in 0..width {
            let i = y * width + x;
            if !known[i] && neighbors(x, y, width, height).any(|n| known[n]) {
                front.push(Front {
                    distance: 1,
                    index: i,
                });
                queued[i] = true;
            }
        }
    }
    while let Some(point) = front.pop() {
        if known[point.index] {
            continue;
        }
        let x = point.index % width;
        let y = point.index / width;
        let mut sum = [0.0_f64; 3];
        let mut weights = [0.0_f64; 3];
        let mut minimum = [f64::INFINITY; 3];
        let mut maximum = [f64::NEG_INFINITY; 3];
        let r = neighborhood_radius as isize;
        for oy in -r..=r {
            for ox in -r..=r {
                if ox == 0 && oy == 0 {
                    continue;
                }
                let qx = x as isize + ox;
                let qy = y as isize + oy;
                if qx < 0 || qy < 0 || qx >= width as isize || qy >= height as isize {
                    continue;
                }
                let qi = qy as usize * width + qx as usize;
                if !known[qi] {
                    continue;
                }
                let d2 = (ox * ox + oy * oy) as f64;
                if d2 > (r * r) as f64 {
                    continue;
                }
                for channel in 0..3 {
                    let sample = pixels[qi * 3 + channel] as f64;
                    minimum[channel] = minimum[channel].min(sample);
                    maximum[channel] = maximum[channel].max(sample);
                    let gx = gradient(
                        &pixels,
                        &known,
                        width,
                        height,
                        qx as usize,
                        qy as usize,
                        channel,
                        true,
                    );
                    let gy = gradient(
                        &pixels,
                        &known,
                        width,
                        height,
                        qx as usize,
                        qy as usize,
                        channel,
                        false,
                    );
                    let weight = 1.0 / d2;
                    let extrapolated = sample - ox as f64 * gx - oy as f64 * gy;
                    sum[channel] += weight * extrapolated;
                    weights[channel] += weight;
                }
            }
        }
        if weights.iter().any(|weight| *weight == 0.0) {
            return Err("heal mask has no usable surrounding pixels".to_owned());
        }
        for channel in 0..3 {
            pixels[point.index * 3 + channel] =
                (sum[channel] / weights[channel]).clamp(minimum[channel], maximum[channel]) as f32;
        }
        known[point.index] = true;
        for next in neighbors(x, y, width, height) {
            if !known[next] && !queued[next] {
                queued[next] = true;
                front.push(Front {
                    distance: point.distance + 1,
                    index: next,
                });
            }
        }
    }
    if known.iter().any(|value| !value) {
        return Err("heal mask cannot reach surrounding pixels".to_owned());
    }
    refine_harmonic(
        &mut pixels,
        mask,
        width,
        height,
        refinement_iterations,
        refinement_pixel_budget,
    );
    Ok(pixels)
}

fn refine_harmonic(
    pixels: &mut Vec<f32>,
    mask: &[f32],
    width: usize,
    height: usize,
    max_iterations: usize,
    pixel_budget: usize,
) {
    let mut next = pixels.clone();
    let masked = mask
        .iter()
        .enumerate()
        .filter(|(_, value)| **value > 0.5)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let iterations = max_iterations.min(pixel_budget / masked.len());
    for _ in 0..iterations {
        let mut maximum_change = 0.0_f32;
        for index in &masked {
            let x = index % width;
            let y = index / width;
            for channel in 0..3 {
                let mut sum = 0.0;
                let mut count = 0;
                for neighbor in neighbors(x, y, width, height) {
                    sum += pixels[neighbor * 3 + channel];
                    count += 1;
                }
                let value = sum / count as f32;
                maximum_change = maximum_change.max((value - pixels[index * 3 + channel]).abs());
                next[index * 3 + channel] = value;
            }
        }
        std::mem::swap(pixels, &mut next);
        if maximum_change <= 1e-7 {
            break;
        }
    }
}

fn neighbors(x: usize, y: usize, width: usize, height: usize) -> impl Iterator<Item = usize> {
    let mut values = [None; 4];
    if x > 0 {
        values[0] = Some(y * width + x - 1);
    }
    if x + 1 < width {
        values[1] = Some(y * width + x + 1);
    }
    if y > 0 {
        values[2] = Some((y - 1) * width + x);
    }
    if y + 1 < height {
        values[3] = Some((y + 1) * width + x);
    }
    values.into_iter().flatten()
}

fn gradient(
    pixels: &[f32],
    known: &[bool],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    c: usize,
    horizontal: bool,
) -> f64 {
    let (a, b) = if horizontal {
        (
            x.checked_sub(1).map(|nx| y * width + nx),
            (x + 1 < width).then_some(y * width + x + 1),
        )
    } else {
        (
            y.checked_sub(1).map(|ny| ny * width + x),
            (y + 1 < height).then_some((y + 1) * width + x),
        )
    };
    match (a.filter(|i| known[*i]), b.filter(|i| known[*i])) {
        (Some(a), Some(b)) => (pixels[b * 3 + c] - pixels[a * 3 + c]) as f64 * 0.5,
        (Some(a), None) => (pixels[(y * width + x) * 3 + c] - pixels[a * 3 + c]) as f64,
        (None, Some(b)) => (pixels[b * 3 + c] - pixels[(y * width + x) * 3 + c]) as f64,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_marching_harmonic_fill_changes_only_the_mask_and_is_deterministic() {
        let mut input = Vec::new();
        for x in 0..7 {
            input.extend_from_slice(&[x as f32 / 6.0; 3]);
        }
        input[9..12].fill(1.0);
        let mask = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
        let first = heal_pixels(input.clone(), &mask, 7, 1, 3, 512, 8_000_000).unwrap();
        let second = heal_pixels(input.clone(), &mask, 7, 1, 3, 512, 8_000_000).unwrap();
        assert_eq!(first, second);
        assert_eq!(&first[..9], &input[..9]);
        assert_eq!(&first[12..], &input[12..]);
        assert_ne!(&first[9..12], &input[9..12]);
    }

    #[test]
    fn harmonic_refinement_reconstructs_a_linear_gradient() {
        let width = 21;
        let height = 21;
        let mut input = Vec::new();
        let mut mask = vec![0.0; width * height];
        for y in 0..height {
            for x in 0..width {
                input.extend_from_slice(&[
                    x as f32 / width as f32,
                    y as f32 / height as f32,
                    (x + y) as f32 / (width + height) as f32,
                ]);
                let dx = x as f32 + 0.5 - 10.5;
                let dy = y as f32 + 0.5 - 10.5;
                if dx * dx + dy * dy <= 36.0 {
                    mask[y * width + x] = 1.0;
                }
            }
        }
        let expected = input.clone();
        for (pixel, masked) in mask.iter().enumerate() {
            if *masked > 0.5 {
                input[pixel * 3..pixel * 3 + 3].fill(1.0);
            }
        }
        let output = heal_pixels(input.clone(), &mask, width, height, 3, 512, 8_000_000).unwrap();
        for pixel in 0..mask.len() {
            for channel in 0..3 {
                let index = pixel * 3 + channel;
                if mask[pixel] <= 0.5 {
                    assert_eq!(output[index], input[index]);
                } else {
                    assert!((output[index] - expected[index]).abs() < 1e-4);
                }
            }
        }
    }

    #[test]
    fn rejects_invalid_public_inputs() {
        assert!(heal_pixels(vec![0.0; 3], &[f32::NAN], 1, 1, 3, 512, 8_000_000).is_err());
        assert!(heal_pixels(vec![0.0; 3], &[1.0], 1, 1, 17, 512, 8_000_000).is_err());
        assert!(heal_pixels(vec![0.0; 3], &[1.0], 1, 1, 3, 5000, 8_000_000).is_err());
        assert!(heal_pixels(vec![0.0; 3], &[0.0], 1, 1, 3, 512, 8_000_000).is_err());
    }
}
