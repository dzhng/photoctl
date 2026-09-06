use super::decode;
use std::{f64::consts::PI, path::PathBuf};

struct Dng(PathBuf);
impl Drop for Dng {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

// An uncompressed, single-strip DNG exercises the actual file parser and decoder.
// Each site samples an independent band-limited neutral scene through its CFA gain.
fn neutral_value(x: u32, y: u32) -> f64 {
    let phase = 2.0 * PI * (f64::from(x) + 0.25 * f64::from(y) - 160.0) / 64.0;
    0.35 + 0.2
        * [1, 3, 5, 7]
            .iter()
            .map(|n| (phase * f64::from(*n)).sin() / f64::from(*n))
            .sum::<f64>()
}

fn neutral_dng(gains: [u32; 3]) -> (Dng, Vec<u16>) {
    let side = 256u32;
    let samples: Vec<u16> = (0..side * side)
        .map(|i| {
            let (x, y) = (i % side, i / side);
            let value = neutral_value(x, y);
            let channel = [[0, 1], [1, 2]][(y % 2) as usize][(x % 2) as usize];
            (value * 16383.0 * 1000.0 / f64::from(gains[channel])).round() as u16
        })
        .collect();
    let file = write_dng(gains, 16383, [0, 1, 1, 2], &samples);
    (file, samples)
}

fn write_dng(gains: [u32; 3], white: u32, pattern: [u8; 4], samples: &[u16]) -> Dng {
    let side = 256u32;
    let channels = (samples.len() / (side * side) as usize) as u16;
    let short = |value: u16| value.to_le_bytes().to_vec();
    let long = |value: u32| value.to_le_bytes().to_vec();
    let rational = |values: &[(u32, u32)]| {
        values
            .iter()
            .flat_map(|(a, b)| [a.to_le_bytes(), b.to_le_bytes()].concat())
            .collect::<Vec<_>>()
    };
    let mut tags = vec![
        (256, 4, long(side)),
        (257, 4, long(side)),
        (258, 3, short(16).repeat(channels as usize)),
        (259, 3, short(1)),
        (262, 3, short(if channels == 1 { 32803 } else { 34892 })),
        (271, 2, b"photoctl\0".to_vec()),
        (272, 2, b"Neutral CFA\0".to_vec()),
        (273, 4, long(0)),
        (277, 3, short(channels)),
        (278, 4, long(side)),
        (279, 4, long(samples.len() as u32 * 2)),
        (284, 3, short(1)),
        (33421, 3, [short(2), short(2)].concat()),
        (33422, 1, pattern.to_vec()),
        (50706, 1, vec![1, 4, 0, 0]),
        (50707, 1, vec![1, 1, 0, 0]),
        (50708, 2, b"photoctl Neutral CFA\0".to_vec()),
        (50710, 1, vec![0, 1, 2]),
        (50711, 3, short(1)),
        (50714, 5, rational(&[(0, 1)])),
        (50717, 4, long(white)),
        (
            50721,
            10,
            rational(&[
                (1, 1),
                (0, 1),
                (0, 1),
                (0, 1),
                (1, 1),
                (0, 1),
                (0, 1),
                (0, 1),
                (1, 1),
            ]),
        ),
        (50728, 5, rational(&gains.map(|gain| (1000, gain)))),
        (50778, 3, short(21)),
    ];
    tags.sort_by_key(|(tag, _, _)| *tag);
    let payload_start = 8 + 2 + tags.len() * 12 + 4;
    let mut header = [b"II".to_vec(), short(42), long(8), short(tags.len() as u16)].concat();
    let mut payload = Vec::new();
    let mut strip_pointer = 0;
    for (tag, kind, value) in tags {
        header.extend(short(tag));
        header.extend(short(kind));
        let width = match kind {
            3 => 2,
            4 => 4,
            5 | 10 => 8,
            _ => 1,
        };
        header.extend(long((value.len() / width) as u32));
        if tag == 273 {
            strip_pointer = header.len();
        }
        if value.len() <= 4 {
            let mut inline = [0u8; 4];
            inline[..value.len()].copy_from_slice(&value);
            header.extend(inline);
        } else {
            header.extend(long((payload_start + payload.len()) as u32));
            payload.extend(value);
            if payload.len() % 2 != 0 {
                payload.push(0);
            }
        }
    }
    header.extend(long(0));
    let strip_offset = (header.len() + payload.len()) as u32;
    header[strip_pointer..strip_pointer + 4].copy_from_slice(&strip_offset.to_le_bytes());
    header.extend(payload);
    header.extend(samples.iter().flat_map(|sample| sample.to_le_bytes()));
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let file = Dng(std::env::temp_dir().join(format!(
        "photoctl-neutral-{}-{unique}.dng",
        std::process::id()
    )));
    std::fs::write(&file.0, header).unwrap();
    file
}

#[test]
fn unequal_cfa_sensitivity_does_not_invent_neutral_fine_detail_chroma() {
    let (file, _) = neutral_dng([2500, 1000, 1500]);
    let image = decode(&file.0).expect("generated DNG decodes through the public boundary");
    assert_eq!((image.metadata.width, image.metadata.height), (256, 256));
    let mut spreads = Vec::new();
    let mut luminance_errors = Vec::new();
    let mut minimum = f32::INFINITY;
    let mut maximum = f32::NEG_INFINITY;
    for y in 16..240usize {
        for x in 16..240usize {
            let offset = (y * 256 + x) * 3;
            let rgb: [f32; 3] = std::array::from_fn(|c| {
                image.data[offset + c] * image.metadata.as_shot_wb[c]
                    / image.metadata.as_shot_wb[1]
                    / 16383.0
            });
            let mean = rgb.iter().sum::<f32>() / 3.0;
            luminance_errors.push((mean - neutral_value(x as u32, y as u32) as f32).abs());
            minimum = minimum.min(mean);
            maximum = maximum.max(mean);
            spreads.push(
                rgb.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                    - rgb.iter().copied().fold(f32::INFINITY, f32::min),
            );
        }
    }
    spreads.sort_by(f32::total_cmp);
    let p95 = spreads[spreads.len() * 95 / 100];
    // A 0.3% scene-linear chromatic budget is below one 8-bit linear code step;
    // this is an acceptance budget, not an exact AHD interpolation-error bound.
    assert!(
        p95 < 0.003,
        "known-neutral fine-detail channel spread p95={p95}"
    );
    // The authored Fourier field spans more than 0.3: retain that contrast.
    assert!(
        maximum - minimum > 0.3,
        "neutral detail must not disappear into a flat field"
    );
    luminance_errors.sort_by(f32::total_cmp);
    let p95_error = luminance_errors[luminance_errors.len() * 95 / 100];
    assert!(
        p95_error < 0.003,
        "authored fine-detail luminance error p95={p95_error}"
    );
}

#[test]
fn measured_cfa_and_fractional_interpolated_headroom_survive() {
    let (_normal, mut samples) = neutral_dng([2500, 1000, 1500]);
    samples[128 * 256 + 128] = 0;
    let file = write_dng([2500, 1000, 1500], 1000, [0, 1, 1, 2], &samples);
    let image = decode(&file.0).unwrap();
    assert_eq!(image.metadata.white_level, 1000);
    assert!(!image.metadata.wb_pre_applied);
    let mut fractional_above_white = false;
    for (index, sample) in samples.iter().enumerate() {
        let channel = [[0, 1], [1, 2]][index / 256 % 2][index % 2];
        assert_eq!(image.data[index * 3 + channel], f32::from(*sample));
        for c in 0..3 {
            let value = image.data[index * 3 + c];
            assert!(value.is_finite() && value >= 0.0);
            if c != channel && value > 1000.0 && value.fract() != 0.0 {
                fractional_above_white = true;
            }
        }
    }
    assert!(samples.iter().any(|sample| *sample > 1000));
    assert!(
        fractional_above_white,
        "inverse scaling must return float headroom, not ushort"
    );
}

#[test]
fn complete_rgb_dng_preserves_every_channel_exactly() {
    let samples: Vec<u16> = (0..256 * 256)
        .flat_map(|i| [i as u16, (i / 2) as u16, (65535 - i) as u16])
        .collect();
    let file = write_dng([2500, 1000, 1500], 16383, [0, 1, 1, 2], &samples);
    let image = decode(&file.0).unwrap();
    assert_eq!(
        image.data,
        samples
            .iter()
            .map(|value| f32::from(*value))
            .collect::<Vec<_>>()
    );
    assert!(!image.metadata.sensor_saturation);
}

#[test]
fn constant_colored_cfa_preserves_distinct_camera_channels() {
    let expected = [11001u16, 4203, 7105];
    let samples: Vec<_> = (0..256 * 256)
        .map(|index| expected[[[0, 1], [1, 2]][index / 256 % 2][index % 2]])
        .collect();
    let file = write_dng([2500, 1000, 1500], 16383, [0, 1, 1, 2], &samples);
    let image = decode(&file.0).unwrap();
    for y in 16..240 {
        for x in 16..240 {
            for c in 0..3 {
                // Half a working-code input rounding error plus one AHD integer code,
                // then inverse scale; constant fields have no spatial approximation error.
                let scale = [1.0, 0.4, 0.6][c];
                assert!(
                    (image.data[(y * 256 + x) * 3 + c] - f32::from(expected[c])).abs()
                        <= 1.5 / scale
                );
            }
        }
    }
}

#[test]
fn invalid_actual_gain_and_non_bayer_phase_are_rejected() {
    let samples = vec![1000; 256 * 256];
    for (gains, pattern) in [
        ([2_000_000, 10, 10], [0, 1, 1, 2]),
        ([2500, 1000, 1500], [0, 1, 2, 1]),
    ] {
        let file = write_dng(gains, 16383, pattern, &samples);
        // LibRaw rejects extreme metadata ratios by clearing the actual red gain;
        // this pins that invalid actual WB, not an unreachable parser ratio.
        if gains[0] == 2_000_000 {
            assert_eq!(super::probe(&file.0).unwrap().as_shot_wb[0], 0.0);
        }
        let error = decode(&file.0)
            .err()
            .expect("unsupported gain/CFA must not run unbalanced AHD");
        assert!(
            error.contains("Unsupported"),
            "unexpected rejection: {error}"
        );
    }
}
