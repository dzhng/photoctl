/** Persistence failure must never be downgraded to a provider's optional-upscale fallback. */
export class ProviderImageCaptureError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "Original provider image could not be retained",
      { cause },
    );
  }
}

/** A corrupt body has no image artifact; callers may preserve their existing provider-failure fallback. */
export class InvalidProviderImageError extends Error {}
