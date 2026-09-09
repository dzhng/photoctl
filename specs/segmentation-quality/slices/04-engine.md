# 04 — One bounded local engine

Seam: adapt and rename the existing native ONNX worker and render segmenter to
their ZIM responsibilities. One worker/session lifecycle and diagnostic sink,
no second runtime or retained SAM2 compatibility path. Native tensor transport
remains general; render owns ZIM names, shapes, prompts and candidate selection.

Use the four float features and decoder IO recorded in slice 00. Signed point
labels are float32. Points-only adds upstream's not-a-point sentinel; box prompts
append corner labels 2/3 without dropping signed points or adding a sentinel.
Attention is upstream's 64x64 maximum Gaussian field over all real points when
any exist, otherwise its box field. Sentinel must not contribute to attention.
Reject invalid model tensors/scores. Pick the first maximum score deterministically
and preserve the corresponding fractional mask through slice 03.

Cache: each feature set is 116 MiB. Default capacity one retains approximately
the former cache budget; preserve lazy loading, same-image reuse, stale-image
replacement, failure retry and clear/dispose. Do not add a user cache knob.
Use four intra-op threads and one inter-op thread in the existing single worker;
measure native cost before acceptance. Python RSS is not native RSS. Report
runtime feasibility honestly; prior SAM2 canary numbers are not PhotoLab quality
requirements and cannot justify reducing model quality.

Red/green through public prepared-image behavior: signed membership, point+box
preservation, score-selected output, reuse/eviction/retry. Keep native worker
teardown and diagnostics tests. Rebuild native and TS before a real-model probe;
run one cold encode and repeated decodes with latency, RSS and cache evidence.
Compare the accepted frozen points-only alpha to the actual production engine.
For visuals use compare-screenshots then unprimed screenshot-critique last.

Delegated: clean symbol names and source organization. No new thread/config
framework. Unexpected native memory or fidelity failures reslice this contract
before changing quality or enlarging the architecture.
