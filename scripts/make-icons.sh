#!/bin/sh
# Regenerate the raster icon set from public/favicon.svg, the way lila's
# bin/gen/favicons does from its 1024px master.
#
#   npm run icons
#
# Requires rsvg-convert and ImageMagick (`magick`). public/favicon.svg is the
# master for the favicon, PWA and home-screen rasters; public/keymark.svg is
# the bare mark Safari uses as its pinned-tab mask. Both carry the same mark:
# U+26B7 CHIRON, the key whose bit is a K. It is mirrored so the K sits at the
# bottom, the way a key is normally drawn (the outline is STIX Two Math's).
set -eu
cd "$(dirname "$0")/.."

src=public/favicon.svg
out=public/icons
mkdir -p "$out"

for px in 32 64 128 192 256 512; do
  rsvg-convert -w "$px" -h "$px" "$src" -o "$out/favicon-$px.png"
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# apple-touch-icon is full-bleed: iOS applies its own corner mask, so the
# favicon's rounded corners would leave transparent notches on the home screen.
sed 's/ rx="12"//' "$src" > "$tmp/apple-touch.svg"
rsvg-convert -w 180 -h 180 "$tmp/apple-touch.svg" -o public/apple-touch-icon.png

# a multi-size ICO for the browsers and crawlers that still ask for /favicon.ico
for px in 16 32 48; do
  rsvg-convert -w "$px" -h "$px" "$src" -o "$tmp/$px.png"
done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" public/favicon.ico

echo "wrote $out/favicon-*.png, public/apple-touch-icon.png, public/favicon.ico"
