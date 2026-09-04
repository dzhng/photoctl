export interface UpscaleArtifact {
  bytes: Buffer;
  mediaType: "image/png";
  hash: `a_${string}`;
  dimensions: { w: number; h: number };
}

export interface UpscaleLimits {
  maxInputPixels: number;
  maxOutputPixels: number;
  maxOutputEdge: number;
}

export interface UpscaleInput {
  artifact: UpscaleArtifact;
  scale: number;
  prompt?: string;
  fidelity?: number;
  creativity?: number;
  seed?: number;
}

export interface UpscaleProvenance {
  adapter: string;
  adapterVersion: string | null;
  service: string;
  model: string;
  modelVersion: string | null;
  requestId: string | null;
  seed: number | null;
  durationMs: number;
  costUsd: number;
  nativeTiling: null | { tiles: number; overlapPx: number };
}

export interface UpscaleResult {
  artifact: UpscaleArtifact;
  dimensions: { w: number; h: number };
  frameMapping?: {
    source: [number, number, number, number];
    output: [number, number, number, number];
  };
  provenance: UpscaleProvenance;
}

export interface UpscaleAdapter {
  readonly id: string;
  readonly version: string | null;
  readonly colorContract: "opaque-display-srgb";
  readonly supportedScales: readonly number[];
  readonly limits: UpscaleLimits;
  upscale(input: UpscaleInput): Promise<UpscaleResult>;
}
