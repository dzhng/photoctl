const D65_XYZ: [f64; 3] = [0.95047, 1.0, 1.08883];

// Linear sRGB (D65) to linear Rec.2020.
const SRGB_TO_REC2020: [[f64; 3]; 3] = [
    [0.627_403_9, 0.329_283, 0.043_313_1],
    [0.069_097_3, 0.919_540_4, 0.011_362_3],
    [0.016_391_4, 0.088_013_3, 0.895_595_3],
];

// CIE XYZ D65 to linear sRGB.
const XYZ_TO_SRGB: [[f64; 3]; 3] = [
    [3.240_454_2, -1.537_138_5, -0.498_531_4],
    [-0.969_266, 1.876_010_8, 0.041_556],
    [0.055_643_4, -0.204_025_9, 1.057_225_2],
];

const REC2020_TO_SRGB: [[f64; 3]; 3] = [
    [1.660_491, -0.587_641, -0.072_850],
    [-0.124_550, 1.132_900, -0.008_349],
    [-0.018_151, -0.100_579, 1.118_730],
];

const REC2020_TO_XYZ: [[f64; 3]; 3] = [
    [0.636_958_0, 0.144_616_9, 0.168_880_9],
    [0.262_700_2, 0.677_998_1, 0.059_301_7],
    [0.0, 0.028_072_7, 1.060_985_1],
];

const BRADFORD: [[f64; 3]; 3] = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];

const BRADFORD_INVERSE: [[f64; 3]; 3] = [
    [0.986_992_9, -0.147_054_3, 0.159_962_7],
    [0.432_305_3, 0.518_360_3, 0.049_291_2],
    [-0.008_528_7, 0.040_042_8, 0.968_486_7],
];

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct GlobalDevelop {
    pub exposure: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub black_point: f32,
    pub temperature_offset_k: f32,
    pub tint: f32,
    pub cast: f32,
}

pub(crate) fn apply_global_in_place(
    data: &mut [f32],
    parameters: GlobalDevelop,
) -> Result<(), String> {
    if data.len() % 3 != 0 {
        return Err("global develop expects interleaved RGB samples".to_owned());
    }
    let prepared = prepare_global(parameters)?;
    for destination in data.chunks_exact_mut(3) {
        destination.copy_from_slice(&grade_pixel(
            [destination[0], destination[1], destination[2]],
            prepared,
        )?);
    }
    Ok(())
}

pub(crate) fn apply_global_artifact_in_place(
    data: &mut [u8],
    pixel_offset: usize,
    pixel_bytes: usize,
    parameters: GlobalDevelop,
) -> Result<(), String> {
    if pixel_bytes % 12 != 0 || pixel_offset.checked_add(pixel_bytes) != Some(data.len()) {
        return Err("global develop artifact has an invalid pixel span".to_owned());
    }
    let prepared = prepare_global(parameters)?;
    for pixel in data[pixel_offset..].chunks_exact_mut(12) {
        let source = [
            f32::from_le_bytes(pixel[0..4].try_into().unwrap()),
            f32::from_le_bytes(pixel[4..8].try_into().unwrap()),
            f32::from_le_bytes(pixel[8..12].try_into().unwrap()),
        ];
        let graded = grade_pixel(source, prepared)?;
        for (channel, sample) in graded.into_iter().enumerate() {
            pixel[channel * 4..channel * 4 + 4].copy_from_slice(&sample.to_le_bytes());
        }
    }
    Ok(())
}

