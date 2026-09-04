#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
helper=${PHOTOCTL_MAC_HELPER_PATH:-$repo/helpers/mac/.build/debug/photoctl-mac}
fixture=${PHOTOCTL_CIRAW_FIXTURE:-$repo/fixtures/a7c2.ARW}
remote_repo=${PHOTOCTL_HEADLESS_REPO:-$repo}

ssh -o BatchMode=yes -o ConnectTimeout=5 localhost \
  "cd '$remote_repo' && '$helper' decode '$fixture' --scale 0.25 --output /tmp/photoctl-g3-a.f32 && '$helper' decode '$fixture' --scale 0.25 --output /tmp/photoctl-g3-b.f32 && cmp /tmp/photoctl-g3-a.f32 /tmp/photoctl-g3-b.f32 && md5 /tmp/photoctl-g3-a.f32"
