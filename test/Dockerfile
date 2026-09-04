FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends clang curl ca-certificates unzip && rm -rf /var/lib/apt/lists/* \
 && case "$(dpkg --print-architecture)" in \
      amd64) bun_dir=bun-linux-x64 ;; \
      arm64) bun_dir=bun-linux-aarch64 ;; \
      *) echo "Unsupported architecture" >&2; exit 1 ;; \
    esac \
 && curl -fL --retry 10 --retry-all-errors --continue-at - --output /tmp/bun.zip \
      "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/${bun_dir}.zip" \
 && unzip -q /tmp/bun.zip -d /tmp/bun \
 && install -m 0755 "/tmp/bun/${bun_dir}/bun" /usr/local/bin/bun \
 && rm -rf /tmp/bun /tmp/bun.zip \
 && curl -fsSL --retry 10 --retry-all-errors https://sh.rustup.rs | RUSTUP_MAX_RETRIES=10 sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace
COPY package.json bun.lock* bunfig.toml ./
COPY apps/cli/package.json apps/cli/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/commands/package.json packages/commands/package.json
COPY packages/importer/package.json packages/importer/package.json
COPY packages/library/package.json packages/library/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/test-harness/package.json packages/test-harness/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
CMD ["bun","run","test:ts"]
