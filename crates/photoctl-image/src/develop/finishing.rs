use super::{SampleStorage, rec2020_luminance, smoothstep};

#[derive(Clone, Copy, Debug)]
pub(crate) struct BlackAndWhiteParameters {
    pub intensity: f32,
    pub neutrals: f32,
    pub tone: f32,
    pub grain: f32,
}

#[derive(Clone, Debug)]
pub(crate) struct FilterParameters {
    pub name: String,
    pub strength: f32,
}

#[derive(Clone, Copy)]
struct FilterRecipe {
    exposure_stops: f32,
    contrast: f32,
    saturation: f32,
    channel_gain: [f32; 3],
    monochrome: bool,
}

pub(super) fn apply_bytes(
    data: &mut [u8],
    width: usize,
    black_and_white: Option<BlackAndWhiteParameters>,
    filter: Option<FilterParameters>,
) -> Result<(), String> {
    if black_and_white.is_none() && filter.is_none() {
        return Ok(());
    }
    apply(data, width, black_and_white, filter)?;
    if data
        .chunks_exact(4)
        .any(|sample| !f32::from_le_bytes(sample.try_into().unwrap()).is_finite())
    {
        return Err("finishing develop produced a non-finite sample".to_owned());
    }
    Ok(())
}

pub(super) fn apply_in_place(
    data: &mut [f32],
    width: usize,
    black_and_white: Option<BlackAndWhiteParameters>,
    filter: Option<FilterParameters>,
) -> Result<(), String> {
    if black_and_white.is_none() && filter.is_none() {
        return Ok(());
    }
    apply(data, width, black_and_white, filter)?;
    if data.iter().any(|sample| !sample.is_finite()) {
        return Err("finishing develop produced a non-finite sample".to_owned());
    }
    Ok(())
}

fn apply<S: SampleStorage + ?Sized>(
    data: &mut S,
    width: usize,
    black_and_white: Option<BlackAndWhiteParameters>,
    filter: Option<FilterParameters>,
) -> Result<(), String> {
    let filter = filter
        .map(|parameters| {
            if !(0.0..=1.0).contains(&parameters.strength) || !parameters.strength.is_finite() {
                return Err("develop filter strength must be finite and normalized".to_owned());
            }
            Ok((recipe(&parameters.name)?, parameters.strength))
        })
        .transpose()?;
    for index in 0..data.sample_count() / 3 {
        let mut pixel = [
            data.read_sample(index * 3),
            data.read_sample(index * 3 + 1),
            data.read_sample(index * 3 + 2),
        ];
        if let Some(parameters) = black_and_white {
            pixel = apply_black_and_white(pixel, index % width, index / width, parameters);
        }
        if let Some((recipe, strength)) = filter {
            if strength != 0.0 {
                let filtered = apply_filter(pixel, recipe);
                for channel in 0..3 {
                    pixel[channel] += strength * (filtered[channel] - pixel[channel]);
                }
            }
        }
        for (channel, sample) in pixel.into_iter().enumerate() {
            data.write_sample(index * 3 + channel, sample);
        }
    }
    Ok(())
}

fn recipe(name: &str) -> Result<FilterRecipe, String> {
    let recipe = match name {
        "vivid" => FilterRecipe::color(0.05, 1.08, 1.22, [1.0, 1.0, 1.0]),
        "vivid_warm" => FilterRecipe::color(0.05, 1.08, 1.20, [1.04, 1.0, 0.94]),
        "vivid_cool" => FilterRecipe::color(0.05, 1.08, 1.20, [0.96, 1.0, 1.05]),
        "dramatic" => FilterRecipe::color(-0.08, 1.28, 0.88, [1.0, 1.0, 1.0]),
        "dramatic_warm" => FilterRecipe::color(-0.08, 1.28, 0.86, [1.04, 1.0, 0.94]),
        "dramatic_cool" => FilterRecipe::color(-0.08, 1.28, 0.86, [0.96, 1.0, 1.05]),
        "mono" => FilterRecipe::monochrome(0.0, 1.08, [1.0, 1.0, 1.0]),
        "silvertone" => FilterRecipe::monochrome(0.08, 0.94, [1.025, 1.0, 0.94]),
        "noir" => FilterRecipe::monochrome(-0.12, 1.42, [1.0, 1.0, 1.0]),
        _ => return Err(format!("unknown develop filter: {name}")),
    };
    Ok(recipe)
}

impl FilterRecipe {
    const fn color(
        exposure_stops: f32,
        contrast: f32,
        saturation: f32,
        channel_gain: [f32; 3],
    ) -> Self {
        Self {
            exposure_stops,
            contrast,
            saturation,
            channel_gain,
            monochrome: false,
        }
    }

    const fn monochrome(exposure_stops: f32, contrast: f32, channel_gain: [f32; 3]) -> Self {
        Self {
            exposure_stops,
            contrast,
            saturation: 1.0,
            channel_gain,
            monochrome: true,
        }
    }
}

fn apply_black_and_white(
    pixel: [f32; 3],
    x: usize,
    y: usize,
    parameters: BlackAndWhiteParameters,
) -> [f32; 3] {
    let mut luminance = rec2020_luminance(pixel);
    luminance *= (parameters.intensity / 200.0).exp2();
    let middle_weight =
        smoothstep(0.02, 0.18, luminance) * (1.0 - smoothstep(0.45, 1.0, luminance));
    luminance += parameters.neutrals * 0.0012 * middle_weight;
    luminance = signed_contrast(luminance, (parameters.tone / 125.0).exp2());
    if parameters.grain != 0.0 {
        luminance += deterministic_grain(x, y) * parameters.grain * 0.00035;
    }
    [luminance; 3]
}

fn apply_filter(pixel: [f32; 3], recipe: FilterRecipe) -> [f32; 3] {
    let mut filtered =
        pixel.map(|sample| signed_contrast(sample * recipe.exposure_stops.exp2(), recipe.contrast));
    if recipe.monochrome {
        filtered = [rec2020_luminance(filtered); 3];
    } else {
        let luminance = rec2020_luminance(filtered);
        filtered = filtered.map(|sample| luminance + recipe.saturation * (sample - luminance));
    }
    [
        filtered[0] * recipe.channel_gain[0],
        filtered[1] * recipe.channel_gain[1],
        filtered[2] * recipe.channel_gain[2],
    ]
}

fn signed_contrast(value: f32, contrast: f32) -> f32 {
    let offset = value - 0.18;
    0.18 + offset.signum() * (offset.abs() / 0.18).powf(contrast) * 0.18
}

fn deterministic_grain(x: usize, y: usize) -> f32 {
    let mut bits = (x as u32).wrapping_mul(0x9e37_79b1) ^ (y as u32).wrapping_mul(0x85eb_ca77);
    bits ^= bits >> 16;
    bits = bits.wrapping_mul(0x7feb_352d);
    bits ^= bits >> 15;
    bits = bits.wrapping_mul(0x846c_a68b);
    bits ^= bits >> 16;
    (bits as f32 / u32::MAX as f32) * 2.0 - 1.0
}
