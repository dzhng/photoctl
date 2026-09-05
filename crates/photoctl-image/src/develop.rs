const D65_XYZ: [f64; 3] = [0.95047, 1.0, 1.08883];
const BRILLIANCE_RADIUS: usize = 15;
const BRILLIANCE_STOPS_AT_FULL_SCALE: f32 = 0.2;
const DEFINITION_RADIUS_FRACTION: f32 = 0.03;
const DEFINITION_GAIN_AT_FULL_SCALE: f32 = 0.25;
const SHARPEN_GAIN_AT_FULL_SCALE: f32 = 0.5;
mod noise_reduction;

use crate::tone_curve::{ToneCurve, from_log, prepare as prepare_tone_curve, to_log};
use std::collections::VecDeque;

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

#[derive(Clone, Debug, Default)]
pub(crate) struct Develop {
    pub brilliance: f32,
    pub exposure: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub vibrance: f32,
    pub black_point: f32,
    pub temperature_offset_k: f32,
    pub tint: f32,
    pub cast: f32,
    pub curves: Option<CurveParameters>,
    pub levels: Option<LevelsParameters>,
    pub definition: f32,
    pub sharpen: f32,
    pub noise_reduction_luminance: f32,
    pub noise_reduction_color: f32,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct CurveParameters {
    pub rgb: Option<Vec<Vec<f32>>>,
    pub red: Option<Vec<Vec<f32>>>,
    pub green: Option<Vec<Vec<f32>>>,
    pub blue: Option<Vec<Vec<f32>>>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct LevelsParameters {
    pub black: f32,
    pub midpoint: f32,
    pub white: f32,
}

pub(crate) fn apply_global_in_place(data: &mut [f32], parameters: Develop) -> Result<(), String> {
    if data.len() % 3 != 0 {
        return Err("global develop expects interleaved RGB samples".to_owned());
    }
    let prepared = prepare_global(parameters)?;
    for destination in data.chunks_exact_mut(3) {
        destination.copy_from_slice(&grade_pixel(
            [destination[0], destination[1], destination[2]],
            &prepared,
        )?);
    }
    Ok(())
}

pub(crate) fn apply_develop_artifact_in_place(
    data: &mut [u8],
    pixel_offset: usize,
    pixel_bytes: usize,
    width: usize,
    height: usize,
    parameters: Develop,
) -> Result<(), String> {
    if width == 0
        || height == 0
        || width
            .checked_mul(height)
            .and_then(|pixels| pixels.checked_mul(12))
            != Some(pixel_bytes)
        || pixel_offset.checked_add(pixel_bytes) != Some(data.len())
    {
        return Err("develop artifact has an invalid pixel span".to_owned());
    }
    let local = LocalDevelop::from(&parameters);
    apply_global_artifact_in_place(data, pixel_offset, pixel_bytes, width, height, parameters)?;
    if !local.is_identity() {
        apply_local_bytes_in_place(&mut data[pixel_offset..], width, height, local)?;
    }
    Ok(())
}

pub(crate) fn apply_delta_artifact_in_place(
    data: &mut [u8],
    pixel_offset: usize,
    pixel_bytes: usize,
    width: usize,
    height: usize,
    parameters: Develop,
) -> Result<(), String> {
    apply_global_artifact_in_place(data, pixel_offset, pixel_bytes, width, height, parameters)
}

fn apply_global_artifact_in_place(
    data: &mut [u8],
    pixel_offset: usize,
    pixel_bytes: usize,
    width: usize,
    height: usize,
    parameters: Develop,
) -> Result<(), String> {
    if width == 0
        || height == 0
        || width
            .checked_mul(height)
            .and_then(|pixels| pixels.checked_mul(12))
            != Some(pixel_bytes)
        || pixel_offset.checked_add(pixel_bytes) != Some(data.len())
    {
        return Err("global develop artifact has an invalid pixel span".to_owned());
    }
    let prepared = prepare_global(parameters)?;
    for pixel in data[pixel_offset..].chunks_exact_mut(12) {
        let source = [
            f32::from_le_bytes(pixel[0..4].try_into().unwrap()),
            f32::from_le_bytes(pixel[4..8].try_into().unwrap()),
            f32::from_le_bytes(pixel[8..12].try_into().unwrap()),
        ];
        let graded = grade_pixel(source, &prepared)?;
        for (channel, sample) in graded.into_iter().enumerate() {
            pixel[channel * 4..channel * 4 + 4].copy_from_slice(&sample.to_le_bytes());
        }
    }
    Ok(())
}

pub(crate) fn apply_develop_in_place(
    data: &mut [f32],
    width: usize,
    height: usize,
    parameters: Develop,
) -> Result<(), String> {
    if width == 0
        || height == 0
        || width
            .checked_mul(height)
            .and_then(|pixels| pixels.checked_mul(3))
            != Some(data.len())
    {
        return Err("develop dimensions do not match interleaved RGB samples".to_owned());
    }
    let local = LocalDevelop::from(&parameters);
    apply_global_in_place(data, parameters)?;
    apply_local_in_place(data, width, height, local)
}

#[derive(Clone, Copy)]
struct LocalDevelop {
    brilliance: f32,
    definition: f32,
    sharpen: f32,
    noise_reduction_luminance: f32,
    noise_reduction_color: f32,
}

impl From<&Develop> for LocalDevelop {
    fn from(parameters: &Develop) -> Self {
        Self {
            brilliance: parameters.brilliance / 100.0,
            definition: parameters.definition / 100.0 * DEFINITION_GAIN_AT_FULL_SCALE,
            sharpen: parameters.sharpen / 100.0 * SHARPEN_GAIN_AT_FULL_SCALE,
            noise_reduction_luminance: parameters.noise_reduction_luminance / 100.0,
            noise_reduction_color: parameters.noise_reduction_color / 100.0,
        }
    }
}

impl LocalDevelop {
    fn is_identity(self) -> bool {
        self.brilliance == 0.0
            && self.definition == 0.0
            && self.sharpen == 0.0
            && self.noise_reduction_luminance == 0.0
            && self.noise_reduction_color == 0.0
    }
}

fn apply_local_bytes_in_place(
    data: &mut [u8],
    width: usize,
    height: usize,
    parameters: LocalDevelop,
) -> Result<(), String> {
    apply_local_operators(data, width, height, parameters);
    if data
        .chunks_exact(4)
        .any(|sample| !f32::from_le_bytes(sample.try_into().unwrap()).is_finite())
    {
        return Err("local develop produced a non-finite sample".to_owned());
    }
    Ok(())
}

fn apply_local_in_place(
    data: &mut [f32],
    width: usize,
    height: usize,
    parameters: LocalDevelop,
) -> Result<(), String> {
    apply_local_operators(data, width, height, parameters);
    if data.iter().any(|sample| !sample.is_finite()) {
        return Err("local develop produced a non-finite sample".to_owned());
    }
    Ok(())
}

fn apply_local_operators<S: SampleStorage + ?Sized>(
    data: &mut S,
    width: usize,
    height: usize,
    parameters: LocalDevelop,
) {
    if parameters.brilliance != 0.0 {
        apply_box_operator(
            data,
            width,
            height,
            BRILLIANCE_RADIUS,
            BoxOperator::Brilliance(parameters.brilliance),
        );
    }
    if parameters.definition != 0.0 {
        apply_box_operator(
            data,
            width,
            height,
            ((width.max(height) as f32 * DEFINITION_RADIUS_FRACTION).round() as usize).max(1),
            BoxOperator::Unsharp(parameters.definition),
        );
    }
    if parameters.sharpen != 0.0 {
        apply_box_operator(
            data,
            width,
            height,
            1,
            BoxOperator::Unsharp(parameters.sharpen),
        );
    }
    if parameters.noise_reduction_luminance != 0.0 {
        noise_reduction::apply(
            data,
            width,
            height,
            noise_reduction::Component::Luminance,
            parameters.noise_reduction_luminance,
        );
    }
    if parameters.noise_reduction_color != 0.0 {
        noise_reduction::apply(
            data,
            width,
            height,
            noise_reduction::Component::Color,
            parameters.noise_reduction_color,
        );
    }
}

trait SampleStorage {
    fn read_sample(&self, index: usize) -> f32;
    fn write_sample(&mut self, index: usize, sample: f32);
}

impl SampleStorage for [f32] {
    fn read_sample(&self, index: usize) -> f32 {
        self[index]
    }

    fn write_sample(&mut self, index: usize, sample: f32) {
        self[index] = sample;
    }
}

impl SampleStorage for [u8] {
    fn read_sample(&self, index: usize) -> f32 {
        let offset = index * 4;
        f32::from_le_bytes(self[offset..offset + 4].try_into().unwrap())
    }

    fn write_sample(&mut self, index: usize, sample: f32) {
        let offset = index * 4;
        self[offset..offset + 4].copy_from_slice(&sample.to_le_bytes());
    }
}

#[derive(Clone, Copy)]
enum BoxOperator {
    Brilliance(f32),
    Unsharp(f32),
}

impl BoxOperator {
    fn channels(self) -> usize {
        match self {
            Self::Brilliance(_) => 1,
            Self::Unsharp(_) => 3,
        }
    }

    fn source<S: SampleStorage + ?Sized>(self, data: &S, pixel: usize, channel: usize) -> f32 {
        match self {
            Self::Brilliance(_) => rec2020_luminance([
                data.read_sample(pixel * 3),
                data.read_sample(pixel * 3 + 1),
                data.read_sample(pixel * 3 + 2),
            ]),
            Self::Unsharp(_) => data.read_sample(pixel * 3 + channel),
        }
    }

    fn apply<S: SampleStorage + ?Sized>(self, data: &mut S, pixel: usize, blurred: &[f32]) {
        match self {
            Self::Brilliance(amount) => {
                let source = [
                    data.read_sample(pixel * 3),
                    data.read_sample(pixel * 3 + 1),
                    data.read_sample(pixel * 3 + 2),
                ];
                let luma = rec2020_luminance(source);
                let difference = meaningful_difference(luma, blurred[0]);
                let local_contrast = (difference / blurred[0].abs().max(0.18)).clamp(-1.0, 1.0);
                let gain = (BRILLIANCE_STOPS_AT_FULL_SCALE * amount * local_contrast).exp2();
                for (channel, sample) in source.into_iter().enumerate() {
                    data.write_sample(pixel * 3 + channel, sample * gain);
                }
            }
            Self::Unsharp(amount) => {
                for (channel, reference) in blurred.iter().copied().enumerate() {
                    let index = pixel * 3 + channel;
                    let sample = data.read_sample(index);
                    data.write_sample(
                        index,
                        sample + amount * meaningful_difference(sample, reference),
                    );
                }
            }
        }
    }
}

fn meaningful_difference(value: f32, reference: f32) -> f32 {
    let difference = value - reference;
    if difference.abs() <= 8.0 * f32::EPSILON * value.abs().max(reference.abs()).max(1.0) {
        0.0
    } else {
        difference
    }
}

fn apply_box_operator<S: SampleStorage + ?Sized>(
    data: &mut S,
    width: usize,
    height: usize,
    radius: usize,
    operator: BoxOperator,
) {
    // Scan along the long axis so the delayed output ring stays a radius-sized fraction of a
    // frame even for panoramas. A source slice is overwritten only after it leaves the window.
    let scan_rows = height >= width;
    let scan_length = if scan_rows { height } else { width };
    let slice_length = if scan_rows { width } else { height };
    let channels = operator.channels();
    let pixel_at = |scan: usize, slice: usize| {
        if scan_rows {
            scan * width + slice
        } else {
            slice * width + scan
        }
    };
    let mut columns = vec![0.0_f64; slice_length * channels];
    for scan in 0..=radius.min(scan_length - 1) {
        for slice in 0..slice_length {
            let pixel = pixel_at(scan, slice);
            for channel in 0..channels {
                columns[slice * channels + channel] +=
                    f64::from(operator.source(data, pixel, channel));
            }
        }
    }
    let mut pending = VecDeque::with_capacity(radius.min(scan_length) + 1);
    let mut next_write = 0;
    for scan in 0..scan_length {
        let scan_start = scan.saturating_sub(radius);
        let scan_end = scan.saturating_add(radius).min(scan_length - 1);
        let mut output = vec![0.0; slice_length * channels];
        for channel in 0..channels {
            let mut sum = 0.0_f64;
            for slice in 0..=radius.min(slice_length - 1) {
                sum += columns[slice * channels + channel];
            }
            for slice in 0..slice_length {
                let slice_start = slice.saturating_sub(radius);
                let slice_end = slice.saturating_add(radius).min(slice_length - 1);
                output[slice * channels + channel] = (sum
                    / ((slice_end - slice_start + 1) * (scan_end - scan_start + 1)) as f64)
                    as f32;
                let next_start = (slice + 1).saturating_sub(radius);
                let next_end = (slice + 1).saturating_add(radius).min(slice_length - 1);
                if next_start > slice_start {
                    sum -= columns[slice_start * channels + channel];
                }
                if next_end > slice_end {
                    sum += columns[(slice_end + 1) * channels + channel];
                }
            }
        }
        pending.push_back(output);
        let next_start = (scan + 1).saturating_sub(radius);
        let next_end = (scan + 1).saturating_add(radius).min(scan_length - 1);
        if next_start > scan_start {
            for slice in 0..slice_length {
                let pixel = pixel_at(scan_start, slice);
                for channel in 0..channels {
                    columns[slice * channels + channel] -=
                        f64::from(operator.source(data, pixel, channel));
                }
            }
        }
        if next_end > scan_end {
            for slice in 0..slice_length {
                let pixel = pixel_at(scan_end + 1, slice);
                for channel in 0..channels {
                    columns[slice * channels + channel] +=
                        f64::from(operator.source(data, pixel, channel));
                }
            }
        }
        if next_start > scan_start {
            apply_output_slice(
                data,
                &pixel_at,
                next_write,
                pending.pop_front().unwrap(),
                operator,
                channels,
            );
            next_write += 1;
        }
    }
    for output in pending {
        apply_output_slice(data, &pixel_at, next_write, output, operator, channels);
        next_write += 1;
    }
}

fn apply_output_slice<S: SampleStorage + ?Sized>(
    data: &mut S,
    pixel_at: &impl Fn(usize, usize) -> usize,
    scan: usize,
    output: Vec<f32>,
    operator: BoxOperator,
    channels: usize,
) {
    for (slice, blurred) in output.chunks_exact(channels).enumerate() {
        operator.apply(data, pixel_at(scan, slice), blurred);
    }
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

#[derive(Clone)]
struct PreparedGlobal {
    exposure: f32,
    highlights: f32,
    shadows: f32,
    offset: f32,
    black_pivot: f32,
    contrast: f32,
    saturation: f32,
    vibrance: f32,
    white_balance: [[f64; 3]; 3],
    cast: f32,
    curves: PreparedCurves,
    levels: Option<LevelsParameters>,
}

#[derive(Clone, Default)]
struct PreparedCurves {
    rgb: Option<ToneCurve>,
    channels: [Option<ToneCurve>; 3],
}

fn prepare_global(parameters: Develop) -> Result<PreparedGlobal, String> {
    // Primary order and equations follow OpenColorIO's BSD-3 GradingPrimary LIN renderer;
    // the control normalizations below are photoctl data, not copied implementation code.
    Ok(PreparedGlobal {
        exposure: parameters.exposure.exp2(),
        highlights: parameters.highlights / 100.0,
        shadows: parameters.shadows / 100.0,
        offset: parameters.brightness * 0.002,
        black_pivot: parameters.black_point * 0.002,
        contrast: (parameters.contrast / 100.0).exp2(),
        saturation: 1.0 + parameters.saturation / 100.0,
        vibrance: parameters.vibrance / 100.0,
        white_balance: white_balance_matrix(parameters.temperature_offset_k, parameters.tint)?,
        cast: parameters.cast * 0.001,
        curves: prepare_curves(parameters.curves)?,
        levels: prepare_levels(parameters.levels)?,
    })
}

fn grade_pixel(source: [f32; 3], parameters: &PreparedGlobal) -> Result<[f32; 3], String> {
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
    if parameters.shadows != 0.0 {
        let luminance = rec2020_luminance(graded);
        let mask = 1.0 - smoothstep(0.05, 0.5, luminance);
        graded = apply_tonal_gain(graded, parameters.shadows, mask);
    }
    if parameters.highlights != 0.0 {
        let mask = smoothstep(0.18, 1.0, rec2020_luminance(graded));
        graded = apply_tonal_gain(graded, parameters.highlights, mask);
    }
    if parameters.saturation != 1.0 {
        let luma = rec2020_luminance(graded);
        graded = graded.map(|sample| luma + parameters.saturation * (sample - luma));
    }
    if parameters.vibrance != 0.0 {
        let maximum = graded.into_iter().fold(f32::NEG_INFINITY, f32::max);
        let minimum = graded.into_iter().fold(f32::INFINITY, f32::min);
        let saturation = ((maximum - minimum) / maximum.abs().max(1e-6)).clamp(0.0, 1.0);
        let luma = rec2020_luminance(graded);
        let skin_protection = 1.0 - 0.75 * skin_hue_weight(graded);
        let factor = 1.0 + parameters.vibrance * (1.0 - saturation) * skin_protection;
        graded = graded.map(|sample| luma + factor * (sample - luma));
    }
    if let Some(levels) = parameters.levels {
        graded = graded.map(|sample| apply_levels(sample, levels));
    }
    if parameters.curves.rgb.is_some() || parameters.curves.channels.iter().any(Option::is_some) {
        let mut encoded = graded.map(to_log);
        for (channel, curve) in parameters.curves.channels.iter().enumerate() {
            if let Some(curve) = curve {
                encoded[channel] = curve.evaluate(encoded[channel]);
            }
        }
        if let Some(curve) = &parameters.curves.rgb {
            encoded = encoded.map(|sample| curve.evaluate(sample));
        }
        graded = encoded.map(from_log);
    }
    if !graded.into_iter().all(f32::is_finite) {
        return Err("global develop produced a non-finite sample".to_owned());
    }
    Ok(graded)
}

fn prepare_levels(
    parameters: Option<LevelsParameters>,
) -> Result<Option<LevelsParameters>, String> {
    let Some(parameters) = parameters else {
        return Ok(None);
    };
    if !parameters.black.is_finite()
        || !parameters.midpoint.is_finite()
        || !parameters.white.is_finite()
        || !(0.0..=1.0).contains(&parameters.black)
        || !(0.0..=1.0).contains(&parameters.white)
        || parameters.black >= parameters.white
        || !(0.0..=10.0).contains(&parameters.midpoint)
        || parameters.midpoint == 0.0
    {
        return Err(
            "develop levels require normalized black/white and a positive midpoint".to_owned(),
        );
    }
    Ok(Some(parameters))
}

fn apply_levels(value: f32, parameters: LevelsParameters) -> f32 {
    let normalized = (value - parameters.black) / (parameters.white - parameters.black);
    normalized.signum() * normalized.abs().powf(parameters.midpoint.recip())
}

fn prepare_curves(parameters: Option<CurveParameters>) -> Result<PreparedCurves, String> {
    let Some(parameters) = parameters else {
        return Ok(PreparedCurves::default());
    };
    Ok(PreparedCurves {
        rgb: parameters
            .rgb
            .map(prepare_tone_curve)
            .transpose()?
            .flatten(),
        channels: [
            parameters
                .red
                .map(prepare_tone_curve)
                .transpose()?
                .flatten(),
            parameters
                .green
                .map(prepare_tone_curve)
                .transpose()?
                .flatten(),
            parameters
                .blue
                .map(prepare_tone_curve)
                .transpose()?
                .flatten(),
        ],
    })
}

fn apply_tonal_gain(pixel: [f32; 3], stops: f32, mask: f32) -> [f32; 3] {
    let gain = (stops * mask).exp2();
    pixel.map(|sample| sample * gain)
}

fn rec2020_luminance(pixel: [f32; 3]) -> f32 {
    pixel[0] * REC2020_TO_XYZ[1][0] as f32
        + pixel[1] * REC2020_TO_XYZ[1][1] as f32
        + pixel[2] * REC2020_TO_XYZ[1][2] as f32
}

fn skin_hue_weight(pixel: [f32; 3]) -> f32 {
    let display = REC2020_TO_SRGB
        .map(|row| row[0] as f32 * pixel[0] + row[1] as f32 * pixel[1] + row[2] as f32 * pixel[2]);
    let maximum = display.into_iter().fold(f32::NEG_INFINITY, f32::max);
    let minimum = display.into_iter().fold(f32::INFINITY, f32::min);
    let chroma = maximum - minimum;
    if chroma <= 1e-6 || maximum <= 0.0 {
        return 0.0;
    }
    let hue = if maximum == display[0] {
        60.0 * ((display[1] - display[2]) / chroma).rem_euclid(6.0)
    } else if maximum == display[1] {
        60.0 * ((display[2] - display[0]) / chroma + 2.0)
    } else {
        60.0 * ((display[0] - display[1]) / chroma + 4.0)
    };
    if (8.0..=45.0).contains(&hue) {
        1.0
    } else if hue < 8.0 {
        smoothstep(0.0, 8.0, hue)
    } else if hue < 60.0 {
        1.0 - smoothstep(45.0, 60.0, hue)
    } else {
        0.0
    }
}

fn smoothstep(start: f32, end: f32, value: f32) -> f32 {
    let position = ((value - start) / (end - start)).clamp(0.0, 1.0);
    position * position * (3.0 - 2.0 * position)
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

    fn apply_global(data: &[f32], parameters: Develop) -> Result<Vec<f32>, String> {
        let mut output = data.to_vec();
        apply_global_in_place(&mut output, parameters)?;
        Ok(output)
    }

    fn apply_develop(
        data: &[f32],
        width: usize,
        height: usize,
        parameters: Develop,
    ) -> Result<Vec<f32>, String> {
        let mut output = data.to_vec();
        apply_develop_in_place(&mut output, width, height, parameters)?;
        Ok(output)
    }

    #[test]
    fn global_exposure_is_one_stop_per_unit_in_scene_linear_space() {
        let mut actual = vec![0.05, 0.18, 0.4, -0.1, 0.0, 1.2];
        let allocation = actual.as_ptr();
        apply_global_in_place(
            &mut actual,
            Develop {
                exposure: 1.0,
                ..Develop::default()
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
            Develop {
                brightness: 25.0,
                ..Develop::default()
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
            Develop {
                contrast: 100.0,
                ..Develop::default()
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
            Develop {
                saturation: -100.0,
                ..Develop::default()
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
            Develop {
                saturation: 75.0,
                ..Develop::default()
            },
        )
        .unwrap();
        let luminance = |pixel: &[f32]| {
            0.262_700_2 * pixel[0] + 0.677_998_1 * pixel[1] + 0.059_301_7 * pixel[2]
        };

        assert!((luminance(&actual) - luminance(&input)).abs() < 1e-6);
    }

    #[test]
    fn highlights_follow_a_smooth_bright_luminance_mask() {
        let input = [0.02, 0.02, 0.02, 0.18, 0.18, 0.18, 1.2, 1.2, 1.2];
        let actual = apply_global(
            &input,
            Develop {
                highlights: -50.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert_eq!(&actual[..3], &input[..3]);
        assert_eq!(&actual[3..6], &input[3..6]);
        assert!(actual[6] < input[6] * 0.85 && actual[6] > 0.5);
    }

    #[test]
    fn shadows_follow_a_smooth_dark_luminance_mask() {
        let input = [0.02, 0.02, 0.02, 0.18, 0.18, 0.18, 1.2, 1.2, 1.2];
        let actual = apply_global(
            &input,
            Develop {
                shadows: 50.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert!(actual[0] > input[0] * 1.3);
        assert!(actual[3] > input[3]);
        assert_eq!(&actual[6..], &input[6..]);
    }

    #[test]
    fn vibrance_weights_low_saturation_and_protects_skin_hues() {
        let input = [
            0.36, 0.42, 0.38, // muted green
            0.1, 0.7, 0.25, // saturated green
            0.5, 0.3, 0.2, // warm skin hue
            0.2, 0.5, 0.3, // equal-saturation green hue
        ];
        let actual = apply_global(
            &input,
            Develop {
                vibrance: 80.0,
                ..Develop::default()
            },
        )
        .unwrap();
        let chroma = |pixel: &[f32]| {
            pixel.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                - pixel.iter().copied().fold(f32::INFINITY, f32::min)
        };
        let gain = |offset: usize| {
            chroma(&actual[offset..offset + 3]) / chroma(&input[offset..offset + 3])
        };

        assert!(gain(0) > gain(3) + 0.2);
        assert!(gain(6) < gain(9) - 0.15);
        for (before, after) in input.chunks_exact(3).zip(actual.chunks_exact(3)) {
            assert!(
                (rec2020_luminance(before.try_into().unwrap())
                    - rec2020_luminance(after.try_into().unwrap()))
                .abs()
                    < 1e-6
            );
        }
    }

    #[test]
    fn levels_apply_midpoint_gamma_without_clipping_extended_samples() {
        let input = [
            -0.4, -0.4, -0.4, 0.2, 0.2, 0.2, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1.4, 1.4, 1.4,
        ];
        let actual = apply_global(
            &input,
            Develop {
                levels: Some(LevelsParameters {
                    black: 0.2,
                    midpoint: 2.0,
                    white: 0.8,
                }),
                ..Develop::default()
            },
        )
        .unwrap();

        for (actual, expected) in
            actual
                .iter()
                .step_by(3)
                .zip([-1.0, 0.0, 0.5_f32.sqrt(), 1.0, 2.0_f32.sqrt()])
        {
            assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
        }
    }

    #[test]
    fn scene_linear_curve_uses_the_ocio_log_encoding_without_clipping() {
        let input = [0.18, 0.18, 0.18];
        let actual = apply_global(
            &input,
            Develop {
                curves: Some(CurveParameters {
                    rgb: Some(vec![vec![0.0, 0.0], vec![1.0, 0.5]]),
                    ..CurveParameters::default()
                }),
                ..Develop::default()
            },
        )
        .unwrap();

        for sample in actual {
            assert!((sample - 0.016_053_8).abs() < 1e-6, "{sample}");
        }
    }

    #[test]
    fn brilliance_uses_a_fixed_thirty_one_pixel_local_light_map() {
        let mut input = vec![0.2; 33 * 3];
        input[16 * 3..17 * 3].fill(0.8);
        let actual = apply_develop(
            &input,
            33,
            1,
            Develop {
                brilliance: 100.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert!(actual[16 * 3] > input[16 * 3]);
        assert!(actual[3] < input[3]);
        assert_eq!(actual[0], input[0]);
        assert_eq!(actual[32 * 3], input[32 * 3]);
    }

    #[test]
    fn definition_radius_is_three_percent_of_the_long_edge() {
        let mut input = vec![0.2; 100 * 3];
        input[50 * 3..51 * 3].fill(0.8);
        let actual = apply_develop(
            &input,
            100,
            1,
            Develop {
                definition: 100.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert!(actual[50 * 3] > input[50 * 3]);
        assert!(actual[47 * 3] < input[47 * 3]);
        assert_eq!(actual[46 * 3], input[46 * 3]);
    }

    #[test]
    fn sharpen_uses_a_one_pixel_radius() {
        let mut input = vec![0.2; 7 * 3];
        input[3 * 3..4 * 3].fill(0.8);
        let actual = apply_develop(
            &input,
            7,
            1,
            Develop {
                sharpen: 100.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert!(actual[3 * 3] > input[3 * 3]);
        assert!(actual[2 * 3] < input[2 * 3]);
        assert_eq!(actual[1 * 3], input[1 * 3]);
    }

    #[test]
    fn local_contrast_preserves_flat_extended_scene_linear_fields() {
        let input = vec![1.4, -0.2, 0.5].repeat(25);
        let actual = apply_develop(
            &input,
            5,
            5,
            Develop {
                brilliance: 100.0,
                definition: -100.0,
                sharpen: 100.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert_eq!(actual, input);
    }

    #[test]
    fn definition_preserves_a_full_resolution_long_edge_flat_field() {
        let input = vec![0.2; 7_008 * 3];
        let actual = apply_develop(
            &input,
            7_008,
            1,
            Develop {
                definition: 100.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert_eq!(actual, input);
    }

    #[test]
    fn local_contrast_has_one_fixed_operator_order() {
        let input = (0..17)
            .flat_map(|x| {
                let value = if x == 8 { 0.9 } else { 0.1 + x as f32 * 0.01 };
                [value, value * 0.8, value * 0.6]
            })
            .collect::<Vec<_>>();
        let parameters = Develop {
            brilliance: 35.0,
            definition: 45.0,
            sharpen: 55.0,
            ..Develop::default()
        };

        let combined = apply_develop(&input, 17, 1, parameters).unwrap();
        let brilliance = apply_develop(
            &input,
            17,
            1,
            Develop {
                brilliance: 35.0,
                ..Develop::default()
            },
        )
        .unwrap();
        let definition = apply_develop(
            &brilliance,
            17,
            1,
            Develop {
                definition: 45.0,
                ..Develop::default()
            },
        )
        .unwrap();
        let ordered = apply_develop(
            &definition,
            17,
            1,
            Develop {
                sharpen: 55.0,
                ..Develop::default()
            },
        )
        .unwrap();

        assert_eq!(combined, ordered);
    }

    #[test]
    fn luminance_nlm_reduces_impulse_noise_without_moving_chroma() {
        let mut input = vec![0.2, 0.1, 0.05].repeat(25);
        input[12 * 3..12 * 3 + 3].copy_from_slice(&[0.21, 0.11, 0.06]);

        let actual = apply_develop(
            &input,
            5,
            5,
            Develop {
                noise_reduction_luminance: 100.0,
                ..Develop::default()
            },
        )
        .unwrap();

        let center = &actual[12 * 3..12 * 3 + 3];
        assert!(rec2020_luminance(center.try_into().unwrap()) < 0.13);
        assert!((center[0] - center[1] - 0.1).abs() < 1e-6);
        assert!((center[1] - center[2] - 0.05).abs() < 1e-6);
    }

    #[test]
    fn color_nlm_reduces_chroma_noise_without_moving_luminance() {
        let mut input = vec![0.2; 25 * 3];
        let green = (0.2 - 0.262_700_2 * 0.21 - 0.059_301_7 * 0.19) / 0.677_998_1;
        input[12 * 3..12 * 3 + 3].copy_from_slice(&[0.21, green, 0.19]);

        let actual = apply_develop(
            &input,
            5,
            5,
            Develop {
                noise_reduction_color: 100.0,
                ..Develop::default()
            },
        )
        .unwrap();

        let before: [f32; 3] = input[12 * 3..12 * 3 + 3].try_into().unwrap();
        let after: [f32; 3] = actual[12 * 3..12 * 3 + 3].try_into().unwrap();
        let chroma = |pixel: [f32; 3]| {
            pixel.into_iter().fold(f32::NEG_INFINITY, f32::max)
                - pixel.into_iter().fold(f32::INFINITY, f32::min)
        };
        assert!(chroma(after) < chroma(before) * 0.75);
        assert!((rec2020_luminance(after) - rec2020_luminance(before)).abs() < 1e-6);
    }

    #[test]
    fn spatial_develop_rejects_dimensions_that_do_not_describe_the_buffer() {
        let mut input = vec![0.2; 6];

        let error = apply_develop_in_place(
            &mut input,
            1,
            1,
            Develop {
                sharpen: 20.0,
                ..Develop::default()
            },
        )
        .unwrap_err();

        assert_eq!(
            error,
            "develop dimensions do not match interleaved RGB samples"
        );
    }

    #[test]
    fn global_black_point_moves_the_black_pivot_while_preserving_white() {
        let input = [0.1, 0.5, 1.0];
        let actual = apply_global(
            &input,
            Develop {
                black_point: 50.0,
                ..Develop::default()
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
            Develop {
                temperature_offset_k: 1_000.0,
                ..Develop::default()
            },
        )
        .unwrap();
        let cool = apply_global(
            &neutral,
            Develop {
                temperature_offset_k: -1_000.0,
                ..Develop::default()
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
        let zero = apply_global(&neutral, Develop::default()).unwrap();
        let near_zero = apply_global(
            &neutral,
            Develop {
                temperature_offset_k: 0.001,
                ..Develop::default()
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
            Develop {
                tint: 50.0,
                ..Develop::default()
            },
        )
        .unwrap();
        let casted = apply_global(
            &neutral,
            Develop {
                cast: 50.0,
                ..Develop::default()
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
