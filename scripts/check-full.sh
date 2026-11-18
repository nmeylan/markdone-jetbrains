#!/usr/bin/env bash
# check-fast + L2 Playwright + plugin build and structure check + perf report.
set -euo pipefail
cd "$(dirname "$0")/.."

logs=build/reports/check

scripts/check-fast.sh

# Runs one step quietly; on failure prints the log tail and exits 1.
step() {
  local name=$1
  shift
  printf '%-12s' "$name"
  if "$@" >"$logs/$name.log" 2>&1; then
    echo ok
  else
    echo "FAIL (log: $logs/$name.log)"
    tail -n 40 "$logs/$name.log"
    exit 1
  fi
}

step playwright npm --prefix web run e2e
step plugin ./gradlew buildPlugin verifyPluginStructure --console=plain
scripts/perf-report.sh
