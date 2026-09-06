// SPDX-License-Identifier: CDDL-1.0
// Derived from LibRaw 0.22.2 recover_highlights:
// Copyright 2019-2025 LibRaw LLC (info@libraw.org).
// LibRaw uses dcraw.c, copyright 1997-2018 Dave Coffin.
// Floating-domain modifications copyright 2026 photoctl contributors.
// This file is distributed under CDDL 1.0; see sibling LICENSE.CDDL in the
// distributed native package, or ../../libraw-sys/vendor/LICENSE.CDDL in the
// source tree. It is not covered by the root MIT license.
//
//! Floating-domain translation of LibRaw 0.22.2 `recover_highlights`.
//! Ratio-map cells and mode-3 propagation follow the vendored implementation.
//! Only threshold metadata is mapped from its ushort domain: samples are never
//! quantized, truncated or display-clamped. Partial cells remain unreconstructed.

use libraw_sys::NativeGrid;

pub(crate) const METHOD: &str = "libraw-spatial-float-v1";

const CELL: u32 = 4;
const GROW: f64 = 2.0;
const SPREAD: usize = 16;
const NEIGHBORS: [(i32, i32, f64); 8] = [
    (-1, -1, 1.0),
    (-1, 0, 2.0),
    (-1, 1, 1.0),
    (0, 1, 2.0),
    (1, 1, 1.0),
    (1, 0, 2.0),
    (1, -1, 1.0),
    (0, -1, 2.0),
];

pub(crate) struct Reconstruction {
    reference: usize,
    thresholds: [f64; 3],
    width: u32,
    height: u32,
    maps: [Vec<f64>; 3],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ratio_evidence_preserves_reliable_fractional_samples_and_float_headroom() {
        let grid = NativeGrid {
            width: 12,
            height: 12,
            origin: 0,
            x_step: 1,
            y_step: 12,
        };
        // Representable LibRaw-domain samples: eight reliable cells surround
        // one clipped cell. Its weighted ratio grows toward neutral in mode 3.
        let unit = 2.0 / 65_535.0;
        let read = |i: usize| {
            let x = i % 12;
            let y = i / 12;
            if (4..8).contains(&x) && (4..8).contains(&y) {
                [60_000.0 * unit, 35_000.0 * unit, 20_000.0 * unit]
            } else {
                [30_000.0 * unit, 16_000.0 * unit, 8_000.0 * unit]
            }
        };
        let plan = Reconstruction::plan(grid, [2.0, 1.0, 0.5], read).unwrap();
        let actual = plan.apply(4, 4, read(52));
        // Exact vendored routine gives [60000,35999,22285]. The floating
        // translation retains its fractional reconstruction, not ushort truncation.
        for (sample, reference) in actual.iter().zip([60_000.0, 35_999.0, 22_285.0]) {
            // One integer truncation quantum, plus f32 ratio-map roundoff.
            assert!((sample / unit - reference).abs() <= 1.001);
        }
        assert!(actual[0] > 1.0);
        for rotation in 1..3 {
            let rotate = |mut channels: [f64; 3]| {
                channels.rotate_left(rotation);
                channels
            };
            let rotated =
                Reconstruction::plan(grid, rotate([2.0, 1.0, 0.5]), |i| rotate(read(i))).unwrap();
            assert_eq!(rotated.apply(4, 4, rotate(read(52))), rotate(actual));
        }
        let reliable = [0.713_123_456_789, 0.123_456_789, 0.031_234_567_89];
        assert_eq!(plan.apply(4, 4, reliable), reliable);
        let headroom = [2.5, 3.25, 4.125];
        assert_eq!(plan.apply(4, 4, headroom), headroom);
    }

    #[test]
    fn physical_cells_survive_all_affine_orientations_and_leave_partial_edges_untouched() {
        let original: Vec<_> = (0..117)
            .map(|i| {
                if (i % 13 >= 4 && i % 13 < 8 && i / 13 >= 4 && i / 13 < 8)
                    || i % 13 == 12
                    || i / 13 == 8
                {
                    [1.8, 1.0, 0.5]
                } else {
                    [0.9, 0.49 + (i % 7) as f64 * 0.01, 0.245]
                }
            })
            .collect();
        let base = NativeGrid {
            width: 13,
            height: 9,
            origin: 0,
            x_step: 1,
            y_step: 13,
        };
        let plan = Reconstruction::plan(base, [2.0, 1.0, 0.5], |i| original[i]).unwrap();
        let expected: Vec<_> = (0..117)
            .map(|i| plan.apply(i % 13, i / 13, original[i as usize]))
            .collect();
        assert_ne!(expected[56], original[56]);
        for (origin, x_step, y_step) in [
            (0, 1, 13),
            (12, -1, 13),
            (104, 1, -13),
            (116, -1, -13),
            (0, 9, 1),
            (8, 9, -1),
            (108, -9, 1),
            (116, -9, -1),
        ] {
            let grid = NativeGrid {
                origin,
                x_step,
                y_step,
                ..base
            };
            let mut oriented = vec![[0.0; 3]; 117];
            for y in 0..9 {
                for x in 0..13 {
                    oriented[grid.index(x, y)] = original[(y * 13 + x) as usize];
                }
            }
            let plan = Reconstruction::plan(grid, [2.0, 1.0, 0.5], |i| oriented[i]).unwrap();
            for y in 0..9 {
                for x in 0..13 {
                    let input = oriented[grid.index(x, y)];
                    let actual = plan.apply(x, y, input);
                    assert_eq!(actual, expected[(y * 13 + x) as usize]);
                    if x == 12 || y == 8 {
                        assert_eq!(actual, input);
                    }
                }
            }
        }
    }

