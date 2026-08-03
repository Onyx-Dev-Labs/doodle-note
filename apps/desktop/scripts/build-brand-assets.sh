#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DESKTOP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(CDPATH= cd -- "$DESKTOP_DIR/../.." && pwd)
MASTER="$DESKTOP_DIR/resources/icon-master.png"
TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/doodlenote-brand-assets.XXXXXX")
ICONSET="$TEMP_ROOT/DoodleNote.iconset"
mkdir "$ICONSET"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

resize_png() {
  size=$1
  output=$2
  sips -z "$size" "$size" "$MASTER" --out "$output" >/dev/null
}

resize_png 1024 "$DESKTOP_DIR/resources/icon.png"
resize_png 249 "$DESKTOP_DIR/src/renderer/src/assets/mascot-square.png"
resize_png 249 "$REPO_DIR/apps/web/public/mascot.png"
resize_png 249 "$REPO_DIR/apps/ios/DoodleNote/Assets.xcassets/Mascot.imageset/mascot.png"

for size in 16 32 128 256 512; do
  resize_png "$size" "$ICONSET/icon_${size}x${size}.png"
  retina=$((size * 2))
  resize_png "$retina" "$ICONSET/icon_${size}x${size}@2x.png"
done

iconutil --convert icns --output "$DESKTOP_DIR/resources/icon.icns" "$ICONSET"
sips -z 256 256 -s format ico "$MASTER" --out "$DESKTOP_DIR/resources/icon.ico" >/dev/null
