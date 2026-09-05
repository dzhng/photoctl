export type Sam2RenderTier = "develop" | "offline";

/**
 * Daemon-lifetime cache for the prompt-independent half of SAM. Eviction is
 * deliberately exposed to the render/cache owner instead of creating a second
 * size policy here.
 */
export class Sam2EncoderCache<T> {
  readonly #entries = new Map<string, Promise<T>>();

  get size(): number {
    return this.#entries.size;
  }

  async getOrEncode(photoId: string, tier: Sam2RenderTier, encode: () => Promise<T>): Promise<T> {
    const key = cacheKey(photoId, tier);
    const current = this.#entries.get(key);
    if (current) return await current;
    const pending = encode();
    this.#entries.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.#entries.get(key) === pending) this.#entries.delete(key);
      throw error;
    }
  }

  invalidate(photoId: string): void {
    const prefix = `${photoId}\0`;
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}

function cacheKey(photoId: string, tier: Sam2RenderTier): string {
  if (photoId.length === 0 || photoId.includes("\0")) throw new Error("Invalid SAM photo id");
  return `${photoId}\0${tier}`;
}
