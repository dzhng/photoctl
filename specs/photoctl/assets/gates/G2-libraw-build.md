# G2 — LibRaw native build

**Verdict: PASS (2026-09-05).**

The native boundary vendors the CDDL option of LibRaw 0.22.2. The source archive and checksum are
recorded in [`crates/libraw-sys/README.md`](../../../../crates/libraw-sys/README.md). Its build scans
the upstream C++ source tree, excludes only the upstream `_ph` alternate placeholder implementations,
and supplies no OpenMP compiler or linker flag.

On Apple silicon, `otool -L packages/img-darwin-arm64/photoctl-image.darwin-arm64.node` reported only
the addon's own install name plus `/usr/lib/libc++.1.dylib`, `/usr/lib/libiconv.2.dylib`, and
`/usr/lib/libSystem.B.dylib`. There was no Homebrew path and no `libomp` dependency. The fixture probe
reported TIFF compression `1`, dimensions `7008×4672`, LibRaw `0.22.2-Release`, and
`camXyz[0] = 0.7460` within the required `5e-4` tolerance.

The portable build and real CLI path passed on Linux ARM64 with:

```sh
docker compose -f test/compose.yaml build functional
docker compose -f test/compose.yaml run --rm --no-deps functional \
  bun run test:ts -- apps/cli/src/decoder-libraw.test.ts
```

LibRaw's `_ph.cpp` files are mutually exclusive placeholder implementations, not additional translation
units: ELF rejects their duplicate symbols when the full postprocessing sources are present. Recursive
source discovery therefore filters those upstream alternatives. `LIBRAW_NOTHREADS` also replaces the
thread-local AHD scratch state with shared static data, so the build keeps LibRaw thread-safe while
disabling OpenMP solely by omitting OpenMP build flags.
