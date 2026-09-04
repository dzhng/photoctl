import {
  readValidPreviewArtifact,
  removePreviewArtifact,
  removePreviewTemps,
} from "./preview-artifact.js";

export interface PreviewIndexAdapter {
  recordCompleted(artifact: { path: string; bytes: number; lastUsed: Date }): Promise<void>;
  touch(path: string, lastUsed: Date): Promise<void>;
}

export interface PreviewMaterialization {
  path: string;
}

export interface PreviewArtifactKey {
  photoId: string;
  renderHash: string;
  artifact: "master" | `view:${string}`;
  path: string;
}

interface PathLease {
  release(): void;
}

interface ActivePathLease extends PathLease {
  done: Promise<void>;
}

/** Owns derived-preview flights and path leases for one library process. */
export class PreviewCoordinator {
  private readonly flights = new Map<string, Promise<PreviewMaterialization>>();
  private readonly leased = new Map<string, ActivePathLease>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async materialize<T extends PreviewMaterialization>(
    key: PreviewArtifactKey,
    work: () => Promise<T>,
    index: PreviewIndexAdapter,
  ): Promise<T> {
    const flightKey = `${key.photoId}\0${key.renderHash}\0${key.artifact}\0${key.path}`;
    let flight = this.flights.get(flightKey) as Promise<T> | undefined;
    if (!flight) {
      flight = this.runFlight(key.path, work, index);
      this.flights.set(flightKey, flight);
      const clear = () => {
        if (this.flights.get(flightKey) === flight) this.flights.delete(flightKey);
      };
      void flight.then(clear, clear);
    }
    const result = await flight;
    if (!(await readValidPreviewArtifact(result.path))) {
      throw new Error(`Preview artifact failed validation: ${result.path}`);
    }
    await index.touch(result.path, this.now());
    return result;
  }

  leasedPaths(): ReadonlySet<string> {
    return new Set(this.leased.keys());
  }

  tryLeaseForPrune(path: string): PathLease | undefined {
    if (this.leased.has(path)) return undefined;
    return this.installLease(path);
  }

  private async runFlight<T extends PreviewMaterialization>(
    path: string,
    work: () => Promise<T>,
    index: PreviewIndexAdapter,
  ): Promise<T> {
    const lease = await this.acquirePath(path);
    try {
      const result = await work();
      if (result.path !== path)
        throw new Error("Preview writer returned a different artifact path");
      const artifact = await readValidPreviewArtifact(result.path);
      if (!artifact) throw new Error(`Preview artifact failed validation: ${result.path}`);
      await index.recordCompleted({
        path: result.path,
        bytes: artifact.storageBytes,
        lastUsed: this.now(),
      });
      return result;
    } catch (error) {
      const complete = await readValidPreviewArtifact(path).catch(() => undefined);
      if (!complete) await removePreviewArtifact(path).catch(() => undefined);
      await removePreviewTemps(path).catch(() => undefined);
      throw error;
    } finally {
      lease.release();
    }
  }

  private async acquirePath(path: string): Promise<PathLease> {
    const active = this.leased.get(path);
    if (active) {
      await active.done;
      return await this.acquirePath(path);
    }
    return this.installLease(path);
  }

  private installLease(path: string): ActivePathLease {
    let finish!: () => void;
    let released = false;
    const lease: ActivePathLease = {
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      release: () => {
        if (released) return;
        released = true;
        if (this.leased.get(path) === lease) this.leased.delete(path);
        finish();
      },
    };
    this.leased.set(path, lease);
    return lease;
  }
}
