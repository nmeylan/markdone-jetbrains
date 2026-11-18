#!/usr/bin/env bash
# L1 + L3/L4: typecheck, lint, vitest, Gradle tests. Full logs in build/reports/check/.
set -euo pipefail
cd "$(dirname "$0")/.."

logs=build/reports/check
mkdir -p "$logs"

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

if [ ! -d web/node_modules ]; then
  step npm-ci npm --prefix web ci --no-audit --no-fund
fi
step typecheck npm --prefix web run typecheck
step lint npm --prefix web run lint
step vitest npm --prefix web test
step gradle-test ./gradlew test --console=plain
