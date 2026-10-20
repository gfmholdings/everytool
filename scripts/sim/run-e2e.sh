#!/usr/bin/env bash
# Runs the Everytool regression suite on a booted iPhone simulator.
# Expects: the app installed, maestro on PATH, fixtures generated in $FX.
#   FX=sim-fixtures UDID=<sim udid> scripts/sim/run-e2e.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
FX="${FX:-$ROOT/sim-fixtures}"
UDID="${UDID:?set UDID}"
OUT="${OUT:-$ROOT/build/e2e}"
mkdir -p "$OUT"
INJECT="$HERE/inject.sh"
results=()
failed=0

run_flow() { # name flow-file [blocking=1]
  local name="$1" flow="$2" blocking="${3:-1}"
  echo "::group::$name"
  local slug; slug="$(echo "$flow" | sed 's/\.yaml$//')"
  mkdir -p "$OUT/$slug"
  # Run from the output dir so takeScreenshot files land with the report.
  if (cd "$OUT/$slug" && maestro --device "$UDID" test "$ROOT/.maestro/$flow" \
       --format junit --output "$OUT/$slug/report.xml" \
       --debug-output "$OUT/$slug/debug"); then
    results+=("✅ $name")
  else
    if [ "$blocking" = 1 ]; then failed=1; results+=("❌ $name"); else results+=("⚠️ $name (non-blocking)"); fi
  fi
  echo "::endgroup::"
}

check() { # name command...
  local name="$1"; shift
  if "$@"; then results+=("✅ $name"); else failed=1; results+=("❌ $name"); fi
}

run_flow "Home: all ten tools" 01_home.yaml
run_flow "Control Center routes: every tool id opens its tool" 02_controls_routes.yaml
run_flow "Clipboard: save/edit/pin/copy/paste/cut/delete" 03_clipboard.yaml

# The clip must be in the App Group document — that is what the keyboard reads.
check "Clipboard: clips reach the shared App Group vault (keyboard source)" \
  bash -c "\"$INJECT\" state | tee \"$OUT/shared-state.json\" | grep -q 'Maestro clip edited'"

run_flow "Text tools" 04_text.yaml
run_flow "Days counter + Split bill" 05_days_split.yaml
run_flow "QR: make/copy/share/history" 06_qr.yaml

"$INJECT" share convert image "$FX/photo.png"
run_flow "Convert: shared photo → JPG/PDF, save" 07_convert_shared.yaml

"$INJECT" share resize image "$FX/photo.png"
run_flow "Resize: shared photo measured + resized, save" 08_resize_shared.yaml

"$INJECT" share pdf pdf "$FX/doc.pdf"
run_flow "PDF: split + compress a shared PDF" 09_pdf_shared.yaml

"$INJECT" share stitch image "$FX/shots/shot-1.png" "$FX/shots/shot-2.png" "$FX/shots/shot-3.png"
run_flow "Long screenshot: 3 screenshots → stitch, save, share" 10_stitch_photos_shared.yaml

"$INJECT" broadcast "$FX/frames"
run_flow "Long screenshot: finished recording auto-opens + stitches, save, copy" 11_stitch_recording.yaml

# Screenshot session: Start in the app, then screenshots arrive in Photos
# one by one (as if taken while scrolling), then Stitch.
run_flow "Screenshot session: start" 12a_session_start.yaml
for f in "$FX"/session/shot-1.png "$FX"/session/shot-2.png "$FX"/session/shot-3.png; do
  xcrun simctl addmedia "$UDID" "$f"; sleep 1.5
done
# Simulator imports may not carry the Screenshot subtype on every iOS
# release, so this half reports without failing the run.
run_flow "Screenshot session: stitch + save + delete sources" 12b_session_finish.yaml 0

run_flow "Keyboard: enable + clipboard tab" 20_keyboard.yaml 0

{
  echo "## Everytool simulator regression"
  echo
  for r in "${results[@]}"; do echo "- $r"; done
} | tee "$OUT/summary.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/summary.md" >> "$GITHUB_STEP_SUMMARY"
exit $failed
