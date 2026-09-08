# Corrected-runtime daemon witness

The [recorded six-cycle workload](daemon-corrected-report.json) completes under the unchanged
5 GB decimal investigation canary. Peak **sampled** daemon RSS is 4,978,950,144 bytes, leaving
only 21,049,856 bytes of headroom. The [historical failure](daemon.md) remains preserved;
this is not a universal bound, proof of leak absence, or controlled attribution to one fix.

One daemon performs three JPEG and three RAW cycles using the permanent DSC08142 originals.
Each cycle changes exposure, exports the uncropped 7008×4672 baseline, adds a 128-pixel fake
border, exports 7264×4928, removes the border and exports again. All original-sized RGB
interiors equal their baselines exactly; shifted extraction is rejected, and removal restores
the exact baseline PNG bytes. Exactly six local fake generation requests occur. Both originals
retain their hashes. This does not add a canonical-float or photographic-generation verdict.

The first JPEG baseline and expanded files are byte-identical to those in the failed attempt.
Expanded exports take 16.91–18.77 seconds. Final restoration's last idle sample is
1,435,451,392 bytes. There is no export latency acceptance threshold; SAM's encoder gate is
separate. No forced GC, heap flags, allocator settings or threshold changes are used.

The runner records 2,037 external observations, with 100 ms sleeps after active `ps` calls
and ten 200 ms idle observations per command. The maximum observed within-command gap is
345 ms; shorter peaks can be missed. Descendants are empty in sampled process trees, not
proved absent between samples. CLI high-water is recorded separately; observer/comparison
buffers are outside daemon RSS. Initialization precedes daemon PID acquisition. Heavy agent
builds/renders were held, but ordinary desktop activity continued.

The same PID serves every measured command and normal shutdown is independently verified.
The runtime is isolated source commit `5592c92`, using the corrected addon identified in the
report; root integrates that source as `fad3567`. No runtime changes during measurement.
The report binds the native addon, helper, runner and complete raw-report hashes. The compact
committed report retains per-command peaks and all cycle equality witnesses; the complete
samples, runner and outputs remain at `/private/tmp/photoctl-daemon-corrected-runner.3ZIJOC`.

This closes the specified sampled resource attempt on this host. Fresh installed-package,
other frame sizes, photographic acceptance and the full release gate remain separate. The
[accounting audit](daemon-diagnostic.md#remaining-accounting-audit) records other known large
native copies without treating them as demonstrated leaks.
