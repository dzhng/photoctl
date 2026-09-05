use std::collections::VecDeque;
use std::sync::{Arc, mpsc};
use std::thread;

use super::{REC2020_TO_XYZ, SampleStorage, rec2020_luminance};

const PATCH_RADIUS: usize = 1;
const SEARCH_RADIUS: usize = 2;
const ROW_BLOCK: usize = 16;
const MAX_WORKERS: usize = 8;
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
    let source_rows = SourceRows::new(data, width, height, ROW_BLOCK + delay - 1);
    let settings = Settings {
        width,
        height,
        component,
        amount,
        h_squared,
        delay,
    };
    let worker_count = thread::available_parallelism()
        .map_or(1, usize::from)
        .min(MAX_WORKERS)
        .min(height);
    let (result_sender, result_receiver) = mpsc::channel();
    let mut job_senders = Vec::with_capacity(worker_count);
    let mut workers = Vec::with_capacity(worker_count);
    for _ in 0..worker_count {
        let (job_sender, job_receiver) = mpsc::channel::<Option<RowJob>>();
        let result_sender = result_sender.clone();
        job_senders.push(job_sender);
        workers.push(thread::spawn(move || {
            while let Some(job) = job_receiver.recv().unwrap() {
                let rows = (job.start..job.end)
                    .map(|y| {
                        compute_row(
                            &job.source_rows,
                            job.settings.width,
                            job.settings.height,
                            y,
                            job.settings.component,
                            job.settings.amount,
                            job.settings.h_squared,
                        )
                    })
                    .collect();
                result_sender.send((job.start, rows)).unwrap();
            }
        }));
    }
    drop(result_sender);
    apply_blocks(data, source_rows, settings, &job_senders, &result_receiver);
    for sender in job_senders {
        sender.send(None).unwrap();
    }
    for worker in workers {
        worker.join().unwrap();
    }
}

#[derive(Clone)]
struct RowJob {
    source_rows: SourceRows,
    settings: Settings,
    start: usize,
    end: usize,
}

#[derive(Clone, Copy)]
struct Settings {
    width: usize,
    height: usize,
    component: Component,
    amount: f32,
    h_squared: f32,
    delay: usize,
}

fn apply_blocks<S: SampleStorage + ?Sized>(
    data: &mut S,
    mut source_rows: SourceRows,
    settings: Settings,
    job_senders: &[mpsc::Sender<Option<RowJob>>],
    result_receiver: &mpsc::Receiver<(usize, Vec<Vec<f32>>)>,
) {
    for block_start in (0..settings.height).step_by(ROW_BLOCK) {
        let block_end = block_start.saturating_add(ROW_BLOCK).min(settings.height);
        source_rows.extend(
            data,
            block_end
                .saturating_add(settings.delay - 1)
                .min(settings.height - 1),
        );
        let rows_per_worker = (block_end - block_start).div_ceil(job_senders.len());
        let mut job_count = 0;
        for (worker, start) in (block_start..block_end)
            .step_by(rows_per_worker)
            .enumerate()
        {
            let end = start.saturating_add(rows_per_worker).min(block_end);
            job_senders[worker]
                .send(Some(RowJob {
                    source_rows: source_rows.clone(),
                    settings,
                    start,
                    end,
                }))
                .unwrap();
            job_count += 1;
        }
        let mut output_chunks = (0..job_count)
            .map(|_| result_receiver.recv().unwrap())
            .collect::<Vec<_>>();
        output_chunks.sort_unstable_by_key(|(start, _)| *start);
        for (start, rows) in output_chunks {
            for (row_offset, row) in rows.into_iter().enumerate() {
                write_row(data, settings.width, start + row_offset, row);
            }
        }
        // Keep the original rows whose patches remain reachable from the next block.
        source_rows.discard_before(block_end.saturating_sub(settings.delay));
    }
}

