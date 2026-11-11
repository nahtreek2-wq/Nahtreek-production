#!/bin/bash
# F-216: release bundle budgets. Fails the build when the JS bundle or the
# copied assets exceed budget. Budgets were set 2026-11-11 from measured
# release bundles (Home JS 2.94MB + assets 3.2MB, Pro JS 2.24MB + assets
# 1.8MB) with headroom for normal growth — bump them deliberately, with the
# new measurements in the commit message.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

check() {
  local app="$1" js_budget="$2" assets_budget="$3"
  local out="/tmp/nahtreek-bundle-$app"
  rm -rf "$out" "$out.js"
  (cd "$ROOT/apps/$app" && npx react-native bundle --platform android --dev false \
    --entry-file index.js --bundle-output "$out.js" --assets-dest "$out" >/dev/null 2>&1)
  local js_bytes assets_bytes
  js_bytes=$(wc -c < "$out.js" | tr -d ' ')
  assets_bytes=$(du -sk "$out" | cut -f1)
  assets_bytes=$((assets_bytes * 1024))
  echo "$app: JS $js_bytes / $js_budget bytes, assets $assets_bytes / $assets_budget bytes"
  if [ "$js_bytes" -gt "$js_budget" ]; then echo "OVER BUDGET: $app JS bundle"; fail=1; fi
  if [ "$assets_bytes" -gt "$assets_budget" ]; then echo "OVER BUDGET: $app assets"; fail=1; fi
  rm -rf "$out" "$out.js"
}

APP_HOME=$(ls -d "$ROOT"/apps/*Home | head -n 1 | xargs basename)
APP_PRO=$(ls -d "$ROOT"/apps/*Pro | head -n 1 | xargs basename)
check "$APP_HOME" 3300000 4200000
check "$APP_PRO" 2500000 2600000

exit "$fail"
