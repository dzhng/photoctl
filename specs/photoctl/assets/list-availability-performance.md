# Bounded culling availability work

## Finding and owner

The live-camera development witness returned ten photos in 41.02 seconds from a
catalog of 431 pairs. Filtering the catalog down to ten photos took 1.38 seconds.
Those are observations, not a controlled timing comparison. The culling reader in
`packages/commands/src/handlers/cull.ts` resolved every matching locator before
applying its output limit: up to 862 volume/path checks for ten returned rows.
The Mac resolver invokes `diskutil` for each check. SQL pagination bounded retained
catalog rows, but not external work. Priority: high for the first-use organization
workflow.

## Correction

Catalog eligibility, totals and cursor order are determined before availability is
materialized. Only retained or streamed rows resolve original locators. Streaming
awaits the current consumer before resolving another row; `next` materializes only
the selected row while retaining the order needed for its remaining count.
Retained non-stream rows resolve concurrently within the existing SQL page, so an
unlimited list keeps its page-level concurrency. An independent review caught the
initial per-photo serialization; a real resolver-edge concurrency regression failed
with one active check instead of two and then passed after correction. No measured
latency multiplier is claimed for that review finding.

The reader still checks XMP staleness wherever that predicate affects membership.
Photos without locators remain excluded; unavailable files remain visible. There
is no volume cache, timeout change, count projection or schema change. Cheap paged
catalog reads were not demonstrated to be a performance defect and remain intact.

## Evidence and limits

The public regression owner is
[`cull.test.ts`](../../../packages/commands/src/cull.test.ts). Its resolver-edge
spy passes through the real filesystem and volume-map checks. Limited listing
previously checked an unreturned original; successive `next` requests performed
ten checks for four delivered rows. The corrected expectations are tied to the
returned paths, with unchanged totals, order, offline/wrong-volume/reconnect states
and preview-before-cursor publication.

A page-eager availability mutation failed the stream backpressure assertion before
the first row was accepted. Disabling the XMP predicate changed both the selected
row and total and failed the stale-list regression. Both mutations were restored.
These are deterministic work-count proofs, not a new camera timing claim; no camera
access or full-resolution rendering is required for this correction.
