# Unambiguous signed grounding coordinates

The first live integrated whole-person capture returned plausible normalized
y/x point tuples, contrary to the requested x/y description. Its interpreted
points selected bouquet pixels and excluded face/hair. Do not guess axis order
from individual outputs or silently transpose existing responses.

Change only the segmentation provider wire to `at: { x, y }`, each normalized
0–1000, with axis direction descriptions. Parse named coordinates and convert
once into the existing internal `at: [pixelX,pixelY]` contract. Boxes retain the
existing top/left/bottom/right wire format. Other structured schemas and public
CLI flags remain unchanged. Old tuple responses are invalid rather than guessed.

Red/green through the real structured adapter and external fake gateway: a
named-axis response on a non-square image must produce exact pixel points;
invalid values/old ambiguous shape fail, unrelated structured points remain
untouched. Use existing tests and update only wire-side fixtures. Internal command
fake points must not change shape. Review the complete consumer import graph.

Rerun the same live person request through the production CLI with automatic
guidance. Retain the first failed capture alongside the new output and all
candidate scores. Run comparison telemetry and an unprimed screenshot critique
before judging. No model switch, heuristic axis detection or hand-authored points.
