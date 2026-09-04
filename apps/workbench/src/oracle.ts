import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const executeFile = promisify(execFile);

export interface OracleFrame {
  width: number;
  height: number;
  data: Float32Array;
}

export interface OracleVerdict {
  compared: number;
  excluded: number;
  meanDeltaE00: number | null;
  p95DeltaE00: number | null;
  passed: boolean;
}

interface DecodeEnvelope {
  ok: boolean;
  data?: { file?: string; w?: number; h?: number; space?: string };
}

export async function buildOracleReport(id: string, cwd: string): Promise<string> {
  const safeId = id.replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
  const directory = join(cwd, "out", "wb", "oracle", safeId);
  await mkdir(directory, { recursive: true });
  const results = await decodeOracleFrames(["file", "ciraw", "libraw"], id, directory, cwd);
  const ciraw = results.find(({ decoder }) => decoder === "ciraw")!;
  const libraw = results.find(({ decoder }) => decoder === "libraw")!;
  const verdict = measureOracleFrames(ciraw.frame, libraw.frame);
  const evidence = {
    photoId: id,
    scale: 0.25,
    patchGrid: [64, 64],
    excluded: "either decoder Y > 0.9",
    threshold: { meanDeltaE00: 2, p95DeltaE00: 5 },
    orientation: results.map(({ decoder, frame }) => ({
      decoder,
      width: frame.width,
      height: frame.height,
    })),
    verdict,
  };
  await writeFile(join(directory, "oracle.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  const output = join(cwd, "out", "wb", `oracle-${safeId}.html`);
  await writeFile(output, renderOracleReport(results, evidence), "utf8");
  return output;
}

async function decodeOracleFrames(
  decoders: Array<"file" | "ciraw" | "libraw">,
  id: string,
  directory: string,
  cwd: string,
): Promise<Array<{ decoder: string; frame: OracleFrame; jpeg: Buffer }>> {
  const [decoder, ...remaining] = decoders;
  if (!decoder) return [];
  const tiff = join(directory, `${decoder}.tif`);
  await runDecode(id, decoder, tiff, cwd);
  const frame = readLinearTiff(await readFile(tiff));
  const jpeg = await sharp(tiff).withIccProfile("srgb").jpeg({ quality: 90 }).toBuffer();
  await writeFile(join(directory, `${decoder}.jpg`), jpeg);
  return [{ decoder, frame, jpeg }, ...(await decodeOracleFrames(remaining, id, directory, cwd))];
}

export function measureOracleFrames(reference: OracleFrame, candidate: OracleFrame): OracleVerdict {
  validateFrame(reference);
  validateFrame(candidate);
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `Oracle frames must have the same framing; got ${reference.width}x${reference.height} and ${candidate.width}x${candidate.height}`,
    );
  }
  const deltas: number[] = [];
  let excluded = 0;
  for (let patchY = 0; patchY < 64; patchY += 1) {
    for (let patchX = 0; patchX < 64; patchX += 1) {
      const left = patchMean(reference, patchX, patchY);
      const right = patchMean(candidate, patchX, patchY);
      if (rec2020Y(left) > 0.9 || rec2020Y(right) > 0.9) {
        excluded += 1;
      } else {
        deltas.push(deltaE00(rec2020ToLab(left), rec2020ToLab(right)));
      }
    }
  }
  if (deltas.length === 0) {
    return { compared: 0, excluded, meanDeltaE00: null, p95DeltaE00: null, passed: false };
  }
  const meanDeltaE00 = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const ordered = deltas.toSorted((left, right) => left - right);
  const p95DeltaE00 = ordered[Math.ceil(ordered.length * 0.95) - 1];
  return {
    compared: deltas.length,
    excluded,
    meanDeltaE00,
    p95DeltaE00,
    passed: meanDeltaE00 <= 2 && p95DeltaE00 <= 5,
  };
}

