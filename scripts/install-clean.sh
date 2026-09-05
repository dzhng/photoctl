#!/bin/bash
set -euo pipefail
[[ $# == 2 ]] || { echo 'usage: scripts/install-clean.sh <prefix> <tarball-directory>' >&2; exit 2; }
prefix=$1
packages=$2
shopt -s nullglob
tarballs=("$packages"/*.tgz)
[[ ${#tarballs[@]} -gt 0 ]] || { echo 'No package tarballs found' >&2; exit 2; }
npm install -g --prefix "$prefix" "${tarballs[@]}" --no-audit --no-fund
