use crate::task_memory::TaskMemory;
use napi::{
    Env, Error, Status, Task,
    bindgen_prelude::{AsyncTask, Float32Array},
};
use napi_derive::napi;

// A bounded geometric detector, not a semantic sky/ground classifier. Sobel
// points vote in angle/distance space; separated competitive peaks abstain.
const MAX_EDGE: usize = 512;
const MAX_POINTS: usize = 8192;
const ANGLE_STEP: f64 = 0.25;

#[napi]
pub fn detect_horizon(
    env: Env,
    data: Float32Array,
    width: u32,
    height: u32,
    analysis_to_view: Vec<f64>,
    current_degrees: f64,
) -> napi::Result<AsyncTask<HorizonTask>> {
    let matrix: [f64; 4] = analysis_to_view
        .try_into()
        .map_err(|_| invalid("Horizon direction mapping requires four values"))?;
    if width == 0
        || height == 0
        || width as usize > MAX_EDGE
        || height as usize > MAX_EDGE
        || data.len() != width as usize * height as usize * 3
        || data.iter().any(|v| !v.is_finite())
        || matrix.iter().any(|v| !v.is_finite())
        || (matrix[0] * matrix[3] - matrix[1] * matrix[2]).abs() < 1e-12
        || !(-45.0..=45.0).contains(&current_degrees)
    {
        return Err(invalid(
            "Invalid bounded horizon image or direction mapping",
        ));
    }
    let data = data.to_vec();
    let memory = TaskMemory::for_vec(env, &data)?;
    Ok(AsyncTask::new(HorizonTask {
        data,
        width: width as usize,
        height: height as usize,
        matrix,
        current_degrees,
        memory,
    }))
}

pub struct HorizonTask {
    data: Vec<f32>,
    width: usize,
    height: usize,
    matrix: [f64; 4],
    current_degrees: f64,
    memory: TaskMemory,
}

impl Task for HorizonTask {
    type Output = Option<f64>;
    type JsValue = Option<f64>;
    fn compute(&mut self) -> napi::Result<Self::Output> {
        Ok(horizon(
            &self.data,
            self.width,
            self.height,
            self.matrix,
            self.current_degrees,
        ))
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        self.memory.release()?;
        Ok(output)
    }
}

fn invalid(message: &str) -> Error {
    Error::new(Status::InvalidArg, message)
}

#[derive(Clone, Copy)]
struct Edge {
    x: f64,
    y: f64,
    strength: f64,
}

