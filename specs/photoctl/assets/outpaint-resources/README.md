# Full-resolution outpaint resources

The separate [persistent-daemon attempt](daemon.md) stopped at the 5 GB canary
after its first expanded JPEG export. Repeated-cycle retention remains unaccepted;
the earlier no-daemon witnesses below do not answer that failure.

This recorded-host witness exercises the actual uncropped camera JPEG and Bayer
RAW through the public CLI. Both complete under the approved 5 GB decimal RSS
investigation canary, with exact protected pixels. This is not a universal memory
bound, a fresh-native package gate, a persistent-daemon retention test, or
photographic generation acceptance. Expanded export latency remains substantial.

## Workload and evidence boundary

The [complete report](report.json) records two isolated no-daemon libraries using
the permanent DSC08142 JPG and ARW originals. Each baseline PNG is 7008×4672;
`fill --outpaint --px 128` extends it to 7264×4928, without a source crop or
resized original. The existing real-HTTP fake gateway returns a checkerboard;
`--model photoctl/fake-image-edit-v1 --no-upscale` prevents live provider and
upscaler work. Provider input capping remains normal production behavior, not a
claim that generated detail has native sampling quality.

Every RGB pixel in the original-sized interior at offset `(128,128)` equals the
baseline exactly. Removing the border restores the exact baseline PNG bytes.
Each case makes one generation request; export and removal make none. Original
files retain their SHA-256 identities. The comparison rejects a deliberately
one-pixel-shifted extraction in both cases and passes again at the correct offset;
this falsifies the pixel comparison, not a claimed production regression fix.

Each public command runs as a real Node 24 process under macOS `/usr/bin/time -l`.
`maximum resident set size` is recorded in bytes; elapsed time includes process
startup and command completion. It is not a simultaneous sum of CLI, helper,
observer and fake-server memory. The observer retains comparison buffers outside
the measured CLI. No forced collection, allocator tuning, native rebuild or
camera access occurs. Other implementing agents held heavy builds/tests during
the timed run; ordinary desktop applications remained active.

## Results

| Command | JPEG elapsed / peak RSS | RAW elapsed / peak RSS |
|---|---:|---:|
| Baseline PNG export | 4.89 s / 2.852 GB | 5.52 s / 2.878 GB |
| Fill, including fake generation | 4.49 s / 3.053 GB | 4.56 s / 3.011 GB |
| Expanded native PNG export | 40.52 s / 4.469 GB | 41.13 s / 4.587 GB |
| PNG export after border removal | 4.42 s / 2.857 GB | 5.04 s / 2.877 GB |

All fourteen commands succeeded; the report includes initialization, import and
removal too. The highest measured RSS is 4,586,881,024 bytes. One run per source
does not establish a latency distribution or repeated-request retention. There
is no specified outpaint latency threshold to declare passed: the four-second
encoder gate belongs to SAM, not fill or export. The roughly eightfold expanded
export cost merits profiling before calling this workflow responsive; these
measurements do not isolate its cause.

The subsequent [cold/warm profile](profile.md) attributes the dominant cold work
to repeated Lanczos weight computation in the shared native affine sampler.
The isolated optimized-runtime check below measures the resulting correction
through the same full-resolution public workflow.

## Reproduction and runtime identity

Run the ordinary CLI from a built checkout with separate empty library/cache
directories, `PHOTOCTL_NO_DAEMON=1`, a fixture-volume mapping for `fixtures/camera`,
and `PHOTOCTL_GATEWAY_URL` pointing to `startGatewayFixture` with checkerboard
responses. Set its dummy key and the explicit fake model; never substitute an
ambient paid endpoint. The report records the exact public command arguments.
Wrap each invocation in `/usr/bin/time -l node apps/cli/dist/bin.js`, then compare
lossless baseline, expanded interior and removed-border deliveries as above.

The scratch runner and its retained libraries/deliveries are at
`/private/tmp/photoctl-outpaint-resource-measurement`; its SHA-256 is
`0be1cad77b85c160dd0a82283251d767ac237abb80907df789b5b12e9bbe566d`.
The runner stays outside the repository: it adds no second permanent process or
measurement owner. `report.completed` is true only after both cases finish;
the runner preserves a partial failure report and stops at an exceeded canary.

The measured checkout is `a7e278b`; Node is 24.14.0 on Apple M5 Pro. The report
binds the prebuilt addon and helper to their hashes. The addon is
`8b07dbac0a76ca0ff10c0a9486f56d72497444a6055779ea8bfcc9b401ed3c55`.
A fresh native build, installed release, and the complete lifecycle gates remain
separate. No product code or performance threshold changed in this evidence pass.

## Isolated optimized-runtime verification

The [unchanged-runner recheck](optimized-report.json) uses fresh JPEG/RAW
libraries, the same original bytes, border dimensions, fake model, disabled
upscaling and public commands. Both complete all seven commands, make one fake
generation request, preserve every interior pixel, restore exact removal PNGs,
and leave originals unchanged. [Cross-run hashes](optimized-comparison.json)
prove all six baseline/expanded/removed PNGs byte-identical to the prior witness,
including the generated border, not merely the protected interior.

| Expanded native PNG export | Earlier runtime | Optimized runtime |
|---|---:|---:|
| Camera JPEG | 40.519 s / 4.469 GB | 18.289 s / 3.316 GB |
| Camera RAW | 41.127 s / 4.587 GB | 17.944 s / 3.375 GB |

These are observed 2.22× / 2.29× elapsed-time reductions; each is one run, not
an interleaved benchmark or a latency guarantee. Root/native build lanes held
during the recheck, but an unrelated VM and Playwright Chromium were observed at
about 207% and 188% CPU before it. Lower RSS is recorded, not attributed solely
to the weight calculation change. The five-GB canary and all pixel/request
assertions remain unchanged; an 18-second export still deserves further work.

The optimized addon was copied from root's freshly built debug dylib into an
isolated worktree and ad-hoc codesigned there. Its SHA-256 is
`fc3e6399382c1c8e317c9f66ed56f98b45e8b0a4caeccb56dc98e942a3a9dabc`;
the prior addon hash above was verified before copying. The optimized Rust source
SHA-256 is `e772320747c23f83172e2cdc87af129966bfdfb1af3d367b157f05d13099c956`.
Current root TypeScript outputs at `4854845` were copied into the isolated runtime;
package resolution was verified to use its own native package, not root's addon.
The report's Git revision names the evidence worktree, not the optimized source
commit. The unchanged scratch runner SHA-256 remains `0be1cad77b85c160dd0a82283251d767ac237abb80907df789b5b12e9bbe566d`.

Scratch outputs remain at
`/private/tmp/photoctl-outpaint-resource-measurement/optimized`. The older resource
report, profile and its exact Float32 TIFF are retained unchanged. This check
does not rerender that separate exposure-0.125 profile state, prove a persistent
daemon retention bound, or replace installed/fresh-release acceptance. No runtime
binary, scratch script or production code is committed with this evidence.
