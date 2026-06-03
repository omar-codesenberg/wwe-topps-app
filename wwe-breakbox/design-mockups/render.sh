#!/bin/bash
# Render each HTML mockup to a high-res JPEG via headless Chrome + sips.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd "$DIR"
for html in "$@"; do
  base="${html%.html}"
  echo "rendering $html ..."
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=430,932 \
    --virtual-time-budget=3500 \
    --screenshot="$DIR/$base.png" "file://$DIR/$html" >/dev/null 2>&1
  sips -s format jpeg -s formatOptions 90 "$DIR/$base.png" --out "$DIR/$base.jpg" >/dev/null
  rm -f "$DIR/$base.png"
  echo "  -> $base.jpg"
done
