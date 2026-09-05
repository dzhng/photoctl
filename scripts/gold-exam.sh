#!/bin/bash
set -euo pipefail

usage() {
  echo "usage: scripts/gold-exam.sh <dir> [--out DIR] [--source-kind fixture|real|unverified]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
source_dir=$1
shift
output_dir="$PWD/out/gold-exam"
source_kind=unverified
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --out) output_dir=$2 ;;
    --source-kind) source_kind=$2 ;;
    *) usage ;;
  esac
  shift 2
done
[[ $source_kind == fixture || $source_kind == real || $source_kind == unverified ]] || usage

command -v photoctl >/dev/null 2>&1 || {
  echo "photoctl must be on PATH" >&2
  exit 69
}

mkdir -p "$output_dir"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/photoctl-gold.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
trap 'for result in "$scratch"/*.json; do if [[ -f "$result" ]]; then cat "$result" >&2; fi; done' ERR

photoctl import "$source_dir" --link --recursive >"$scratch/import.json"
photoctl list --limit 10 >"$scratch/list.json"
node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const ids = value && value.ok && value.data && value.data.ids;
  if (!Array.isArray(ids) || ids.length < 10) {
    console.error("gold exam requires at least 10 imported photos");
    process.exit(65);
  }
  for (const id of ids.slice(0, 10)) process.stdout.write(`${id}\n`);
' "$scratch/import.json" >"$scratch/ids"

ids=()
while IFS= read -r id; do ids+=("$id"); done <"$scratch/ids"
photoctl rate "${ids[@]}" --stars 5 >"$scratch/rate.json"
photoctl develop "${ids[@]:0:3}" --preset people >"$scratch/develop.json"
photoctl export "${ids[@]}" --to "$output_dir" --preset delivery >"$scratch/export.json"

node "$(dirname "$0")/gold-exam-report.mjs" "$scratch" "$output_dir" "$source_dir" "$source_kind"

if command -v wb >/dev/null 2>&1; then
  wb export "$output_dir" >/dev/null
fi

echo "$output_dir/gold-exam-report.json"
