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
