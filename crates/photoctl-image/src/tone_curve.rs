// The monotonic quadratic fit and scene-linear encoding are adapted from OpenColorIO's
// BSD-3-Clause GradingRGBCurve implementation. Control points are photoctl's normalized data.

const LOG_SHIFT: f32 = -0.000_157_849_85;
const LOG_BREAK: f32 = 0.004_131_837_3;
const LOG_GAIN: f32 = 363.034_6;
const LOG_OFFSET: f32 = -7.0;

#[derive(Clone)]
pub(crate) struct ToneCurve {
    knots: Vec<f32>,
    segments: Vec<Segment>,
}

#[derive(Clone, Copy)]
struct Segment {
    quadratic: f32,
    linear: f32,
    constant: f32,
}

pub(crate) fn prepare(points: Vec<Vec<f32>>) -> Result<Option<ToneCurve>, String> {
    if points.len() < 2 {
        return Err("develop curve requires at least two points".to_owned());
    }
    let mut controls: Vec<[f32; 2]> = Vec::with_capacity(points.len());
    let mut previous: Option<[f32; 2]> = None;
    for point in points {
        let [input, output]: [f32; 2] = point
            .try_into()
            .map_err(|_| "develop curve points must contain input and output".to_owned())?;
        if !input.is_finite()
            || !output.is_finite()
            || !(0.0..=1.0).contains(&input)
            || !(0.0..=1.0).contains(&output)
        {
            return Err("develop curve points must be finite and normalized".to_owned());
        }
        if let Some(previous) = previous {
            if input <= previous[0] {
                return Err("develop curve inputs must be strictly increasing".to_owned());
            }
            if output < previous[1] {
                return Err("develop curve outputs must be non-decreasing".to_owned());
            }
        }
        previous = Some([input, output]);
        controls.push([input.mul_add(14.0, -7.0), output.mul_add(14.0, -7.0)]);
    }
    if controls.iter().all(|point| point[0] == point[1]) {
        return Ok(None);
    }

    let mut slopes = estimate_slopes(&controls);
    let (mut knots, mut segments) = fit(&controls, &slopes)?;
    if adjust_slopes(&controls, &mut slopes, &knots) {
        (knots, segments) = fit(&controls, &slopes)?;
    }
    Ok(Some(ToneCurve { knots, segments }))
}

fn estimate_slopes(points: &[[f32; 2]]) -> Vec<f32> {
    let mut secants = Vec::with_capacity(points.len() - 1);
    let mut lengths = Vec::with_capacity(points.len() - 1);
    for pair in points.windows(2) {
        let dx = pair[1][0] - pair[0][0];
        let dy = pair[1][1] - pair[0][1];
        secants.push(dy / dx);
        lengths.push(dx.hypot(dy));
    }
    if points.len() == 2 {
        return vec![secants[0]; 2];
    }

    let mut start = 0;
    loop {
        let mut end = start;
        let mut combined = lengths[start];
        while end < points.len() - 2 && (secants[end + 1] - secants[end]).abs() < 1e-6 {
            end += 1;
            combined += lengths[end];
        }
        lengths[start..=end].fill(combined);
        if end >= points.len() - 3 {
            break;
        }
        start = end + 1;
    }

    let mut slopes = Vec::with_capacity(points.len());
    slopes.push(0.0);
    for index in 1..points.len() - 1 {
        slopes.push(
            (lengths[index] * secants[index] + lengths[index - 1] * secants[index - 1])
                / (lengths[index] + lengths[index - 1]),
        );
    }
    slopes.push((0.5 * (3.0 * secants[secants.len() - 1] - slopes[slopes.len() - 1])).max(0.01));
    slopes[0] = (0.5 * (3.0 * secants[0] - slopes[1])).max(0.01);
    slopes
}