fn horizon(
    rgb: &[f32],
    width: usize,
    height: usize,
    matrix: [f64; 4],
    current: f64,
) -> Option<f64> {
    if width < 16 || height < 16 {
        return None;
    }
    let gray: Vec<f64> = rgb
        .chunks_exact(3)
        .map(|c| 0.2126 * f64::from(c[0]) + 0.7152 * f64::from(c[1]) + 0.0722 * f64::from(c[2]))
        .collect();
    let mut edges = Vec::new();
    let mut strongest = 0.0_f64;
    // Excluding the raster border prevents the image rectangle from voting.
    for y in 2..height - 2 {
        for x in 2..width - 2 {
            let p = y * width + x;
            let gx = gray[p - width + 1] + 2.0 * gray[p + 1] + gray[p + width + 1]
                - gray[p - width - 1]
                - 2.0 * gray[p - 1]
                - gray[p + width - 1];
            let gy = gray[p + width - 1] + 2.0 * gray[p + width] + gray[p + width + 1]
                - gray[p - width - 1]
                - 2.0 * gray[p - width]
                - gray[p - width + 1];
            let strength = gx.hypot(gy);
            strongest = strongest.max(strength);
            edges.push(Edge {
                x: x as f64,
                y: y as f64,
                strength,
            });
        }
    }
    if strongest < 0.04 {
        return None;
    }
    edges.retain(|e| e.strength >= (strongest * 0.15).max(0.04));
    // Deterministic spatial thinning keeps textured frames bounded without
    // selecting only a small high-contrast subject and discarding the horizon.
    let stride = edges.len().div_ceil(MAX_POINTS).max(1);
    let points: Vec<Edge> = edges.into_iter().step_by(stride).collect();
    if points.len() < 16 {
        return None;
    }
    let diagonal = (width as f64).hypot(height as f64);
    let bins = (diagonal * 2.0).ceil() as usize + 3;
    let mut peaks = Vec::new();
    for step in 0..=360 {
        let degrees = current - 45.0 + f64::from(step) * ANGLE_STEP;
        let angle = degrees.to_radians();
        // Inverse-map a view-space direction into the actual analysis raster.
        let dx = matrix[3] * angle.cos() - matrix[2] * angle.sin();
        let dy = -matrix[1] * angle.cos() + matrix[0] * angle.sin();
        let length = dx.hypot(dy);
        let nx = -dy / length;
        let ny = dx / length;
        let mut votes = vec![0_u32; bins];
        for point in &points {
            let bin = (point.x * nx + point.y * ny + diagonal).round() as usize;
            votes[bin] += 1;
        }
        let (bin, count) = (1..bins - 1)
            .map(|i| (i, votes[i - 1] + votes[i] + votes[i + 1]))
            .max_by_key(|&(i, count)| (count, std::cmp::Reverse(i)))?;
        peaks.push((degrees, count, bin as f64 - diagonal, nx, ny));
    }
    let best = *peaks
        .iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.abs().total_cmp(&a.0.abs())))?;
    let competitor = peaks
        .iter()
        .filter(|p| (p.0 - best.0).abs() > 3.0)
        .map(|p| p.1)
        .max()
        .unwrap_or(0);
    if f64::from(competitor) > f64::from(best.1) * 0.85 {
        return None;
    }
    let support: Vec<Edge> = points
        .iter()
        .copied()
        .filter(|p| (p.x * best.3 + p.y * best.4 - best.2).abs() <= 1.5)
        .collect();
    let n = support.len() as f64;
    if n < 16.0 || n * (stride as f64) < (width.min(height) as f64) * 0.35 {
        return None;
    }
    let min = support
        .iter()
        .map(|p| p.x * best.4 - p.y * best.3)
        .fold(f64::INFINITY, f64::min);
    let max = support
        .iter()
        .map(|p| p.x * best.4 - p.y * best.3)
        .fold(f64::NEG_INFINITY, f64::max);
    let available = ((width as f64) / best.4.abs()).min((height as f64) / best.3.abs());
    if max - min < available * 0.55 {
        return None;
    }
    // Orthogonal least-squares refinement avoids tying output to the Hough
    // angle grid; contrast inversion leaves the fitted point set unchanged.
    let mx = support.iter().map(|p| p.x).sum::<f64>() / n;
    let my = support.iter().map(|p| p.y).sum::<f64>() / n;
    let xx = support.iter().map(|p| (p.x - mx).powi(2)).sum::<f64>();
    let yy = support.iter().map(|p| (p.y - my).powi(2)).sum::<f64>();
    let xy = support.iter().map(|p| (p.x - mx) * (p.y - my)).sum::<f64>();
    let theta = 0.5 * (2.0 * xy).atan2(xx - yy);
    let dx = matrix[0] * theta.cos() + matrix[2] * theta.sin();
    let dy = matrix[1] * theta.cos() + matrix[3] * theta.sin();
    let mut degrees = dy.atan2(dx).to_degrees();
    while degrees - best.0 > 90.0 {
        degrees -= 180.0;
    }
    while degrees - best.0 < -90.0 {
        degrees += 180.0;
    }
    let correction = -degrees;
    if !(-45.0 - 0.15..=45.0 + 0.15).contains(&(current + correction)) {
        return None;
    }
    // A sub-quarter-degree deadband prevents raster stair steps from creating
    // endless revisions when the same already-level image is analyzed again.
    Some(if correction.abs() < 0.25 {
        0.0
    } else {
        correction
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(width: usize, height: usize, angle: f64, level: f64, inverted: bool) -> Vec<f32> {
        let mut image = vec![0.0; width * height * 3];
        for y in 0..height {
            for x in 0..width {
                let above =
                    (y as f64) < level + angle.to_radians().tan() * (x as f64 - width as f64 / 2.0);
                image[(y * width + x) * 3..(y * width + x + 1) * 3].fill(if above ^ inverted {
                    0.8
                } else {
                    0.1
                });
            }
        }
        image
    }

    #[test]
    fn recovers_signed_angles_across_range_scale_position_and_contrast() {
        for (w, h) in [(320, 240), (127, 251), (512, 301)] {
            for angle in [-45.0, -40.0, -12.0, 0.0, 17.0, 40.0, 45.0] {
                for inverted in [false, true] {
                    let image = scene(w, h, angle, h as f64 * 0.45, inverted);
                    let result = horizon(&image, w, h, [1.0, 0.0, 0.0, 1.0], 0.0);
                    assert!(
                        result.is_some_and(|v| (v + angle).abs() < 0.5),
                        "{w}x{h} {angle} inverted={inverted}: {result:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn abstains_on_blank_and_competing_long_lines() {
        assert_eq!(
            horizon(
                &vec![0.4; 320 * 240 * 3],
                320,
                240,
                [1.0, 0.0, 0.0, 1.0],
                0.0
            ),
            None
        );
        let mut image = vec![0.1; 320 * 240 * 3];
        for x in 0..320 {
            for slope in [-0.25, 0.25] {
                let y = (120.0 + slope * (x as f64 - 160.0)) as usize;
                for yy in y..y + 3 {
                    image[(yy * 320 + x) * 3..(yy * 320 + x + 1) * 3].fill(0.9);
                }
            }
        }
        assert_eq!(horizon(&image, 320, 240, [1.0, 0.0, 0.0, 1.0], 0.0), None);
    }

    #[test]
    fn maps_anisotropic_pixels_and_searches_the_full_composed_control_range() {
        let image = scene(320, 240, 26.5650511771, 120.0, false);
        let mapped = horizon(&image, 320, 240, [1.0, 0.0, 0.0, 2.0], 0.0);
        assert!(mapped.is_some_and(|v| (v + 45.0).abs() < 0.5), "{mapped:?}");
        let image = scene(512, 120, 80.0, 60.0, false);
        let residual = horizon(&image, 512, 120, [1.0, 0.0, 0.0, 1.0], 40.0);
        assert!(
            residual.is_some_and(|v| (v + 80.0).abs() < 0.5),
            "{residual:?}"
        );
    }
}
