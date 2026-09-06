# Local horizon checkpoint evidence

The target is a level ground/sky boundary, upright asymmetric landmarks, and the existing
centered straighten trim. Similarity to the tilted input is not the acceptance criterion.
These are synthetic geometry witnesses, not evidence that every natural photograph has a
semantically identifiable horizon.

## Public pixel evidence

The built CLI imported the authored tilted scene, showed the native view, ran `crop --auto`,
showed it again, and exported PNG. The reproducible capture entry is
[`apps/cli/src/crop.test.ts`](../../../../apps/cli/src/crop.test.ts), with
`PHOTOCTL_CROP_CAPTURE_DIR` pointing at an evidence directory.

| View | Full image | Horizon detail | Dimensions | Measured boundary angle |
| --- | --- | --- | --- | --- |
| Input public view | [before](before.png) | [detail](before-detail.png) | 320×240 | 12.090° |
| Auto public view | [after](after.png) | [detail](after-detail.png) | 288×184 | −0.029° |
| PNG delivery | [export](export.png) | [detail](export-detail.png) | 288×184 | −0.033° |

The trim retains 69% of the input area. Both landmarks remain within the frame. Comparing
the input resized to the output dimensions gives channel MAE 12.37/255, with 10.72% of
channels differing by more than 32: the public output is not a no-op. That normalized
comparison measures changed framing, not pixel registration or correctness. Boundary angles
come from a sky/ground color transition in the central landmark-free strip, independent of Hough.
Preview/PNG channel MAE is 1.13/255; their render identity is exact. Undo followed by manual
straighten at the detected absolute value produces the identical render hash and preview bytes.

Two fresh image-only Codex critiques received neutral labels, no implementation history, and
all captures; the second also received [preview tree](after-tree.png) and
[PNG tree](export-tree.png) zooms. Both identified the corrected horizontal boundary and
retained objects, but flagged a jagged/fringed boundary and softer preview edges. The first
suggested a trunk-end difference. The complete-set critique found no major object cut off;
the preview's softened trunk and the PNG's harder/notched pixels are visible in the tree crops.
The trunk is well inside the 184-pixel-high frame (strong trunk color ends at y=102 in preview,
y=104 in PNG), not clipped by trim. Exact manual/auto parity establishes that the existing
geometry and preview encoding own these artifacts; this pass does not claim pristine edges
or introduce another resampler to conceal them. **Accept the slope/trim checkpoint with that
explicit raster-quality limitation.** Preview was opened for non-blocking inspection and closed.

## Behavioral evidence and reversibility

The first built-public RED was `Unknown command: crop`, exit 2, after successful import.
The crop suites contain nine command checks and one built journey. They cover blank
and conflicting-line abstention, absolute/manual composition, repeated level no-op and undo,
quarter-turn offline fallback, explicit aspect, consumed-crop canvas, markup exclusion,
bounded odd-sized sampling, original bytes, public preview/export and real revision conflicts.
Native tests cover both signs across the full control range, position/scale/contrast inversion,
anisotropic direction mapping, and residuals that compose with an existing control.

Failure witnesses were exercised, not merely inferred: sampling markup falsely selected a
−25.2° line; reactivating the consumed crop collapsed expanded width to 216; replacing the
snapped commit state with a fresh read lost conflict refusal; reversing the correction sign
failed both signed and anisotropic native checks. Each mutation was restored. A genuine
wide/steep-line RED corrected support measurement from image width to the available line chord.
Detector constants live with the [native algorithm](../../../../crates/photoctl-image/src/horizon.rs):
bounded analysis and deterministic thinning cap work; separate competitive angles abstain;
the small level deadband prevents stair-step noise from creating endless revisions. Display-space
luminance follows visible photographic contrast; it is not semantic sky detection.

Independent code review reported no actionable correctness findings. Its built CLI check hit
sandbox socket denial; the actual unsandboxed built journey passed. Focused formatting, lint,
TypeScript checking, native tests, and crop tests passed. Existing canvas/develop/state/undo
neighbors passed (36 checks); ten other first-JPEG checks passed.

Root integration rebuilt the addon and passed all three native groups, the 20 crop/public/client
checks and 16 develop/state/undo/canvas neighbors, with TypeScript build/checking. Direct review
of all eight captures agrees with the slope/trim verdict above. An additional independent review
found no actionable correctness issue. The integration caught missing progress during slow source
evaluation: a delayed real database boundary failed without a heartbeat, then passed while preserving
the committed straighten value. Removing crop from the existing long-command idle policy independently
failed the zero-queue-budget client check (1s expires before the next 5s heartbeat); restoring it passed.
This reuses the already banked advisory-disconnect policy, without a new retry or cancellation owner.

## Inherited full-resolution gate remains open

Three unchanged first-JPEG tests timed out at their existing 30-second limits. A clean detached
`ff06b7a` worktree reproduced all three with the same fresh `cargo build -p photoctl-image`
**dev** profile and `package-native.mjs`, Node 24.14.0, and no packaged Swift helper. Both
source-selector probes chose LibRaw 0.22.2-Release, supported=true, compression=1,
fellBack=false. Neither borrowed the root task's previously packaged native binary.

| Existing test | Candidate | Clean control |
| --- | --- | --- |
| Offline detail promoted to full source | 30.090s | 30.107s |
| Full-source profiled JPEG export | 30.066s | 30.061s |
| Valid export after a bad ID | 30.049s | 30.103s |

The selected detail-only candidate rerun also timed out (30.062s). The control suite finished
exit 1; a subsequently inspected process list contained no remaining CLI processes from its
worktree. The detail test still expects `online-jpeg-range`, although the source ladder selects
native whole-file decoding. Root owns the separate full-source expectation/default-build
performance correction before the whole-spec release gate. No timeout, expectation, migration,
dependency, platform skip, or release gate was weakened here.
