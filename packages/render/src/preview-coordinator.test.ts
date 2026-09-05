import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { srgb2014ProfilePath } from "./color.js";
import { PreviewCoordinator, type PreviewIndexAdapter } from "./preview-coordinator.js";

test("concurrent callers join one artifact materialization and each receives a validated JPEG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-flight-"));
  const path = join(directory, "view.jpg");
  const records: string[] = [];
  const touches: string[] = [];
  const index: PreviewIndexAdapter = {
    recordCompleted: async (artifact) => {
      records.push(artifact.path);
    },
    touch: async (artifactPath) => {
      touches.push(artifactPath);
    },
  };
  const coordinator = new PreviewCoordinator();
  let writes = 0;
  try {
    const work = async () => {
      writes += 1;
      await mkdir(directory, { recursive: true });
      await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } })
        .jpeg()
        .withIccProfile(srgb2014ProfilePath)
        .toFile(path);
      await writeProvenance(path, await readFile(path));
      return { path };
    };

    const [first, second] = await Promise.all([
      coordinator.materialize(key(path), work, index),
      coordinator.materialize(key(path), work, index),
    ]);

    expect(writes).toBe(1);
    expect(first.path).toBe(path);
    expect(second.path).toBe(path);
    expect(records).toEqual([path]);
    expect(touches).toEqual([path, path]);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("reusing an existing artifact refreshes its index entry under a path lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-reuse-"));
  const path = join(directory, "view.jpg");
  const records: Array<{ path: string; bytes: number; lastUsed: Date }> = [];
  const index: PreviewIndexAdapter = {
    recordCompleted: async (artifact) => {
      records.push(artifact);
    },
    touch: async () => {},
  };
  const now = new Date("2026-09-05T10:00:00.000Z");
  const coordinator = new PreviewCoordinator(() => now);
  try {
    await writeArtifact(path);
    const artifact = await coordinator.reuseValid(path, index);
    if (!artifact) throw new Error("expected valid artifact");
    expect(artifact).toMatchObject({ w: 2, h: 1 });
    expect(records).toEqual([{ path, bytes: artifact.storageBytes, lastUsed: now }]);
    expect(coordinator.leasedPaths()).toEqual(new Set());
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a failed writer clears its flight, artifact, and temporary residue before retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-retry-"));
  const path = join(directory, "view.jpg");
  const index: PreviewIndexAdapter = {
    recordCompleted: async () => {},
    touch: async () => {},
  };
  const coordinator = new PreviewCoordinator();
  let attempts = 0;
  const work = async () => {
    attempts += 1;
    if (attempts === 1) {
      await writeFile(path, "not a jpeg");
      await writeFile(`${path}.123.tmp`, "partial");
      throw new Error("injected writer failure");
    }
    await writeArtifact(path);
    return { path };
  };
  try {
    await expect(coordinator.materialize(key(path), work, index)).rejects.toThrow(
      "injected writer failure",
    );
    await expect(access(path)).rejects.toThrow();
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    await expect(coordinator.materialize(key(path), work, index)).resolves.toEqual({
      path,
    });
    expect(attempts).toBe(2);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a sidecar from different JPEG bytes is rejected instead of treated as valid provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-provenance-"));
  const path = join(directory, "view.jpg");
  const index: PreviewIndexAdapter = {
    recordCompleted: async () => {},
    touch: async () => {},
  };
  const coordinator = new PreviewCoordinator();
  try {
    await writeArtifact(path);
    const sidecar = await readFile(`${path}.json`);
    await sharp({ create: { width: 2, height: 1, channels: 3, background: "blue" } })
      .jpeg()
      .withIccProfile(srgb2014ProfilePath)
      .toFile(path);

    await expect(coordinator.materialize(key(path), async () => ({ path }), index)).rejects.toThrow(
      "failed validation",
    );
    expect(sidecar.length).toBeGreaterThan(0);
    await expect(access(path)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true });
  }
});

async function writeArtifact(path: string): Promise<void> {
  await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } })
    .jpeg()
    .withIccProfile(srgb2014ProfilePath)
    .toFile(path);
  await writeProvenance(path, await readFile(path));
}

function key(path: string) {
  return { photoId: "photo", renderHash: "render", artifact: "view:view" as const, path };
}

async function writeProvenance(path: string, bytes: Buffer): Promise<void> {
  await writeFile(
    `${path}.json`,
    `${JSON.stringify({
      schema: 1,
      jpeg_sha256: createHash("sha256").update(bytes).digest("hex"),
      source_tier: "online-file",
      source_dimensions: { w: 2, h: 1 },
    })}\n`,
  );
}