    #[test]
    fn missing_evidence_terminates_and_propagation_has_a_finite_native_radius() {
        let grid = NativeGrid {
            width: 160,
            height: 160,
            origin: 0,
            x_step: 1,
            y_step: 160,
        };
        let clipped = [1.8, 1.0, 0.5];
        let missing = Reconstruction::plan(grid, [2.0, 1.0, 0.5], |_| clipped).unwrap();
        assert_eq!(missing.apply(80, 80, clipped), [1.8; 3]);
        let seeded = Reconstruction::plan(grid, [2.0, 1.0, 0.5], |i| {
            if i % 160 < 4 {
                [0.9, 0.5, 0.25]
            } else {
                clipped
            }
        })
        .unwrap();
        assert!(seeded.apply(64, 80, clipped)[1] < 1.8);
        assert_eq!(seeded.apply(68, 80, clipped), [1.8; 3]);
        for (width, height) in [(0, 0), (1, 1), (3, 8), (7, 3)] {
            let tiny = NativeGrid {
                width,
                height,
                origin: 0,
                x_step: 1,
                y_step: i64::from(width),
            };
            let plan = Reconstruction::plan(tiny, [2.0, 1.0, 0.5], |_| clipped).unwrap();
            assert_eq!(plan.apply(0, 0, clipped), clipped);
        }
    }
}

impl Reconstruction {
    pub(crate) fn plan(
        grid: NativeGrid,
        gains: [f64; 3],
        read: impl Fn(usize) -> [f64; 3],
    ) -> Result<Self, String> {
        if gains.iter().any(|gain| !gain.is_finite() || *gain <= 0.0) {
            return Err("highlight reconstruction requires positive finite sensor WB gains".into());
        }
        let reference = (1..3).fold(0, |best, c| if gains[c] > gains[best] { c } else { best });
        let unit = gains[reference] / 65_535.0;
        let thresholds = gains.map(|gain| (32_000.0 * gain / gains[reference]).floor() * unit);
        if thresholds.contains(&0.0) {
            return Err("highlight reconstruction saturation reference is too small".into());
        }
        let width = grid.width / CELL;
        let height = grid.height / CELL;
        let mut result = Self {
            reference,
            thresholds,
            width,
            height,
            maps: std::array::from_fn(|_| Vec::new()),
        };
        for c in 0..3 {
            if c == reference {
                continue;
            }
            let mut map = vec![0.0; width as usize * height as usize];
            for y in 0..height {
                for x in 0..width {
                    let mut sum = 0.0;
                    let mut weight = 0.0;
                    let mut count = 0;
                    for dy in 0..CELL {
                        for dx in 0..CELL {
                            let pixel = read(grid.index(x * CELL + dx, y * CELL + dy));
                            if pixel[c] >= thresholds[c]
                                && pixel[c] < 2.0 * thresholds[c]
                                && pixel[reference] > 24_000.0 * unit
                            {
                                sum += pixel[c];
                                weight += pixel[reference];
                                count += 1;
                            }
                        }
                    }
                    if count == CELL * CELL {
                        map[(y * width + x) as usize] = sum / weight;
                    }
                }
            }
            // Negative pending values cannot seed the same pass. A no-progress
            // pass terminates immediately; even an expanding map stops at 16.
            for _ in 0..SPREAD {
                for y in 0..height {
                    for x in 0..width {
                        let i = (y * width + x) as usize;
                        if map[i] != 0.0 {
                            continue;
                        }
                        let mut sum = 0.0;
                        let mut count = 0.0;
                        for (dy, dx, weight) in NEIGHBORS {
                            let ny = y as i32 + dy;
                            let nx = x as i32 + dx;
                            if ny >= 0 && nx >= 0 && ny < height as i32 && nx < width as i32 {
                                let value = map[ny as usize * width as usize + nx as usize];
                                if value > 0.0 {
                                    sum += weight * value;
                                    count += weight;
                                }
                            }
                        }
                        if count > 3.0 {
                            map[i] = -(sum + GROW) / (count + GROW);
                        }
                    }
                }
                let mut changed = false;
                for value in &mut map {
                    if *value < 0.0 {
                        *value = -*value;
                        changed = true;
                    }
                }
                if !changed {
                    break;
                }
            }
            for value in &mut map {
                if *value == 0.0 {
                    *value = 1.0;
                }
            }
            result.maps[c] = map;
        }
        Ok(result)
    }

    pub(crate) fn apply(&self, x: u32, y: u32, mut pixel: [f64; 3]) -> [f64; 3] {
        let x = x / CELL;
        let y = y / CELL;
        if x >= self.width || y >= self.height {
            return pixel;
        }
        for c in 0..3 {
            if c != self.reference && pixel[c] >= 2.0 * self.thresholds[c] {
                pixel[c] = pixel[c]
                    .max(pixel[self.reference] * self.maps[c][(y * self.width + x) as usize]);
            }
        }
        pixel
    }
}
