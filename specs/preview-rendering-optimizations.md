# Preview rendering optimizations — deferred placeholder

**Status:** deferred; not part of the current photoctl implementation plan. Revisit when profiling large images or building an
interactive editor demonstrates the need. The current [`photoctl` preview contract](photoctl/README.md) remains authoritative.

## Goal

Make repeated high-resolution navigation cheaper and make an eventual UI feel immediate without changing CLI `show` behavior,
`render_hash`, `ViewSpec`, preview coordinates, color, warnings, cache lifetime, or preview/export correlation.

## Candidate work

1. Replace the full-frame JPEG display master with a lossless, random-access tiled master or multiresolution pyramid. Derived
   agent JPEGs and UI tiles must come from that artifact without rerunning the edit graph or adding an intermediate lossy encode.
   Choose the storage format only after benchmarking representative high-resolution files for render time, crop latency, disk
   size, peak memory, and cache-prune behavior.
2. Add an asynchronous preview service for UI clients with request priority, cancellation, coalescing, and progressive tiers
   (fast overview followed by sharper tiles). CLI `show` remains a synchronous wrapper that waits for the requested complete view.

## Acceptance placeholders

- A benchmark corpus and budgets decide whether the optimization ships; do not optimize from a single fixture.
- Repeated pans/zooms do not reevaluate the edit graph and do not decode unrelated full-frame pixels when the chosen format can
  avoid it.
- Superseded UI requests cancel without deleting a shared artifact another requester still needs.
- Progressive results identify the same `render_hash` and viewport and never present a lower tier as native resolution.
- Existing agent preview-loop, coordinate, color, single-flight, prune-safety, and preview/export tests remain unchanged and green.

## Explicit non-goal

Remote-agent preview transport is not part of this optimization spec.
