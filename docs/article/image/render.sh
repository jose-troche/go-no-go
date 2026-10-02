#!/usr/bin/env bash
# Renders cover.html to PNGs with headless Chrome. Run from anywhere after `npm install` (fonts come from node_modules).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(dirname "$here")"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

render() { # format width height output
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=3000 \
    --window-size="$2,$3" --screenshot="$4" "file://$here/cover.html?format=$1" >/dev/null 2>&1
}

render square 1200 1200 "$out/go-no-go-post.png"
render wide 1920 1080 "$out/go-no-go-cover.png"
echo "Wrote $out/go-no-go-post.png and $out/go-no-go-cover.png"
