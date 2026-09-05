# Authored-canvas restriction comparison

The target is to crop the existing expanded canvas when aspect alone changes, without
reactivating its consumed source crop. Aspect retains its before-quarter-turn meaning;
later orientation replaces an inscribed viewport, and returning or clearing controls
must recover the prior pixels exactly.

`before` was captured from detached commit `c50bb84`; `after` is the restriction-activation
pass. Both use the same asymmetric 1000×800 gradient, original crop, deterministic red
border, native public `show` path, and command sequence. The captures decode the public
JPEG preview to PNG. Corner images enlarge the bottom-right native crop 3× with nearest
sampling; each metrics file records its exact crop bounds and full output mapping.

The changed output dimensions are intentional, so stretching them to a common size for
a global pixel-distance score would obscure the geometry error. The frame dimensions,
unaltered full captures, and matching boundary crops locate the differences instead.
Both candidates restore their own aspect state byte-for-byte and clear back to the same
authored baseline. The corrected aspect view retains the red side margins; its relative
straighten and quarter-turn have no exposed black exterior wedges.

The [fresh image-only critique](critique.md) inspected all full frames and corner crops
without code or implementation history. It preferred the corrected candidate and found
no unexplained abnormal blur or exposed exterior. Independent local inspection agrees;
the relevant comparison was opened in one Preview window and closed after the
non-blocking review interval.

This accepts this deterministic restriction witness, not photographic generation quality
or all canvas consumers. A simple gradient cannot establish texture quality, and one
magnified corner per state does not cover every boundary in detail. Public preview JPEG
edge softness is not a claim about canonical pixels; the runnable regression separately
checks exact Float32 restoration. Offline and purchased-image density remain unverified.
