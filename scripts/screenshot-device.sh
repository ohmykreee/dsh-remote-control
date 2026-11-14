#!/usr/bin/env bash
# Capture the real device screen (never a headless browser viewport).
#
# Run this on the machine whose physical display should appear in the docs:
#
#   URL='http://192.0.2.20:4173/?page=home' \
#   OUT=shots/dark-home.png \
#   scripts/screenshot-device.sh
#
# For the question sheet use:
#   URL='http://192.0.2.20:4173/?page=home&sheet=1'
#
# Optional environment:
#   SETTLE=6          seconds to wait after opening the kiosk browser
#   CAPTURE=auto      auto | spectacle | grim | import
#   BROWSER=firefox   browser used for the kiosk window
#
# When run over SSH into a Wayland desktop, export the session's
# XDG_RUNTIME_DIR, WAYLAND_DISPLAY and DBUS_SESSION_BUS_ADDRESS first.
# Spectacle (KDE) or grim (wlroots) is needed under Wayland; ImageMagick
# `import` can capture X11/Xwayland screens.
set -euo pipefail

if [ -z "${URL:-}" ] || [ -z "${OUT:-}" ]; then
  echo "usage: URL='http://host:4173/?page=home' OUT=shots/dark-home.png $0" >&2
  exit 2
fi

browser="${BROWSER:-firefox}"
settle="${SETTLE:-6}"
workdir="${WORKDIR:-$(mktemp -d)}"
profile="$workdir/profile"
mkdir -p "$profile" "$(dirname "$OUT")"

cleanup() {
  pkill -f "firefox.*${profile}" 2>/dev/null || true
  if [ "${KEEP_WORKDIR:-0}" != "1" ]; then
    rm -rf "$workdir"
  fi
}
trap cleanup EXIT

MOZ_ENABLE_WAYLAND=1 nohup "$browser" --kiosk --no-remote --profile "$profile" "$URL" \
  >"$workdir/browser.log" 2>&1 &
sleep "$settle"

capture="${CAPTURE:-auto}"
if [ "$capture" = "auto" ]; then
  if command -v spectacle >/dev/null 2>&1; then
    capture="spectacle"
  elif command -v grim >/dev/null 2>&1; then
    capture="grim"
  elif command -v import >/dev/null 2>&1; then
    capture="import"
  else
    echo "no screenshot tool found; install spectacle (KDE), grim (wlroots) or ImageMagick" >&2
    exit 1
  fi
fi

case "$capture" in
  spectacle) spectacle --fullscreen --background --nonotify --output "$OUT" ;;
  grim) grim "$OUT" ;;
  import) import -window root "$OUT" ;;
  *) echo "unknown CAPTURE=$capture" >&2; exit 2 ;;
esac

sleep 1
if [ ! -s "$OUT" ]; then
  echo "screen capture failed; browser log follows" >&2
  cat "$workdir/browser.log" >&2
  exit 1
fi

ls -l "$OUT"