async function runDecode(
  id: string,
  decoder: "file" | "ciraw" | "libraw",
  output: string,
  cwd: string,
): Promise<void> {
  const cli = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));
  let stdout: string;
  try {
    ({ stdout } = await executeFile(
      process.execPath,
      [cli, "decode", id, "--with", decoder, "--scale", "0.25", "--to", output],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PHOTOCTL_NO_DAEMON: "1" },
        maxBuffer: 4 * 1024 * 1024,
      },
    ));
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error ? String(error.stderr) : String(error);
    throw new Error(`${decoder} oracle decode failed: ${stderr.trim()}`, { cause: error });
  }
  const envelope = JSON.parse(stdout) as DecodeEnvelope;
  if (
    !envelope.ok ||
    envelope.data?.file !== output ||
    envelope.data.space !== "scene-linear-rec2020"
  ) {
    throw new Error(`${decoder} oracle decode returned ${JSON.stringify(envelope)}`);
  }
}

function readLinearTiff(tiff: Buffer): OracleFrame {
  if (tiff.toString("ascii", 0, 2) !== "II") throw new Error("Oracle requires little-endian TIFF");
  const ifd = tiff.readUInt32LE(4);
  const count = tiff.readUInt16LE(ifd);
  const entries = new Map<number, number>();
  for (let index = 0; index < count; index += 1) {
    const offset = ifd + 2 + index * 12;
    entries.set(tiff.readUInt16LE(offset), tiff.readUInt32LE(offset + 8));
  }
  const width = entries.get(256);
  const height = entries.get(257);
  const strip = entries.get(273);
  if (!width || !height || strip === undefined) throw new Error("Oracle TIFF is incomplete");
  const samples = width * height * 3;
  const data = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1)
    data[index] = tiff.readUInt16LE(strip + index * 2) / 65_535;
  return { width, height, data };
}

function validateFrame(frame: OracleFrame): void {
  if (
    frame.width < 64 ||
    frame.height < 64 ||
    frame.data.length !== frame.width * frame.height * 3
  ) {
    throw new Error("Oracle frames must contain at least one source pixel per 64x64 patch");
  }
}

function patchMean(frame: OracleFrame, patchX: number, patchY: number): [number, number, number] {
  const x0 = Math.floor((patchX * frame.width) / 64);
  const x1 = Math.floor(((patchX + 1) * frame.width) / 64);
  const y0 = Math.floor((patchY * frame.height) / 64);
  const y1 = Math.floor(((patchY + 1) * frame.height) / 64);
  const sum = [0, 0, 0];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * frame.width + x) * 3;
      sum[0] += frame.data[index];
      sum[1] += frame.data[index + 1];
      sum[2] += frame.data[index + 2];
    }
  }
  const pixels = (x1 - x0) * (y1 - y0);
  return [sum[0] / pixels, sum[1] / pixels, sum[2] / pixels];
}

function rec2020Y([red, green, blue]: [number, number, number]): number {
  return 0.2627 * red + 0.678 * green + 0.0593 * blue;
}

function rec2020ToLab([red, green, blue]: [number, number, number]): [number, number, number] {
  const xyz = [
    0.636958 * red + 0.144617 * green + 0.168881 * blue,
    rec2020Y([red, green, blue]),
    0.028073 * green + 1.060985 * blue,
  ];
  const scaled = [xyz[0] / 0.95047, xyz[1], xyz[2] / 1.08883].map(labCurve);
  return [116 * scaled[1] - 16, 500 * (scaled[0] - scaled[1]), 200 * (scaled[1] - scaled[2])];
}

function labCurve(value: number): number {
  return value > 216 / 24_389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29;
}

