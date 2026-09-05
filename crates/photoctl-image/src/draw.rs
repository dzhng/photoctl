use fontdue::{Font, FontSettings};
use serde::Deserialize;

use crate::develop::display_srgb_to_linear_rec2020;

const FONT_BYTES: &[u8] = include_bytes!("../assets/InterVariable.ttf");
const MAX_ITEMS: usize = 2_048;
const MAX_POINTS: usize = 65_536;
const MAX_TEXT_RASTER_PIXELS: usize = 64_000_000;
const MAX_COORDINATE: f64 = 1_000_000.0;

type Point = [f64; 2];
type Bbox = [f64; 4];

struct Canvas {
    color: Vec<f32>,
    coverage: Option<Vec<f32>>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum MarkupItem {
    Text {
        at: Point,
        text: String,
        size_px: f64,
        color: String,
        id: String,
    },
    Arrow {
        from: Point,
        to: Point,
        width: f64,
        color: String,
        id: String,
    },
    Line {
        from: Point,
        to: Point,
        width: f64,
        color: String,
        id: String,
    },
    Rect {
        bbox: Bbox,
        width: f64,
        color: String,
        fill: Option<String>,
        id: String,
    },
    Ellipse {
        bbox: Bbox,
        width: f64,
        color: String,
        fill: Option<String>,
        id: String,
    },
    Path {
        points: Vec<Point>,
        width: f64,
        color: String,
        id: String,
    },
    Highlight {
        bbox: Bbox,
        color: String,
        opacity: f64,
        id: String,
    },
}

pub fn validate_markup_request(
    data: &[f32],
    width: u32,
    height: u32,
    json: &str,
) -> Result<(), String> {
    let samples = usize::try_from(width)
        .ok()
        .and_then(|value| value.checked_mul(height as usize))
        .and_then(|value| value.checked_mul(3))
        .ok_or_else(|| "markup dimensions overflow".to_owned())?;
    if width == 0 || height == 0 || data.len() != samples {
        return Err("markup dimensions do not match RGB pixels".to_owned());
    }
    if !data.iter().all(|sample| sample.is_finite()) {
        return Err("markup input pixels must be finite".to_owned());
    }
    let items: Vec<MarkupItem> =
        serde_json::from_str(json).map_err(|error| format!("invalid markup document: {error}"))?;
    validate_items(&items)
}

pub fn draw_markup(
    data: Vec<f32>,
    width: u32,
    height: u32,
    json: &str,
) -> Result<Vec<f32>, String> {
    validate_markup_request(&data, width, height, json)?;
    let mut canvas = Canvas {
        color: data,
        coverage: None,
    };
    let items: Vec<MarkupItem> =
        serde_json::from_str(json).map_err(|error| format!("invalid markup document: {error}"))?;
    let font = Font::from_bytes(FONT_BYTES, FontSettings::default())
        .map_err(|error| format!("bundled Inter font is invalid: {error}"))?;
    draw_items(&mut canvas, width, height, &items, &font)?;
    Ok(canvas.color)
}

fn draw_items(
    canvas: &mut Canvas,
    width: u32,
    height: u32,
    items: &[MarkupItem],
    font: &Font,
) -> Result<(), String> {
    for item in items {
        match item {
            MarkupItem::Text {
                at,
                text,
                size_px,
                color,
                ..
            } => draw_text(canvas, width, height, font, *at, text, *size_px, color)?,
            MarkupItem::Line {
                from,
                to,
                width: stroke,
                color,
                ..
            } => draw_segment(canvas, width, height, *from, *to, *stroke, color)?,
            MarkupItem::Arrow {
                from,
                to,
                width: stroke,
                color,
                ..
            } => {
                draw_segment(canvas, width, height, *from, *to, *stroke, color)?;
                let dx = from[0] - to[0];
                let dy = from[1] - to[1];
                let length = dx.hypot(dy);
                if length > 0.0 {
                    let head = (stroke * 5.0).max(8.0).min(length * 0.4);
                    for angle in [-0.55_f64, 0.55_f64] {
                        let cosine = angle.cos();
                        let sine = angle.sin();
                        let unit = [dx / length, dy / length];
                        let end = [
                            to[0] + head * (unit[0] * cosine - unit[1] * sine),
                            to[1] + head * (unit[0] * sine + unit[1] * cosine),
                        ];
                        draw_segment(canvas, width, height, *to, end, *stroke, color)?;
                    }
                }
            }
            MarkupItem::Path {
                points,
                width: stroke,
                color,
                ..
            } => {
                for pair in points.windows(2) {
                    draw_segment(canvas, width, height, pair[0], pair[1], *stroke, color)?;
                }
            }
            MarkupItem::Rect {
                bbox,
                width: stroke,
                color,
                fill,
                ..
            } => draw_rect(
                canvas,
                width,
                height,
                *bbox,
                *stroke,
                color,
                fill.as_deref(),
            )?,
            MarkupItem::Ellipse {
                bbox,
                width: stroke,
                color,
                fill,
                ..
            } => draw_ellipse(
                canvas,
                width,
                height,
                *bbox,
                *stroke,
                color,
                fill.as_deref(),
            )?,
            MarkupItem::Highlight {
                bbox,
                color,
                opacity,
                ..
            } => fill_bbox(canvas, width, height, *bbox, color, *opacity)?,
        }
    }
    Ok(())
}

pub fn draw_markup_overlay(
    width: u32,
    height: u32,
    json: &str,
) -> Result<(Vec<f32>, Vec<f32>), String> {
    let pixels = usize::try_from(width)
        .ok()
        .and_then(|value| value.checked_mul(height as usize))
        .ok_or_else(|| "markup dimensions overflow".to_owned())?;
    let samples = pixels
        .checked_mul(3)
        .ok_or_else(|| "markup dimensions overflow".to_owned())?;
    let items: Vec<MarkupItem> =
        serde_json::from_str(json).map_err(|error| format!("invalid markup document: {error}"))?;
    validate_items(&items)?;
    let font = Font::from_bytes(FONT_BYTES, FontSettings::default())
        .map_err(|error| format!("bundled Inter font is invalid: {error}"))?;
    let mut canvas = Canvas {
        color: vec![0.0; samples],
        coverage: Some(vec![0.0; pixels]),
    };
    draw_items(&mut canvas, width, height, &items, &font)?;
    Ok((canvas.color, canvas.coverage.unwrap_or_default()))
}

fn validate_items(items: &[MarkupItem]) -> Result<(), String> {
    if items.len() > MAX_ITEMS {
        return Err("markup document has too many items".to_owned());
    }
    let mut points = 0_usize;
    let mut text_raster_pixels = 0_usize;
    for item in items {
        let (coordinates, positive, colors, id) = match item {
            MarkupItem::Text {
                at,
                text,
                size_px,
                color,
                id,
            } => {
                let characters = text.chars().count();
                if characters == 0 || characters > 4_096 {
                    return Err("markup text length is invalid".to_owned());
                }
                if !size_px.is_finite() || *size_px <= 0.0 {
                    return Err("markup geometry must be finite and positive".to_owned());
                }
                let glyph_side = size_px.ceil() as usize;
                let estimated = glyph_side
                    .checked_mul(glyph_side)
                    .and_then(|pixels| pixels.checked_mul(characters))
                    .ok_or_else(|| "markup text raster budget overflow".to_owned())?;
                text_raster_pixels = text_raster_pixels
                    .checked_add(estimated)
                    .ok_or_else(|| "markup text raster budget overflow".to_owned())?;
                (vec![*at], vec![*size_px], vec![color], id)
            }
            MarkupItem::Arrow {
                from,
                to,
                width,
                color,
                id,
            }
            | MarkupItem::Line {
                from,
                to,
                width,
                color,
                id,
            } => (vec![*from, *to], vec![*width], vec![color], id),
            MarkupItem::Rect {
                bbox,
                width,
                color,
                fill,
                id,
            }
            | MarkupItem::Ellipse {
                bbox,
                width,
                color,
                fill,
                id,
            } => (
                vec![[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                vec![*width, bbox[2], bbox[3]],
                fill.iter().chain(std::iter::once(color)).collect(),
                id,
            ),
            MarkupItem::Path {
                points: path,
                width,
                color,
                id,
            } => {
                points = points
                    .checked_add(path.len())
                    .ok_or_else(|| "markup point count overflow".to_owned())?;
                (path.clone(), vec![*width], vec![color], id)
            }
            MarkupItem::Highlight {
                bbox,
                color,
                opacity: _,
                id,
            } => (
                vec![[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                vec![bbox[2], bbox[3]],
                vec![color],
                id,
            ),
        };
        if id.is_empty()
            || coordinates
                .iter()
                .flatten()
                .any(|value| !value.is_finite() || value.abs() > MAX_COORDINATE)
            || positive
                .iter()
                .any(|value| !value.is_finite() || *value <= 0.0 || *value > MAX_COORDINATE)
        {
            return Err("markup geometry must be finite and positive".to_owned());
        }
        if let MarkupItem::Highlight { opacity, .. } = item {
            if !opacity.is_finite() || !(0.0..=1.0).contains(opacity) {
                return Err("highlight opacity must be between 0 and 1".to_owned());
            }
        }
        for color in colors {
            parse_color(color)?;
        }
    }
    if points > MAX_POINTS {
        return Err("markup document has too many path points".to_owned());
    }
    if text_raster_pixels > MAX_TEXT_RASTER_PIXELS {
        return Err("markup text exceeds the rasterization budget".to_owned());
    }
    Ok(())
}

fn parse_color(value: &str) -> Result<([f32; 3], f64), String> {
    let hex = value
        .strip_prefix('#')
        .ok_or_else(|| "markup colors must use #RRGGBB or #RRGGBBAA".to_owned())?;
    if hex.len() != 6 && hex.len() != 8 {
        return Err("markup colors must use #RRGGBB or #RRGGBBAA".to_owned());
    }
    let byte = |offset| {
        u8::from_str_radix(&hex[offset..offset + 2], 16)
            .map_err(|_| "markup color contains invalid hex".to_owned())
    };
    let rgb = [byte(0)?, byte(2)?, byte(4)?];
    let converted = display_srgb_to_linear_rec2020(&rgb.map(|sample| u16::from(sample) * 257))?;
    Ok((
        [converted[0], converted[1], converted[2]],
        if hex.len() == 8 {
            f64::from(byte(6)?) / 255.0
        } else {
            1.0
        },
    ))
}

fn blend_pixel(
    canvas: &mut Canvas,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    color: [f32; 3],
    alpha: f64,
) {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return;
    }
    let coverage = alpha.clamp(0.0, 1.0) as f32;
    if coverage == 0.0 {
        return;
    }
    let offset = ((y as usize * width as usize) + x as usize) * 3;
    for channel in 0..3 {
        canvas.color[offset + channel] =
            canvas.color[offset + channel] * (1.0 - coverage) + color[channel] * coverage;
    }
    if let Some(mask) = &mut canvas.coverage {
        let pixel = y as usize * width as usize + x as usize;
        mask[pixel] = mask[pixel] * (1.0 - coverage) + coverage;
    }
}

fn fill_bbox(
    canvas: &mut Canvas,
    width: u32,
    height: u32,
    bbox: Bbox,
    color: &str,
    opacity: f64,
) -> Result<(), String> {
    let (rgb, alpha) = parse_color(color)?;
    let x0 = bbox[0].floor().max(0.0) as i32;
    let y0 = bbox[1].floor().max(0.0) as i32;
    let x1 = (bbox[0] + bbox[2]).ceil().min(width as f64) as i32;
    let y1 = (bbox[1] + bbox[3]).ceil().min(height as f64) as i32;
    for y in y0..y1 {
        for x in x0..x1 {
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            if px >= bbox[0] && px < bbox[0] + bbox[2] && py >= bbox[1] && py < bbox[1] + bbox[3] {
                blend_pixel(canvas, width, height, x, y, rgb, alpha * opacity);
            }
        }
    }
    Ok(())
}

fn draw_rect(
    canvas: &mut Canvas,
    width: u32,
    height: u32,
    bbox: Bbox,
    stroke: f64,
    color: &str,
    fill: Option<&str>,
) -> Result<(), String> {
    if let Some(fill) = fill {
        fill_bbox(canvas, width, height, bbox, fill, 1.0)?;
    }
    let (rgb, alpha) = parse_color(color)?;
    let x0 = bbox[0].floor().max(0.0) as i32;
    let y0 = bbox[1].floor().max(0.0) as i32;
    let x1 = (bbox[0] + bbox[2]).ceil().min(width as f64) as i32;
    let y1 = (bbox[1] + bbox[3]).ceil().min(height as f64) as i32;
    for y in y0..y1 {
        for x in x0..x1 {
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            let outer =
                px >= bbox[0] && px < bbox[0] + bbox[2] && py >= bbox[1] && py < bbox[1] + bbox[3];
            let inner = px >= bbox[0] + stroke
                && px < bbox[0] + bbox[2] - stroke
                && py >= bbox[1] + stroke
                && py < bbox[1] + bbox[3] - stroke;
            if outer && !inner {
                blend_pixel(canvas, width, height, x, y, rgb, alpha);
            }
        }
    }
    Ok(())
}

fn draw_ellipse(
    canvas: &mut Canvas,
    width: u32,
    height: u32,
    bbox: Bbox,
    stroke: f64,
    color: &str,
    fill: Option<&str>,
) -> Result<(), String> {
    let (stroke_rgb, stroke_alpha) = parse_color(color)?;
    let fill_color = fill.map(parse_color).transpose()?;
    let cx = bbox[0] + bbox[2] / 2.0;
    let cy = bbox[1] + bbox[3] / 2.0;
    let rx = bbox[2] / 2.0;
    let ry = bbox[3] / 2.0;
    let x0 = bbox[0].floor().max(0.0) as i32;
    let y0 = bbox[1].floor().max(0.0) as i32;
    let x1 = (bbox[0] + bbox[2]).ceil().min(width as f64) as i32;
    let y1 = (bbox[1] + bbox[3]).ceil().min(height as f64) as i32;
    for y in y0..y1 {
        for x in x0..x1 {
            let dx = (x as f64 + 0.5 - cx) / rx;
            let dy = (y as f64 + 0.5 - cy) / ry;
            let d = (dx * dx + dy * dy).sqrt();
            if d <= 1.0 {
                if let Some((rgb, alpha)) = fill_color {
                    blend_pixel(canvas, width, height, x, y, rgb, alpha);
                }
                let normalized_stroke = stroke / rx.min(ry);
                if d >= 1.0 - normalized_stroke {
                    blend_pixel(canvas, width, height, x, y, stroke_rgb, stroke_alpha);
                }
            }
        }
    }
    Ok(())
}

fn draw_segment(
    canvas: &mut Canvas,
    width: u32,
    height: u32,
    from: Point,
    to: Point,
    stroke: f64,
    color: &str,
) -> Result<(), String> {
    let (rgb, alpha) = parse_color(color)?;
    let radius = stroke / 2.0;
    let x0 = (from[0].min(to[0]) - radius - 1.0).floor().max(0.0) as i32;
    let y0 = (from[1].min(to[1]) - radius - 1.0).floor().max(0.0) as i32;
    let x1 = (from[0].max(to[0]) + radius + 1.0).ceil().min(width as f64) as i32;
    let y1 = (from[1].max(to[1]) + radius + 1.0)
        .ceil()
        .min(height as f64) as i32;
    for y in y0..y1 {
        for x in x0..x1 {
            let distance = point_segment_distance([x as f64 + 0.5, y as f64 + 0.5], from, to);
            let coverage = (radius + 0.5 - distance).clamp(0.0, 1.0);
            blend_pixel(canvas, width, height, x, y, rgb, alpha * coverage);
        }
    }
    Ok(())
}

fn point_segment_distance(point: Point, from: Point, to: Point) -> f64 {
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    let length = dx * dx + dy * dy;
    if length == 0.0 {
        return (point[0] - from[0]).hypot(point[1] - from[1]);
    }
    let t = (((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length).clamp(0.0, 1.0);
    (point[0] - (from[0] + t * dx)).hypot(point[1] - (from[1] + t * dy))
}

fn draw_text(
    canvas: &mut Canvas,
    width: u32,
    height: u32,
    font: &Font,
    at: Point,
    text: &str,
    size: f64,
    color: &str,
) -> Result<(), String> {
    let (rgb, alpha) = parse_color(color)?;
    let mut pen_x = at[0];
    for character in text.chars() {
        let (metrics, bitmap) = font.rasterize(character, size as f32);
        let origin_x = pen_x + f64::from(metrics.xmin);
        let origin_y = at[1] + (size - metrics.height as f64) - f64::from(metrics.ymin);
        let column_start = ((-origin_x).ceil().max(0.0) as usize).min(metrics.width);
        let column_end = ((width as f64 - origin_x).ceil().max(0.0) as usize).min(metrics.width);
        let row_start = ((-origin_y).ceil().max(0.0) as usize).min(metrics.height);
        let row_end = ((height as f64 - origin_y).ceil().max(0.0) as usize).min(metrics.height);
        for row in row_start..row_end {
            for column in column_start..column_end {
                let coverage = f64::from(bitmap[row * metrics.width + column]) / 255.0;
                blend_pixel(
                    canvas,
                    width,
                    height,
                    (origin_x + column as f64).floor() as i32,
                    (origin_y + row as f64).floor() as i32,
                    rgb,
                    alpha * coverage,
                );
            }
        }
        pen_x += f64::from(metrics.advance_width);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rectangle_preserves_every_uncovered_sample_exactly() {
        let width = 12;
        let height = 9;
        let input: Vec<f32> = (0..width * height * 3)
            .map(|index| (index % 31) as f32 / 37.0)
            .collect();
        let json = r##"[{"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c170","type":"rect","bbox":[3,2,5,4],"width":1,"color":"#ff0000","fill":"#ff0000"}]"##;
        let output = draw_markup(input.clone(), width, height, json).unwrap();
        let mut changed = 0;
        for y in 0..height {
            for x in 0..width {
                let inside = x >= 3 && x < 8 && y >= 2 && y < 6;
                for channel in 0..3 {
                    let index = ((y * width + x) * 3 + channel) as usize;
                    if inside {
                        changed += usize::from(output[index] != input[index]);
                    } else {
                        assert_eq!(output[index].to_bits(), input[index].to_bits());
                    }
                }
            }
        }
        assert!(changed > 0);
    }

    #[test]
    fn every_public_primitive_rasterizes_with_the_bundled_font() {
        let width = 96;
        let height = 72;
        let json = r##"[
          {"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c171","type":"text","at":[3,3],"text":"Inter","size_px":14,"color":"#ffffff"},
          {"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c172","type":"arrow","from":[5,24],"to":[35,24],"width":3,"color":"#ff0000"},
          {"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c173","type":"line","from":[5,30],"to":[35,40],"width":2,"color":"#00ff00"},
          {"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c174","type":"rect","bbox":[42,4,18,14],"width":2,"color":"#0000ff","fill":"#0000ff44"},
          {"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c175","type":"ellipse","bbox":[66,4,18,14],"width":2,"color":"#ffff00","fill":"#ffff0044"},
          {"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c176","type":"path","points":[[42,28],[55,36],[68,27]],"width":2,"color":"#00ffff"},
          {"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c177","type":"highlight","bbox":[8,50,76,12],"color":"#ff00ff","opacity":0.35}
        ]"##;
        let output = draw_markup(
            vec![0.0; (width * height * 3) as usize],
            width,
            height,
            json,
        )
        .unwrap();
        assert!(output.iter().filter(|sample| **sample != 0.0).count() > 500);
    }

    #[test]
    fn text_rasterization_budget_rejects_pathological_glyph_work() {
        let json = r##"[{"id":"0199a7c2-3b1e-7c40-8f2a-1d0e5a91c170","type":"text","at":[0,0],"text":"A","size_px":10000,"color":"#ffffff"}]"##;
        let error = draw_markup(vec![0.0; 12], 2, 2, json).unwrap_err();
        assert_eq!(error, "markup text exceeds the rasterization budget");
    }
}
