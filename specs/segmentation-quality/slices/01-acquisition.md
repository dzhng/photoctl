# 01 — Pinned official models

Seam: the existing library model manifest, fetcher, doctor and release scripts.
Replace SAM2 export/acquisition with official ZIM ONNX acquisition; one manifest
owner, no generic exporter framework. Model names remain encoder.onnx and
decoder.onnx. Source revision, hashes, sizes and opset come from slice 00.

Use the official pinned HF resolve URL by default, retaining the explicit mirror
setting. Preserve hash verification, atomic fetch failure behavior and doctor
diagnostics. Existing model bytes fail the new hash check and are replaced only
through explicit fetch; saved masks need no model and remain replayable.
Keep noncommercial license/attribution with the acquired artifacts and package.
Prepare release verification against official artifacts without publishing or
uploading anything. Remove the obsolete SAM2 exporter/notice and its dead
consumers in the same pass, preserving meaningful acquisition tests.

Red/green: successful fetch, wrong bytes, interrupted fetch and explicit mirror
through library model tests and command doctor tests. Human runnable surface:
doctor reports the verified model identity and useful missing/hash errors.
No visual output, so no screenshot verdict. Run focused tests, then changed
tests; do not run the full closeout gate. Delegated: acquisition script naming
and internal organization, not artifact identity or release authority.