export function deltaE00(
  [l1, a1, b1]: [number, number, number],
  [l2, a2, b2]: [number, number, number],
): number {
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const averageC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(averageC ** 7 / (averageC ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hp1 = hue(ap1, b1);
  const hp2 = hue(ap2, b2);
  const deltaL = l2 - l1;
  const deltaC = cp2 - cp1;
  const hueDifference = hp2 - hp1;
  const deltaHAngle =
    cp1 * cp2 === 0
      ? 0
      : Math.abs(hueDifference) <= 180
        ? hueDifference
        : hueDifference > 180
          ? hueDifference - 360
          : hueDifference + 360;
  const deltaH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(toRadians(deltaHAngle / 2));
  const averageL = (l1 + l2) / 2;
  const averageCp = (cp1 + cp2) / 2;
  const averageH =
    cp1 * cp2 === 0
      ? hp1 + hp2
      : Math.abs(hueDifference) <= 180
        ? (hp1 + hp2) / 2
        : hp1 + hp2 < 360
          ? (hp1 + hp2 + 360) / 2
          : (hp1 + hp2 - 360) / 2;
  const t =
    1 -
    0.17 * Math.cos(toRadians(averageH - 30)) +
    0.24 * Math.cos(toRadians(2 * averageH)) +
    0.32 * Math.cos(toRadians(3 * averageH + 6)) -
    0.2 * Math.cos(toRadians(4 * averageH - 63));
  const sl = 1 + (0.015 * (averageL - 50) ** 2) / Math.sqrt(20 + (averageL - 50) ** 2);
  const sc = 1 + 0.045 * averageCp;
  const sh = 1 + 0.015 * averageCp * t;
  const rotation = 30 * Math.exp(-Math.pow((averageH - 275) / 25, 2));
  const rc = 2 * Math.sqrt(averageCp ** 7 / (averageCp ** 7 + 25 ** 7));
  const rt = -rc * Math.sin(toRadians(2 * rotation));
  return Math.sqrt(
    (deltaL / sl) ** 2 +
      (deltaC / sc) ** 2 +
      (deltaH / sh) ** 2 +
      rt * (deltaC / sc) * (deltaH / sh),
  );
}

function hue(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const angle = (Math.atan2(b, a) * 180) / Math.PI;
  return angle >= 0 ? angle : angle + 360;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function renderOracleReport(
  results: Array<{ decoder: string; frame: OracleFrame; jpeg: Buffer }>,
  evidence: { photoId: string; scale: number; verdict: OracleVerdict },
): string {
  const cards = results
    .map(
      ({ decoder, frame, jpeg }) =>
        `<article><h2>${decoder}</h2><p>${frame.width} × ${frame.height} · orientation applied</p><img alt="${decoder} decoder output" src="data:image/jpeg;base64,${jpeg.toString("base64")}"></article>`,
    )
    .join("");
  const verdict = evidence.verdict;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>photoctl decoder oracle</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#0b0e14;color:#edf1f7}main{width:min(1500px,calc(100% - 40px));margin:auto;padding:40px 0 64px}header{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:28px}h1{margin:6px 0;font-size:clamp(36px,5vw,64px)}.kicker{color:#91a8ff;font:700 12px ui-monospace;letter-spacing:.14em;text-transform:uppercase}.verdict{padding:16px 20px;border:1px solid ${verdict.passed ? "#317761" : "#8c5438"};border-radius:14px;background:${verdict.passed ? "#102c25" : "#321e15"}}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}article{padding:16px;border:1px solid #29313f;border-radius:16px;background:#121821}h2{margin:0;text-transform:capitalize}article p{color:#aeb7c7}img{display:block;width:100%;height:auto;border-radius:9px;background:#05070a}.metrics{margin-top:24px;padding:20px;border:1px solid #29313f;border-radius:16px;background:#121821;font:15px/1.6 ui-monospace}@media(max-width:850px){.grid{grid-template-columns:1fr}header{display:block}}</style></head><body><main><header><div><p class="kicker">G4 · 64 × 64 patch oracle</p><h1>Decoder agreement</h1><p>Photo ${escapeHtml(evidence.photoId)} · scale ${evidence.scale} · frames are never resized.</p></div><strong class="verdict">${verdict.passed ? "PASS" : "FAIL"}</strong></header><section class="grid">${cards}</section><div class="metrics">CIRAW ↔ LibRaw<br>mean ΔE00: ${formatMetric(verdict.meanDeltaE00)} (≤ 2.0)<br>p95 ΔE00: ${formatMetric(verdict.p95DeltaE00)} (≤ 5.0)<br>compared: ${verdict.compared} · clipped excluded: ${verdict.excluded}</div></main></body></html>\n`;
}

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
