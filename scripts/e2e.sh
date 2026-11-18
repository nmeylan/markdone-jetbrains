#!/usr/bin/env bash
# L5 real-IDE end-to-end tests + IDE-side perf. One command, exit 0/1, 2 = environment missing.
# Options (environment): E2E_MODES=inprocess,oop (default both)  E2E_HUGE=true|false (default true)
#   E2E_ALLOW_DISPLAY=1 (without xvfb-run: use the current display; the IDE takes the mouse and keyboard)
#   E2E_WORKSPACE=3 (with E2E_ALLOW_DISPLAY on Hyprland: workspace for the IDE windows; empty = do not move them)
#   E2E_SCALE=2 (GDK_SCALE of the test IDE: 2 = HiDPI, JCEF device scale factor 2; 1 = no scaling)
# Full logs: build/reports/e2e/ (l5.log, gradle.log, junit/, key-routing-*.md, metrics-*.json, perf-ide-*.jsonl, requests-*.json).
set -euo pipefail
cd "$(dirname "$0")/.."

logs=build/reports/e2e
modes=${E2E_MODES:-inprocess,oop}
huge=${E2E_HUGE:-true}

# The IDE needs an X display: Xvfb, or the current display (Xwayland is fine) only with E2E_ALLOW_DISPLAY=1.
# The IDE scale comes from GDK_SCALE; set it here so the result does not depend on the caller's environment.
# Under Xvfb the screen is 3840x2160 device px: at scale 2 that is 1920x1080 for Swing and java.awt.Robot.
if [[ -z ${MARKDONE_E2E_UNDER_XVFB:-} ]] && command -v xvfb-run >/dev/null; then
  export MARKDONE_E2E_UNDER_XVFB=1
  export GDK_SCALE=${E2E_SCALE:-2}
  exec xvfb-run -a -s '-screen 0 3840x2160x24' "$0" "$@"
fi
if [[ -z ${MARKDONE_E2E_UNDER_XVFB:-} ]]; then
  if [[ ${E2E_ALLOW_DISPLAY:-} != 1 ]]; then
    echo "e2e: xvfb-run not found (package xorg-server-xvfb). To use the current display instead, set E2E_ALLOW_DISPLAY=1:" \
      "the IDE then moves the mouse and types on it." >&2
    exit 2
  fi
  if [[ -z ${DISPLAY:-} ]]; then
    echo "e2e: no xvfb-run and no DISPLAY; cannot start the IDE." >&2
    exit 2
  fi
  echo "e2e: WARNING: xvfb-run not found; IDE windows appear on DISPLAY=$DISPLAY. Do not use the computer while it runs."
  if [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} && -n ${E2E_WORKSPACE-3} ]] && command -v hyprctl >/dev/null; then
    echo "e2e: Hyprland: IDE windows go to workspace ${E2E_WORKSPACE-3} (E2E_WORKSPACE; empty = off); key tests move your input focus there."
  fi
fi
for tool in node unzip; do
  command -v "$tool" >/dev/null || { echo "e2e: $tool not found" >&2; exit 2; }
done
[[ -d web/node_modules/@playwright/test ]] || { echo "e2e: run 'npm ci' in web/ first" >&2; exit 2; }

rm -rf "$logs" build/e2e
mkdir -p "$logs"

# Stops every sandbox IDE (and its JCEF helpers) started from build/e2e/, also on Ctrl-C.
cleanup() {
  local pid
  for pid in $(pgrep -f -- "-Didea.properties.file=$PWD/build/e2e/" || true); do
    pkill -KILL -P "$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

if [[ $huge == true && ! -f src/test/resources/corpus/huge.md ]]; then
  node web/scripts/gen-corpus.mjs huge >"$logs/gen-corpus.log" 2>&1
fi

start=$(date +%s)
status=0
./gradlew uiTest --console=plain "-Pmarkdone.e2e.modes=$modes" "-Pmarkdone.e2e.huge=$huge" >"$logs/gradle.log" 2>&1 || status=$?
echo "e2e: tests finished in $(($(date +%s) - start)) s (exit $status)"
grep -E 'E2eTest > .* (PASSED|FAILED|SKIPPED)' "$logs/gradle.log" | sed 's/^/  /' || true
grep -h '\] metric ' "$logs/l5.log" 2>/dev/null | sed 's/^\[[^]]*\] /  /' || true

# In-process numbers with budget keys go to build/reports/perf.json (read-modify-write).
# L5 keys of earlier runs are removed first: Milkdown-era memoryPerEditTabPssMB, and
# hugeEditModeOpenMs when this run did not measure it.
node -e '
  const fs = require("fs");
  const perfPath = "build/reports/perf.json";
  const budget = JSON.parse(fs.readFileSync("perf-budget.json", "utf8")).metrics;
  const perf = fs.existsSync(perfPath) ? JSON.parse(fs.readFileSync(perfPath, "utf8")) : {};
  for (const k of ["memoryPerEditTabPssMB", "hugeEditModeOpenMs"]) delete perf[k];
  for (const file of ["metrics-inprocess.json", "metrics-startup.json"]) {
    const p = "build/reports/e2e/" + file;
    if (!fs.existsSync(p)) continue;
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(p, "utf8")))) if (k in budget) perf[k] = v;
  }
  fs.writeFileSync(perfPath, JSON.stringify(perf, null, 2) + "\n");
'
scripts/perf-report.sh >"$logs/perf-report.log" 2>&1 || status=1
sed 's/^/  /' "$logs/perf-report.log"

if [[ $status -ne 0 ]]; then
  echo "e2e: FAIL (logs: $logs/gradle.log, $logs/l5.log, $logs/junit/)"
  exit 1
fi
echo "e2e: ok"
