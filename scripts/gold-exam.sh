#!/bin/bash
set -euo pipefail

usage() {
  echo "usage: scripts/gold-exam.sh <dir> [--out DIR]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
source_dir=$1
shift
output_dir="$PWD/out/gold-exam"
while [[ $# -gt 0 ]]; do
  [[ $1 == "--out" && $# -ge 2 ]] || usage
  output_dir=$2
  shift 2
done

command -v photoctl >/dev/null 2>&1 || {
  echo "photoctl must be on PATH" >&2
  exit 69
}

mkdir -p "$output_dir"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/photoctl-gold.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

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

node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const [scratch, output] = process.argv.slice(1);
  const read = name => JSON.parse(fs.readFileSync(path.join(scratch, `${name}.json`), "utf8"));
  const report = {
    schema: 1,
    source: path.resolve(process.argv[3]),
    output: path.resolve(output),
    import: read("import"),
    list: read("list"),
    rate: read("rate"),
    develop: read("develop"),
    export: read("export"),
  };
  fs.writeFileSync(path.join(output, "gold-exam-report.json"), `${JSON.stringify(report, null, 2)}\n`);
' "$scratch" "$output_dir" "$source_dir"

if command -v wb >/dev/null 2>&1; then
  wb export "$output_dir" >/dev/null
fi

echo "$output_dir/gold-exam-report.json"
