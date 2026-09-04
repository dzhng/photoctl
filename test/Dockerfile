FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends clang curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
ENV PATH="/root/.bun/bin:/root/.cargo/bin:${PATH}"
WORKDIR /workspace
COPY package.json bun.lock* bunfig.toml ./
COPY apps/cli/package.json apps/cli/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/commands/package.json packages/commands/package.json
COPY packages/test-harness/package.json packages/test-harness/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
CMD ["bun","run","test:ts"]
