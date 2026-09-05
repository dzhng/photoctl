# Standalone generation checkpoint

This checkpoint proves the generated-photo boundary, not model aesthetics. The fake gateway returns a deterministic, opaque
checkerboard with horizontal green and vertical blue ramps; the built CLI normalizes it through the same display-sRGB-to-canonical
path as paid pixels, imports it, and materializes the saved preview only when `show` asks for one.

`generated.png` is the native 96×64 preview and `generated-4x.png` is a nearest-neighbor inspection enlargement. Recreate the native
capture with `PHOTOCTL_GENERATE_CAPTURE_DIR=specs/photoctl/assets/generate` and the focused built-CLI journey. The single-image
telemetry is under `telemetry/`; it reports zero transparency, substantial edge density and luminance range, and high color entropy.

The visual target is the complete 6×4 cell field with no crop, opaque pixels, alternating red intensity, a left-to-right green ramp,
and a top-to-bottom blue ramp. The strongest case against acceptance is that the hard cell boundaries could be accidental banding;
the 4× enlargement shows that they stay aligned to the intentional 16-pixel grid while both orthogonal ramps remain continuous.
The next risk is a hidden channel-order error; visibly independent red alternation, green columns, and blue rows argue against it.
Finally, the native image is small enough that interpolation could conceal damage; the nearest-neighbor enlargement shows complete
edge cells and no transparent or clipped border. Verdict: accepted for deterministic transport/color/framing coverage only.

Fresh critique confirmed exact 4× nearest-neighbor replication and independent channel directions. It also found narrow native
boundary ringing where the red checker flips; that non-blocking JPEG-preview residue would not satisfy an exact pixel-reconstruction
gate, which this checkpoint does not claim.
