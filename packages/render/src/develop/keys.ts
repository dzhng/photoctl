export type DevelopTier = 1 | 2;

export interface DevelopOperator {
  range: readonly [number, number] | null;
  operator: string;
  formula: string;
  tier: DevelopTier;
}

export const DEVELOP_FILTER_NAMES = [
  "vivid",
  "vivid_warm",
  "vivid_cool",
  "dramatic",
  "dramatic_warm",
  "dramatic_cool",
  "mono",
  "silvertone",
  "noir",
] as const;

/**
 * The canonical operator inventory. Validation and tiering consume these
 * paths; later pixel implementations are tested against the named formulas.
 */
export const DEVELOP_OPERATORS = {
  brilliance: {
    range: [-100, 100],
    operator: "local_light_map",
    formula: "31x31 local light-map gain",
    tier: 2,
  },
  exposure: { range: [-5, 5], operator: "grading_primary", formula: "rgb * 2^value", tier: 1 },
  highlights: {
    range: [-100, 100],
    operator: "grading_tone",
    formula: "smooth 0.18-to-1.0 luminance-mask gain, one stop at full scale",
    tier: 2,
  },
  shadows: {
    range: [-100, 100],
    operator: "grading_tone",
    formula: "inverse smooth 0.05-to-0.5 luminance-mask gain, one stop at full scale",
    tier: 2,
  },
  brightness: {
    range: [-100, 100],
    operator: "grading_primary",
    formula: "OpenColorIO GradingPrimary offset",
    tier: 1,
  },
  contrast: {
    range: [-100, 100],
    operator: "grading_primary",
    formula: "contrast about linear 0.18 pivot",
    tier: 1,
  },
  black_point: {
    range: [-100, 100],
    operator: "grading_primary",
    formula: "linear black lift",
    tier: 1,
  },
  saturation: {
    range: [-100, 100],
    operator: "grading_primary",
    formula: "OpenColorIO GradingPrimary saturation",
    tier: 1,
  },
  vibrance: {
    range: [-100, 100],
    operator: "vibrance",
    formula: "Rec.2020 saturation weighted by (1-saturation), with display-hue skin protection",
    tier: 1,
  },
  cast: { range: [-100, 100], operator: "cast", formula: "opponent-axis chroma cast", tier: 2 },
  "white_balance.temp_offset_k": {
    range: [-1500, 1500],
    operator: "bradford",
    formula: "Bradford chromatic adaptation temperature offset",
    tier: 1,
  },
  "white_balance.tint": {
    range: [-100, 100],
    operator: "bradford",
    formula: "Bradford chromatic adaptation tint offset",
    tier: 1,
  },
  curves: {
    range: null,
    operator: "grading_rgb_curve",
    formula: "OpenColorIO scene-linear monotonic quadratic B-spline",
    tier: 2,
  },
  levels: {
    range: null,
    operator: "grading_rgb_curve",
    formula: "signed black/midpoint/white gamma without scene-linear clipping",
    tier: 2,
  },
  definition: {
    range: [-100, 100],
    operator: "unsharp",
    formula: "unsharp radius 3% of long edge",
    tier: 2,
  },
  sharpen: { range: [0, 100], operator: "unsharp", formula: "unsharp radius 1 px", tier: 2 },
  vignette: { range: [-100, 100], operator: "vignette", formula: "radial gain", tier: 2 },
  "noise_reduction.luminance": {
    range: [0, 100],
    operator: "nlm",
    formula: "non-local means luminance",
    tier: 2,
  },
  "noise_reduction.color": {
    range: [0, 100],
    operator: "nlm",
    formula: "non-local means chroma",
    tier: 2,
  },
  "bw.intensity": {
    range: [-100, 100],
    operator: "bw",
    formula: "luminance mix intensity",
    tier: 2,
  },
  "bw.neutrals": { range: [-100, 100], operator: "bw", formula: "neutral luminance bias", tier: 2 },
  "bw.tone": { range: [-100, 100], operator: "bw", formula: "monochrome split tone", tier: 2 },
  "bw.grain": {
    range: [0, 100],
    operator: "bw",
    formula: "deterministic monochrome grain",
    tier: 2,
  },
  selective_color: {
    range: [-100, 100],
    operator: "selective_color",
    formula: "hue-band chroma and luminance offsets",
    tier: 2,
  },
  crop: {
    range: null,
    operator: "geometry",
    formula: "oriented base-space crop applied last",
    tier: 2,
  },
  rotate: {
    range: [0, 270],
    operator: "geometry",
    formula: "exact clockwise quarter-turn applied last",
    tier: 2,
  },
  straighten_deg: {
    range: [-45, 45],
    operator: "geometry",
    formula: "center rotation applied last",
    tier: 2,
  },
  aspect_ratio: { range: null, operator: "geometry", formula: "crop aspect constraint", tier: 2 },
  "filter.name": {
    range: null,
    operator: "filter",
    formula: "named package filter dictionary",
    tier: 2,
  },
  "filter.strength": {
    range: [0, 1],
    operator: "filter",
    formula: "linear blend with unfiltered develop",
    tier: 2,
  },
} as const satisfies Record<string, DevelopOperator>;

export type DevelopKey = keyof typeof DEVELOP_OPERATORS;

export const DEVELOP_KEY_PATHS = Object.freeze(Object.keys(DEVELOP_OPERATORS) as DevelopKey[]);