fn fit(points: &[[f32; 2]], slopes: &[f32]) -> Result<(Vec<f32>, Vec<Segment>), String> {
    let mut knots = vec![points[0][0]];
    let mut segments = Vec::with_capacity(points.len() * 2 - 2);
    for index in 0..points.len() - 1 {
        let [x0, y0] = points[index];
        let [x1, y1] = points[index + 1];
        let dx = x1 - x0;
        let secant = (y1 - y0) / dx;
        if ((slopes[index] + slopes[index + 1]) - 2.0 * secant).abs() < 1e-6 {
            segments.push(Segment {
                quadratic: 0.5 * (slopes[index + 1] - slopes[index]) / dx,
                linear: slopes[index],
                constant: y0,
            });
        } else {
            let left = slopes[index] - secant;
            let right = slopes[index + 1] - secant;
            let middle = if left * right >= 0.0 {
                0.5 * (x0 + x1)
            } else if left.abs() > right.abs() {
                x1 + left * dx / (slopes[index + 1] - slopes[index])
            } else {
                x0 + right * dx / (slopes[index + 1] - slopes[index])
            };
            // Extreme adjacent slopes can round the analytic split onto an endpoint in f32.
            // Keep both quadratic spans representable rather than emitting infinite coefficients.
            let middle = middle.clamp(x0 + dx * 1e-5, x1 - dx * 1e-5);
            if !(x0 < middle && middle < x1) {
                return Err("develop curve controls are too close to fit safely".to_owned());
            }
            let middle_slope = (2.0 * secant - slopes[index + 1])
                + (slopes[index + 1] - slopes[index]) * (middle - x0) / dx;
            let acceleration = (middle_slope - slopes[index]) / (middle - x0);
            segments.push(Segment {
                quadratic: 0.5 * acceleration,
                linear: slopes[index],
                constant: y0,
            });
            let span = middle - x0;
            segments.push(Segment {
                quadratic: 0.5 * (slopes[index + 1] - middle_slope) / (x1 - middle),
                linear: middle_slope,
                constant: y0 + slopes[index] * span + 0.5 * acceleration * span * span,
            });
            knots.push(middle);
        }
        knots.push(x1);
    }
    Ok((knots, segments))
}

fn adjust_slopes(points: &[[f32; 2]], slopes: &mut [f32], knots: &[f32]) -> bool {
    let mut adjusted = false;
    let mut interval = 0;
    for &knot in knots {
        if interval >= points.len() - 1 {
            break;
        }
        if points[interval][0] != knot {
            let [x0, y0] = points[interval];
            let [x1, y1] = points[interval + 1];
            let middle_slope = (2.0 * (y1 - y0)
                - (knot - x0) * slopes[interval]
                - (x1 - knot) * slopes[interval + 1])
                / (x1 - x0);
            if middle_slope < 0.0 {
                adjusted = true;
                let secant = (y1 - y0) / (x1 - x0);
                let blend = ((knot - x0) * slopes[interval] + (x1 - knot) * slopes[interval + 1])
                    / (x1 - x0);
                let target = (0.005 * (slopes[interval] + slopes[interval + 1])).min(secant);
                let scale = (2.0 * secant - target) / blend;
                slopes[interval] *= scale;
                slopes[interval + 1] *= scale;
            }
            interval += 1;
        }
    }
    adjusted
}

impl ToneCurve {
    pub(crate) fn evaluate(&self, value: f32) -> f32 {
        let index = self.knots.partition_point(|knot| *knot <= value);
        if index == 0 {
            return (value - self.knots[0]) * self.segments[0].linear + self.segments[0].constant;
        }
        if index == self.knots.len() {
            let segment = self.segments[self.segments.len() - 1];
            let start = self.knots[self.knots.len() - 2];
            let end = self.knots[self.knots.len() - 1];
            let span = end - start;
            let slope = 2.0 * segment.quadratic * span + segment.linear;
            let endpoint = (segment.quadratic * span + segment.linear) * span + segment.constant;
            return (value - end) * slope + endpoint;
        }
        let segment = self.segments[index - 1];
        let span = value - self.knots[index - 1];
        (segment.quadratic * span + segment.linear) * span + segment.constant
    }
}

pub(crate) fn to_log(value: f32) -> f32 {
    if value < LOG_BREAK {
        value.mul_add(LOG_GAIN, LOG_OFFSET)
    } else {
        ((value + LOG_SHIFT) / (0.18 + LOG_SHIFT)).log2()
    }
}

pub(crate) fn from_log(value: f32) -> f32 {
    if value < -5.5 {
        (value - LOG_OFFSET) / LOG_GAIN
    } else {
        value.exp2().mul_add(0.18 + LOG_SHIFT, -LOG_SHIFT)
    }
}

#[cfg(test)]
mod tests {
    use super::prepare;

    #[test]
    fn steep_adjacent_controls_keep_every_spline_segment_finite() {
        let curve = prepare(vec![
            vec![0.22, 0.17],
            vec![0.66, 0.28],
            vec![0.68, 0.51],
            vec![0.70, 0.74],
        ])
        .unwrap()
        .unwrap();

        let mut previous = f32::NEG_INFINITY;
        for index in 0..=1_000 {
            let value = -7.0 + index as f32 * 0.014;
            let evaluated = curve.evaluate(value);
            assert!(evaluated.is_finite(), "non-finite curve value at {value}");
            assert!(evaluated >= previous, "curve decreased at {value}");
            previous = evaluated;
        }
    }
}