pub(crate) fn validate_artifact_samples(
    data: &[u8],
    pixel_offset: usize,
    pixel_bytes: usize,
) -> Result<(), String> {
    if pixel_bytes % 4 != 0 || pixel_offset.checked_add(pixel_bytes) != Some(data.len()) {
        return Err("linear artifact has an invalid pixel span".to_owned());
    }
    for sample in data[pixel_offset..].chunks_exact(4) {
        if !f32::from_le_bytes(sample.try_into().unwrap()).is_finite() {
            return Err("linear artifact contains a non-finite sample".to_owned());
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct PreparedGlobal {
    exposure: f32,
    offset: f32,
    black_pivot: f32,
    contrast: f32,
    saturation: f32,
    white_balance: [[f64; 3]; 3],
    cast: f32,
}

fn prepare_global(parameters: GlobalDevelop) -> Result<PreparedGlobal, String> {
    // Primary order and equations follow OpenColorIO's BSD-3 GradingPrimary LIN renderer;
    // the control normalizations below are photoctl data, not copied implementation code.
    Ok(PreparedGlobal {
        exposure: parameters.exposure.exp2(),
        offset: parameters.brightness * 0.002,
        black_pivot: parameters.black_point * 0.002,
        contrast: (parameters.contrast / 100.0).exp2(),
        saturation: 1.0 + parameters.saturation / 100.0,
        white_balance: white_balance_matrix(parameters.temperature_offset_k, parameters.tint)?,
        cast: parameters.cast * 0.001,
    })
}

fn grade_pixel(source: [f32; 3], parameters: PreparedGlobal) -> Result<[f32; 3], String> {
    if !source.into_iter().all(f32::is_finite) {
        return Err("global develop artifact contains a non-finite sample".to_owned());
    }
    let balanced = mat_vec(parameters.white_balance, source.map(f64::from));
    let casted = [
        balanced[0] * f64::from(1.0 + parameters.cast),
        balanced[1] * f64::from(1.0 - parameters.cast),
        balanced[2] * f64::from(1.0 + parameters.cast),
    ];
    let mut graded = casted.map(|sample| sample as f32).map(|sample| {
        let exposed = ((sample + parameters.offset - parameters.black_pivot)
            / (1.0 - parameters.black_pivot))
            * parameters.exposure;
        if parameters.contrast == 1.0 {
            exposed
        } else {
            (exposed.abs() / 0.18).powf(parameters.contrast) * exposed.signum() * 0.18
        }
    });
    if parameters.saturation != 1.0 {
        let luma = graded[0] * REC2020_TO_XYZ[1][0] as f32
            + graded[1] * REC2020_TO_XYZ[1][1] as f32
            + graded[2] * REC2020_TO_XYZ[1][2] as f32;
        graded = graded.map(|sample| luma + parameters.saturation * (sample - luma));
    }
    if !graded.into_iter().all(f32::is_finite) {
        return Err("global develop produced a non-finite sample".to_owned());
    }
    Ok(graded)
}

fn white_balance_matrix(temperature_offset_k: f32, tint: f32) -> Result<[[f64; 3]; 3], String> {
    if !temperature_offset_k.is_finite() || !tint.is_finite() {
        return Err("white balance adjustments must be finite".to_owned());
    }
    if temperature_offset_k == 0.0 && tint == 0.0 {
        return Ok([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]);
    }
    // Positive temperature is the familiar warmer direction, hence the lower target CCT.
    let temperature = (6_504.0 - f64::from(temperature_offset_k)).clamp(1_667.0, 25_000.0);
    let planckian_d65 = planckian_xy(6_504.0);
    let planckian_target = planckian_xy(temperature);
    let d65_sum = D65_XYZ.into_iter().sum::<f64>();
    let d65_x = D65_XYZ[0] / d65_sum;
    let d65_y = D65_XYZ[1] / d65_sum;
    let x = d65_x + planckian_target.0 - planckian_d65.0;
    let mut y = d65_y + planckian_target.1 - planckian_d65.1;
    y = (y - f64::from(tint) * 0.0005).clamp(0.05, 0.9);
    let target_xyz = [x / y, 1.0, (1.0 - x - y) / y];
    let source_cone = mat_vec(BRADFORD, D65_XYZ);
    let target_cone = mat_vec(BRADFORD, target_xyz);
    let cone_scale = [
        [target_cone[0] / source_cone[0], 0.0, 0.0],
        [0.0, target_cone[1] / source_cone[1], 0.0],
        [0.0, 0.0, target_cone[2] / source_cone[2]],
    ];
    let xyz_adaptation = multiply_3x3(BRADFORD_INVERSE, multiply_3x3(cone_scale, BRADFORD));
    let xyz_to_rec2020 = invert_3x3(REC2020_TO_XYZ)?;
    Ok(multiply_3x3(
        xyz_to_rec2020,
        multiply_3x3(xyz_adaptation, REC2020_TO_XYZ),
    ))
}

fn planckian_xy(temperature: f64) -> (f64, f64) {
    let x = if temperature <= 4_000.0 {
        -0.266_123_9e9 / temperature.powi(3) - 0.234_358_0e6 / temperature.powi(2)
            + 0.877_695_6e3 / temperature
            + 0.179_910
    } else {
        -3.025_846_9e9 / temperature.powi(3)
            + 2.107_037_9e6 / temperature.powi(2)
            + 0.222_634_7e3 / temperature
            + 0.240_390
    };
    let y = if temperature <= 2_222.0 {
        -1.106_381_4 * x.powi(3) - 1.348_110_2 * x.powi(2) + 2.185_558_32 * x - 0.202_196_83
    } else if temperature <= 4_000.0 {
        -0.954_947_6 * x.powi(3) - 1.374_185_93 * x.powi(2) + 2.091_370_15 * x - 0.167_488_67
    } else {
        3.081_758 * x.powi(3) - 5.873_386_7 * x.powi(2) + 3.751_129_97 * x - 0.370_014_83
    };
    (x, y)
}

pub(crate) fn camera_front(
    data: &[f32],
    white_level: f32,
    black_level: f32,
    cam_xyz: &[f64],
    as_shot_wb: &[f64],
    wb_pre_applied: bool,
) -> Result<Vec<f32>, String> {
    if data.len() % 3 != 0 || cam_xyz.len() != 9 || as_shot_wb.len() != 3 {
        return Err(
            "camera front expects RGB samples, a 3x3 matrix, and three WB gains".to_owned(),
        );
    }
    let range = white_level - black_level;
    if !range.is_finite() || range <= 0.0 {
        return Err("camera front requires a finite positive black/white range".to_owned());
    }
    if cam_xyz
        .iter()
        .chain(as_shot_wb)
        .any(|value| !value.is_finite())
    {
        return Err("camera front metadata must be finite".to_owned());
    }

    let mut xyz_to_camera = [[0.0; 3]; 3];
    for row in 0..3 {
        let response = (0..3)
            .map(|column| cam_xyz[row * 3 + column] * D65_XYZ[column])
            .sum::<f64>();
        if response.abs() < f64::EPSILON {
            return Err("camera matrix cannot normalize D65".to_owned());
        }
        for column in 0..3 {
            xyz_to_camera[row][column] = cam_xyz[row * 3 + column] / response;
        }
    }
    let camera_to_xyz = invert_3x3(xyz_to_camera)?;
    let camera_to_rec2020 = multiply_3x3(SRGB_TO_REC2020, multiply_3x3(XYZ_TO_SRGB, camera_to_xyz));

    let mut output = Vec::with_capacity(data.len());
    for pixel in data.chunks_exact(3) {
        let balanced = [
            level(pixel[0], black_level, range) * if wb_pre_applied { 1.0 } else { as_shot_wb[0] },
            level(pixel[1], black_level, range) * if wb_pre_applied { 1.0 } else { as_shot_wb[1] },
            level(pixel[2], black_level, range) * if wb_pre_applied { 1.0 } else { as_shot_wb[2] },
        ];
        output.extend(mat_vec(camera_to_rec2020, balanced).map(|sample| sample as f32));
    }
    Ok(output)
}

pub(crate) fn display_srgb_to_linear_rec2020(samples: &[u16]) -> Result<Vec<f32>, String> {
    if samples.len() % 3 != 0 {
        return Err("display conversion expects interleaved RGB samples".to_owned());
    }
    let mut output = Vec::with_capacity(samples.len());
    for pixel in samples.chunks_exact(3) {
        let linear =
            [pixel[0], pixel[1], pixel[2]].map(|sample| inverse_srgb(f64::from(sample) / 65_535.0));
        for row in SRGB_TO_REC2020 {
            output.push((row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]) as f32);
        }
    }
    Ok(output)
}

pub(crate) fn linear_rec2020_to_display_srgb(samples: &[f32]) -> Result<Vec<f32>, String> {
    if samples.len() % 3 != 0 {
        return Err("display conversion expects interleaved RGB samples".to_owned());
    }
    let mut output = Vec::with_capacity(samples.len());
    for pixel in samples.chunks_exact(3) {
        output.extend(
            mat_vec(
                REC2020_TO_SRGB,
                [
                    f64::from(pixel[0]),
                    f64::from(pixel[1]),
                    f64::from(pixel[2]),
                ],
            )
            .map(|sample| srgb_transfer(sample) as f32),
        );
    }
    Ok(output)
}

fn level(value: f32, black_level: f32, range: f32) -> f64 {
    f64::from(((value - black_level) / range).max(0.0))
}

fn inverse_srgb(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn srgb_transfer(value: f64) -> f64 {
    let magnitude = value.abs();
    value.signum()
        * if magnitude <= 0.003_130_8 {
            12.92 * magnitude
        } else {
            1.055 * magnitude.powf(1.0 / 2.4) - 0.055
        }
}

fn multiply_3x3(left: [[f64; 3]; 3], right: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| {
        std::array::from_fn(|column| {
            (0..3)
                .map(|index| left[row][index] * right[index][column])
                .sum()
        })
    })
}

fn mat_vec(matrix: [[f64; 3]; 3], vector: [f64; 3]) -> [f64; 3] {
    matrix.map(|row| row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2])
}

fn invert_3x3(matrix: [[f64; 3]; 3]) -> Result<[[f64; 3]; 3], String> {
    let [a, b, c] = matrix;
    let determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0]);
    if !determinant.is_finite() || determinant.abs() < 1e-12 {
        return Err("camera matrix is singular".to_owned());
    }
    let inverse = 1.0 / determinant;
    Ok([
        [
            (b[1] * c[2] - b[2] * c[1]) * inverse,
            (a[2] * c[1] - a[1] * c[2]) * inverse,
            (a[1] * b[2] - a[2] * b[1]) * inverse,
        ],
        [
            (b[2] * c[0] - b[0] * c[2]) * inverse,
            (a[0] * c[2] - a[2] * c[0]) * inverse,
            (a[2] * b[0] - a[0] * b[2]) * inverse,
        ],
        [
            (b[0] * c[1] - b[1] * c[0]) * inverse,
            (a[1] * c[0] - a[0] * c[1]) * inverse,
            (a[0] * b[1] - a[1] * b[0]) * inverse,
        ],
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply_global(data: &[f32], parameters: GlobalDevelop) -> Result<Vec<f32>, String> {
        let mut output = data.to_vec();
        apply_global_in_place(&mut output, parameters)?;
        Ok(output)
    }

    #[test]
    fn global_exposure_is_one_stop_per_unit_in_scene_linear_space() {
        let mut actual = vec![0.05, 0.18, 0.4, -0.1, 0.0, 1.2];
        let allocation = actual.as_ptr();
        apply_global_in_place(
            &mut actual,
            GlobalDevelop {
                exposure: 1.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();

        assert_eq!(
            actual.as_ptr(),
            allocation,
            "global develop must reuse its owned input buffer"
        );
        assert_eq!(actual, vec![0.1, 0.36, 0.8, -0.2, 0.0, 2.4]);
    }

    #[test]
    fn global_brightness_is_an_ocio_primary_offset() {
        let input = [0.1, 0.25, 0.8];
        let actual = apply_global(
            &input,
            GlobalDevelop {
                brightness: 25.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();

        assert_eq!(actual, vec![0.15, 0.3, 0.85]);
    }

    #[test]
    fn global_contrast_uses_ocio_scene_linear_power_about_point_eighteen() {
        let input = [0.045, 0.18, 0.72];
        let actual = apply_global(
            &input,
            GlobalDevelop {
                contrast: 100.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();

        for (actual, expected) in actual.iter().zip([0.01125, 0.18, 2.88]) {
            assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
        }
    }

    #[test]
    fn global_saturation_uses_ocio_luminance_mix() {
        let input = [0.8, 0.2, 0.1];
        let actual = apply_global(
            &input,
            GlobalDevelop {
                saturation: -100.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();
        let luma = 0.262_700_2 * 0.8 + 0.677_998_1 * 0.2 + 0.059_301_7 * 0.1;

        for sample in actual {
            assert!((sample - luma).abs() < 1e-6, "{sample} != {luma}");
        }
    }

    #[test]
    fn global_saturation_preserves_rec2020_luminance() {
        let input = [0.8, 0.2, 0.1];
        let actual = apply_global(
            &input,
            GlobalDevelop {
                saturation: 75.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();
        let luminance = |pixel: &[f32]| {
            0.262_700_2 * pixel[0] + 0.677_998_1 * pixel[1] + 0.059_301_7 * pixel[2]
        };

        assert!((luminance(&actual) - luminance(&input)).abs() < 1e-6);
    }

    #[test]
    fn global_black_point_moves_the_black_pivot_while_preserving_white() {
        let input = [0.1, 0.5, 1.0];
        let actual = apply_global(
            &input,
            GlobalDevelop {
                black_point: 50.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();

        for (actual, expected) in actual.iter().zip([0.0, 4.0 / 9.0, 1.0]) {
            assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
        }
    }

    #[test]
    fn white_balance_uses_bradford_adaptation_in_rec2020() {
        let neutral = [0.4, 0.4, 0.4];
        let warm = apply_global(
            &neutral,
            GlobalDevelop {
                temperature_offset_k: 1_000.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();
        let cool = apply_global(
            &neutral,
            GlobalDevelop {
                temperature_offset_k: -1_000.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();

        assert!(
            warm[0] > warm[2],
            "warm balance must raise red relative to blue: {warm:?}"
        );
        assert!(
            (warm[0] - warm[2]).abs() > 0.02,
            "warm adjustment must be observable: {warm:?}"
        );
        assert!(
            cool[2] > cool[0],
            "cool balance must raise blue relative to red: {cool:?}"
        );
    }

    #[test]
    fn white_balance_is_continuous_at_d65_zero() {
        let neutral = [0.4, 0.4, 0.4];
        let zero = apply_global(&neutral, GlobalDevelop::default()).unwrap();
        let near_zero = apply_global(
            &neutral,
            GlobalDevelop {
                temperature_offset_k: 0.001,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();

        for (actual, expected) in near_zero.iter().zip(zero) {
            assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
        }
    }

    #[test]
    fn tint_and_cast_move_opposite_green_magenta_axes() {
        let neutral = [0.4, 0.4, 0.4];
        let tinted = apply_global(
            &neutral,
            GlobalDevelop {
                tint: 50.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();
        let casted = apply_global(
            &neutral,
            GlobalDevelop {
                cast: 50.0,
                ..GlobalDevelop::default()
            },
        )
        .unwrap();

        assert!(
            (tinted[0] + tinted[2]) * 0.5 > tinted[1],
            "positive tint is magenta: {tinted:?}"
        );
        assert!(
            (casted[0] + casted[2]) * 0.5 > casted[1],
            "positive cast is magenta: {casted:?}"
        );
    }

    #[test]
    fn camera_front_inverts_libraws_row_normalized_cam_xyz_convention() {
        let matrix = [
            0.7460, -0.2365, -0.0588, -0.5687, 1.3442, 0.2474, -0.0624, 0.1156, 0.6584,
        ];
        let balanced_camera = [0.059_114_76, 0.666_771_2, 0.693_244_16];
        let actual = camera_front(&balanced_camera, 1.0, 0.0, &matrix, &[1.0; 3], true).unwrap();

        let expected_xyz = [0.25, 0.5, 0.75];
        let expected = mat_vec(SRGB_TO_REC2020, mat_vec(XYZ_TO_SRGB, expected_xyz));
        for (actual, expected) in actual.iter().zip(expected) {
            assert!(
                (f64::from(*actual) - expected).abs() < 2e-5,
                "{actual} != {expected}"
            );
        }
    }

    #[test]
    fn display_conversion_maps_srgb_primaries_into_rec2020() {
        let actual = display_srgb_to_linear_rec2020(&[65_535, 0, 0]).unwrap();
        for (actual, expected) in actual.iter().zip(SRGB_TO_REC2020.map(|row| row[0])) {
            assert!((f64::from(*actual) - expected).abs() < 1e-6);
        }
    }

    #[test]
    fn display_transfer_reflects_negative_linear_values() {
        let actual = linear_rec2020_to_display_srgb(&[-0.01, -0.01, -0.01]).unwrap();
        assert!(actual.iter().all(|sample| *sample < 0.0));
    }
}
