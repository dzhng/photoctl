FROM oven/bun:1.3.14 AS bun

# Keep the established Trixie runtime/toolchain floor; older Linux ABI support
# requires a separate packaged-runtime gate.
FROM node:24-trixie AS built
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends clang gcc-14 g++-14 cmake ninja-build python3 git curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL --retry 10 --retry-all-errors https://sh.rustup.rs | RUSTUP_MAX_RETRIES=10 sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace
# Prewarm the same target-local recipe Cargo invokes. Source-only changes below
# retain this expensive layer; no runtime archive override or second downloader.
COPY crates/photoctl-image/ort crates/photoctl-image/ort
RUN python3 crates/photoctl-image/ort/prepare.py --target "$(rustc -vV | sed -n 's/^host: //p')" --cache /workspace/target/ort-runtime
COPY package.json bun.lock* bunfig.toml ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/workbench/package.json apps/workbench/package.json
COPY apps/daemon/package.json apps/daemon/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/commands/package.json packages/commands/package.json
COPY packages/importer/package.json packages/importer/package.json
COPY packages/library/package.json packages/library/package.json
COPY packages/img/package.json packages/img/package.json
COPY packages/img-darwin-arm64/package.json packages/img-darwin-arm64/package.json
COPY packages/img-darwin-x64/package.json packages/img-darwin-x64/package.json
COPY packages/img-linux-arm64-gnu/package.json packages/img-linux-arm64-gnu/package.json
COPY packages/img-linux-x64-gnu/package.json packages/img-linux-x64-gnu/package.json
COPY packages/mac-helper/package.json packages/mac-helper/package.json
COPY packages/mac-helper-darwin-arm64/package.json packages/mac-helper-darwin-arm64/package.json
COPY packages/mac-helper-darwin-x64/package.json packages/mac-helper-darwin-x64/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/test-harness/package.json packages/test-harness/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM built AS models
ARG PHOTOCTL_MODELS_BASE_URL
RUN test -n "${PHOTOCTL_MODELS_BASE_URL}" \
 && node scripts/fetch-models.mjs /opt/photoctl/models --base-url "${PHOTOCTL_MODELS_BASE_URL}"

FROM models AS functional
ENV PHOTOCTL_SAM_MODELS_DIR=/opt/photoctl/models
CMD ["sh","-c","bun run test:ts && bun run test:models"]