fn compute_row(
    source_rows: &SourceRows,
    width: usize,
    height: usize,
    y: usize,
    component: Component,
    amount: f32,
    h_squared: f32,
) -> Vec<f32> {
    let mut weighted = vec![[0.0_f64; 3]; width];
    let mut weight_sums = vec![0.0_f64; width];
    let min_y = y.saturating_sub(SEARCH_RADIUS);
    let max_y = y.saturating_add(SEARCH_RADIUS).min(height - 1);
    for candidate_y in min_y..=max_y {
        for offset_x in -(SEARCH_RADIUS as isize)..=SEARCH_RADIUS as isize {
            let distances = patch_distances(
                source_rows,
                width,
                height,
                y,
                candidate_y,
                offset_x,
                component,
            );
            for x in 0..width {
                let Some(candidate_x) = x
                    .checked_add_signed(offset_x)
                    .filter(|candidate_x| *candidate_x < width)
                else {
                    continue;
                };
                let weight = f64::from((-distances[x] / h_squared).exp());
                let candidate = source_rows.components(candidate_x, candidate_y);
                for channel in 0..3 {
                    weighted[x][channel] += weight * f64::from(candidate[channel]);
                }
                weight_sums[x] += weight;
            }
        }
    }

    let mut row = Vec::with_capacity(width * 3);
    for x in 0..width {
        let source = source_rows.rgb(x, y);
        let average = weighted[x].map(|sample| (sample / weight_sums[x]) as f32);
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
    row
}

#[derive(Clone, Copy)]
struct SourcePixel {
    rgb: [f32; 3],
    components: [f32; 3],
}

#[derive(Clone)]
struct SourceRows {
    first_y: usize,
    rows: VecDeque<Arc<Vec<SourcePixel>>>,
    width: usize,
}

impl SourceRows {
    fn new<S: SampleStorage + ?Sized>(
        data: &S,
        width: usize,
        height: usize,
        through_y: usize,
    ) -> Self {
        let mut rows = VecDeque::new();
        for y in 0..=through_y.min(height - 1) {
            rows.push_back(Arc::new(component_row(data, width, y)));
        }
        Self {
            first_y: 0,
            rows,
            width,
        }
    }

    fn extend<S: SampleStorage + ?Sized>(&mut self, data: &S, through_y: usize) {
        let mut y = self.first_y + self.rows.len();
        while y <= through_y {
            self.rows
                .push_back(Arc::new(component_row(data, self.width, y)));
            y += 1;
        }
    }

    fn discard_before(&mut self, y: usize) {
        while self.first_y < y {
            self.rows.pop_front();
            self.first_y += 1;
        }
    }

    fn components(&self, x: usize, y: usize) -> [f32; 3] {
        self.rows[y - self.first_y][x].components
    }

    fn rgb(&self, x: usize, y: usize) -> [f32; 3] {
        self.rows[y - self.first_y][x].rgb
    }
}

fn component_row<S: SampleStorage + ?Sized>(data: &S, width: usize, y: usize) -> Vec<SourcePixel> {
    (0..width)
        .map(|x| {
            let rgb = read_pixel(data, width, x, y);
            SourcePixel {
                rgb,
                components: components(rgb),
            }
        })
        .collect()
}

fn patch_distances(
    rows: &SourceRows,
    width: usize,
    height: usize,
    source_y: usize,
    candidate_y: usize,
    offset_x: isize,
    component: Component,
) -> Vec<f32> {
    let mut distances = vec![0.0; width];
    let interior_start = 1_usize.max(1_usize.saturating_add_signed(-offset_x));
    let interior_end = width
        .saturating_sub(2)
        .min(width.saturating_sub(2).saturating_add_signed(-offset_x));

    for (x, distance) in distances
        .iter_mut()
        .enumerate()
        .take(interior_start.min(width))
    {
        *distance = direct_patch_distance(
            rows,
            width,
            height,
            (x, source_y),
            (offset_clamped(x, offset_x, width), candidate_y),
            component,
        );
    }
    if interior_start <= interior_end && interior_start < width {
        let mut sum = 0.0_f64;
        for column in interior_start - 1..=interior_start + 1 {
            sum += column_distance(
                rows,
                height,
                column,
                source_y,
                offset_x,
                candidate_y,
                component,
            );
        }
        distances[interior_start] = normalized_distance(sum, component);
        for (x, distance) in distances
            .iter_mut()
            .enumerate()
            .take(interior_end + 1)
            .skip(interior_start + 1)
        {
            sum -= column_distance(
                rows,
                height,
                x - 2,
                source_y,
                offset_x,
                candidate_y,
                component,
            );
            sum += column_distance(
                rows,
                height,
                x + 1,
                source_y,
                offset_x,
                candidate_y,
                component,
            );
            *distance = normalized_distance(sum, component);
        }
    }
    let edge_start = if interior_start <= interior_end {
        interior_end.saturating_add(1)
    } else {
        interior_start.min(width)
    };
    for (x, distance) in distances.iter_mut().enumerate().skip(edge_start) {
        *distance = direct_patch_distance(
            rows,
            width,
            height,
            (x, source_y),
            (offset_clamped(x, offset_x, width), candidate_y),
            component,
        );
    }
    distances
}

fn column_distance(
    rows: &SourceRows,
    height: usize,
    source_x: usize,
    source_y: usize,
    offset_x: isize,
    candidate_y: usize,
    component: Component,
) -> f64 {
    let candidate_x = source_x.saturating_add_signed(offset_x);
    (-(PATCH_RADIUS as isize)..=PATCH_RADIUS as isize)
        .map(|offset_y| {
            component_distance(
                rows.components(source_x, offset_clamped(source_y, offset_y, height)),
                rows.components(candidate_x, offset_clamped(candidate_y, offset_y, height)),
                component,
            )
        })
        .sum()
}

fn direct_patch_distance(
    rows: &SourceRows,
    width: usize,
    height: usize,
    source: (usize, usize),
    candidate: (usize, usize),
    component: Component,
) -> f32 {
    let mut distance = 0.0_f64;
    for patch_y in -(PATCH_RADIUS as isize)..=PATCH_RADIUS as isize {
        for patch_x in -(PATCH_RADIUS as isize)..=PATCH_RADIUS as isize {
            distance += component_distance(
                rows.components(
                    offset_clamped(source.0, patch_x, width),
                    offset_clamped(source.1, patch_y, height),
                ),
                rows.components(
                    offset_clamped(candidate.0, patch_x, width),
                    offset_clamped(candidate.1, patch_y, height),
                ),
                component,
            );
        }
    }
    normalized_distance(distance, component)
}

fn component_distance(source: [f32; 3], candidate: [f32; 3], component: Component) -> f64 {
    let squared_difference = |index: usize| {
        let difference = source[index] - candidate[index];
        difference * difference
    };
    let distance = match component {
        Component::Luminance => squared_difference(0),
        Component::Color => squared_difference(1) + squared_difference(2),
    };
    if distance.is_finite() {
        f64::from(distance)
    } else {
        let squared_difference = |index: usize| {
            let difference = f64::from(source[index]) - f64::from(candidate[index]);
            difference * difference
        };
        match component {
            Component::Luminance => squared_difference(0),
            Component::Color => squared_difference(1) + squared_difference(2),
        }
    }
}

fn normalized_distance(distance: f64, component: Component) -> f32 {
    let samples = match component {
        Component::Luminance => 9.0,
        Component::Color => 18.0,
    };
    (distance.max(0.0) / samples) as f32
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

#[cfg(test)]
mod tests {
    use super::{Component, component_distance, normalized_distance};

    #[test]
    fn rolling_distance_roundoff_stays_finite_and_nonnegative() {
        assert_eq!(
            normalized_distance(-f64::EPSILON, Component::Luminance),
            0.0
        );
        assert!(
            component_distance(
                [f32::MAX, 0.0, f32::MAX],
                [-f32::MAX, 0.0, -f32::MAX],
                Component::Color,
            )
            .is_finite()
        );
        let source = [0.0, 0.000_233_932_29, 0.000_238_024_75];
        assert_eq!(
            component_distance(source, [0.0; 3], Component::Color),
            f64::from(source[1].powi(2) + source[2].powi(2)),
        );
    }
}
