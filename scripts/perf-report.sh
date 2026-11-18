#!/usr/bin/env bash
# Compares build/reports/perf.json with perf-budget.json.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/perf-report.mjs
