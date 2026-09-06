# Integrated implementation checkpoints

These are historical focused checks, not a current whole-spec release verdict.
The owning slice and asset reports define each result's scope and remaining gates.
Git history preserves the exact implementation at each checkpoint.

these are focused pass results, not a root full-suite release gate.
Slices 00–10 and deterministic editing checkpoints are committed; slice files/assets own acceptance details.
The preview-loop oracle compares lossless graph outputs at Float32 precision; JPEGs separately prove freshness.

| Pass | Merged evidence |
| --- | --- |
| Geometry / convex support / canvas core | 77 / 78 / 156 checks, typecheck |
| Restriction activation / captured canvas and fixture integration | 72 / 44 checks, build/typecheck |
| Color/resampler accounting / prepared inference handles | 26 / 19 checks, native build/typecheck; resource witnesses below |
| Daemon no-replay and preview progress | 22 lifecycle/client + 11 preview/progress checks |
| RAW compression boundary | Rebuilt addon, 9 adapter/public-CLI + 2 Rust checks across three modes |
| Native diagnostics | 21 TypeScript + 5 Rust checks, native/TS build/typecheck; override model gate below |
| Public undo | 46 merged CLI/command/revision/markup/canvas/develop checks, TS build/typecheck |
| Canvas sampling / reconnect | 71 merged canvas/preview/export/undo/evaluator/SAM and built-journey checks, TS build/typecheck; independent review |
| Historical schema fixtures | 31 merged migration checks, including version-authored v10–v12 preservation; no production schema change |
| Existing-photo path lookup | 21 CLI/locator/show checks and typecheck; daemon client-relative, internal-copy and wrong-volume witnesses |
| Source-only SAM canvas | 75 merged canvas/segment/revision/progress/frame checks, TS build/typecheck; all 20 captures directly reviewed |
| Local auto-straighten | 20 crop/public/client checks, 16 develop/state/undo/canvas neighbors and 3 native groups; independent review and all 8 captures directly inspected |
| Full-source default-build performance | All 13 merged first-JPEG checks pass unchanged deadlines; matched dev/release/optimized-dev pixel hashes are identical |
| [Untouched overview](gates/show-overview/evidence.json) | 37 preview/daemon/develop cases across integration and focused correction; fresh visual review |
| Paid retention / atomic removal / upscale-develop consumers | 85 / 18 / 21 checks and typecheck; no extra provider work for exposure replacement |
| Native-density outpaint integration | 52 merged outpaint/ordinary-fill/workbench checks; TS build/typecheck; all 16 native-density captures directly inspected. Packaged and resource gates remain open. |
| Sampled white balance integration | 21 merged command/built-CLI/native-boundary/develop/undo checks, 2 Rust numerical groups, native and TS builds/typecheck. No gray-card photographic acceptance claim. |
| Paired-originals integration | 96 merged checks across paired import, outpaint refresh density, white balance, generation, workbench, keyless fixture gold exam, identity/location, XMP/search and backup/restore; TS build and clean independent merged review. Presentation/real-drive gates remain open. |
| Bounded culling availability | 19 merged cull/XMP/real-CLI streaming checks, TS build; independent pass review. Work-count proof, not a new camera timing claim. |
| Retained offline export | 57 merged retained-export/paired-import/preview-export/evaluator/schema checks, TS build/typecheck. Current semantics, source-quality promotion and corrupt/missing fallback covered; warm-output installed journey below. |
| Combined move and relative scale | 33 merged command/density/person-move/built-CLI checks, TS build/typecheck; one atomic revision and exact undo. |
| Authored mask frames | 54 merged retouch/outpaint/canvas/fill-refresh/move/built-journey checks, TS build/typecheck and scoped lint. [Lifecycle evidence](outpaint-lifecycle/README.md) distinguishes warm retained-output packaging from cold fallback and photographic quality. |
| Expanded-coordinate retouch | 67 merged support/full-frame/density/built-journey checks; independent review identified and corrected an extra center constraint, then all 43 affected checks passed. [Lifecycle evidence](outpaint-lifecycle/README.md) records the eighteen-image review and exact support measurements. |
| Full-frame creation / generic placement | 38 merged creation/retouch-transform/manual-layer/density/built-CLI checks, TS build/typecheck and scoped lint; independent static and eight-image visual reviews. Explicit refresh and retained-only input remain open. |
