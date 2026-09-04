FROM oven/bun:1.3.14 AS bun

FROM node:24-bookworm
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends clang curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL --retry 10 --retry-all-errors https://sh.rustup.rs | RUSTUP_MAX_RETRIES=10 sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace
COPY package.json bun.lock* bunfig.toml ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/workbench/package.json apps/workbench/package.json
COPY apps/daemon/package.json apps/daemon/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/commands/package.json packages/commands/package.json
COPY packages/importer/package.json packages/importer/package.json
COPY packages/library/package.json packages/library/package.json
COPY packages/img/package.json packages/img/package.json
COPY packages/img-darwin-arm64/package.json packages/img-darwin-arm64/package.json
COPY packages/img-darwin-x64/package.json packages/img-darwin-x64/package.json
COPY packages/img-linux-arm64-gnu/package.json packages/img-linux-arm64-gnu/package.json
COPY packages/img-linux-x64-gnu/package.json packages/img-linux-x64-gnu/package.json
COPY packages/mac-helper/package.json packages/mac-helper/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/test-harness/package.json packages/test-harness/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
CMD ["bun","run","test:ts"]
