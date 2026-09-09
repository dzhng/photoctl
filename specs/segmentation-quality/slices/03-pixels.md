# 03 — Faithful ZIM pixel contract

The [full-portrait numerical check](../assets/zim-contract/pixel-port.json)
reproduces the official encoder input exactly. Existing native float resampling
restores alpha with max error 1.99e-5 and mean error 9.15e-8 against PyTorch;
this is a numerical fidelity result, not visual acceptance. Small fixtures pin
byte rounding, two-stage restoration and rotated-crop projection independently.

The preparatory library pass passed 17 native resampling tests and three ZIM
tests, including a deliberately broken single-resize falsification. Independent
Codex review found no actionable defects. Native and TS builds passed. Slice 04
must replace the old SAM2 pixel path when it wires this owner into production;
this checkpoint is not a second selectable backend.

Seam: render preprocessing and the native mask-restoration primitive replace
SAM2-specific pixel math. Do not generalize them into multiple model profiles.
Read the pinned upstream predictor, preprocessing and postprocess implementations
before porting; the external tensor fixtures, not visual similarity, are oracle.

Input: source RGB converted to uint8 before PIL-compatible longest-side resize
to 1024. Round resized dimensions as upstream. Normalize byte RGB by upstream
mean/std, then zero-pad bottom/right. No centered letterbox, float-resize
substitution or black-byte padding before normalization. Pin asymmetric inputs
and a non-square actual reference tensor. If the native resampler cannot reproduce
PIL's antialiased bilinear behavior, implement that one primitive in its natural
native owner and test against independently generated small fixtures.

Output: choose score argmax, restore logits bilinearly to 1024 (half-pixel,
align_corners=false), crop bottom/right padding, restore to source dimensions,
then sigmoid. Preserve fractional alpha. Apply existing oriented-base projection
after restoration; zero outside the actual developed image. Do not collapse the
two resizes into the old affine SAM2 binarizer. Frame projection still has one
owner, including crop/rotation and dimensions.

Red/green: asymmetric resize fixtures; normalization/padding; a nonlinear small
logit fixture that distinguishes two-stage restoration from single sampling;
fractional output; oriented crop projection. Compare actual reference tensors
and alpha with reported max/mean error; tolerances must reflect floating-point
precision, not conceal an algorithm change. Human surface: offline pixel probe.
For composites run compare-screenshots then unprimed screenshot-critique last.

Delegated: internal numerical implementation and precision tolerance justified
by fixture error; not interpolation order, pixel units, orientation or alpha
semantics. Keep existing coordinate and mask-edit/storage tests green.
