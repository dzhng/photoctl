# Full-resolution outpaint resources

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
It proposes an exact-arithmetic-preserving correction; no speedup is claimed yet.

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
