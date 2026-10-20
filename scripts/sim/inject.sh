#!/usr/bin/env bash
# Writes files into the booted simulator's App Group container exactly the
# way the share extension (ShareInbox) or the broadcast extension
# (BroadcastInbox) does, so the app's real drain/route code runs.
#
#   inject.sh share <tool> <kind> <file>...   # kind: image | pdf | text
#   inject.sh broadcast <frames-dir>          # dir with frame PNGs + index.json
#   inject.sh state                           # prints the shared vault JSON
set -euo pipefail
BUNDLE=app.everytool.ios
GROUP=group.app.everytool.ios
GROUP_DIR="$(xcrun simctl get_app_container booted "$BUNDLE" "$GROUP")"

case "${1:-}" in
  share)
    tool="$2"; kind="$3"; shift 3
    dir="$GROUP_DIR/ShareInbox"; mkdir -p "$dir"
    entries=""
    for f in "$@"; do
      ext="${f##*.}"
      name="share-$(date +%s%N)-$RANDOM.$ext"
      cp "$f" "$dir/$name"
      at=$(($(date +%s) * 1000))
      entries="$entries{\"file\":\"$name\",\"kind\":\"$kind\",\"tool\":\"$tool\",\"at\":$at},"
    done
    echo "{\"items\":[${entries%,}]}" > "$dir/index.json"
    echo "share inbox: $(cat "$dir/index.json")"
    ;;
  broadcast)
    src="$2"
    dir="$GROUP_DIR/BroadcastInbox"; rm -rf "$dir"; mkdir -p "$dir"
    cp "$src"/*.png "$src/index.json" "$dir/"
    echo "broadcast inbox: $(ls "$dir" | wc -l | tr -d ' ') files"
    ;;
  state)
    plist="$GROUP_DIR/Library/Preferences/$GROUP.plist"
    if [ -f "$plist" ]; then
      /usr/libexec/PlistBuddy -c "Print :everytool.state.v1" "$plist" 2>/dev/null || plutil -p "$plist"
    else
      echo "NO_SHARED_STATE ($plist missing)"
    fi
    ;;
  *)
    echo "usage: inject.sh share|broadcast|state ..." >&2; exit 2;;
esac
