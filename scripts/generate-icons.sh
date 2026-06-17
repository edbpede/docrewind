#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# generate-icons.sh — render the committed extension icon PNGs from the canonical
# SVG. The PNGs in public/icon/ are the BUILD INPUT (WXT auto-detects
# public/icon/{size}.png and wires manifest.icons + action.default_icon), so they
# are committed to keep `bun run build` deterministic and dependency-free — no
# build-time rasterizer (sharp) ever runs. Re-run this ONLY when the icon art
# changes, then commit the regenerated PNGs.
#
# Requires a local rasterizer: rsvg-convert (preferred) or ImageMagick `magick`.
#   macOS:  brew install librsvg            # or: brew install imagemagick
#   Debian: apt-get install librsvg2-bin    # or: apt-get install imagemagick
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

src="public/icon/docrewind.svg"
out_dir="public/icon"
sizes=(16 32 48 96 128)

if [ ! -f "$src" ]; then
  echo "FAIL: canonical source $src not found." >&2
  exit 1
fi

render() {
  local size="$1" target="$out_dir/$size.png"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" -o "$target" "$src"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none -density 384 "$src" -resize "${size}x${size}" "$target"
  elif command -v convert >/dev/null 2>&1; then
    convert -background none -density 384 "$src" -resize "${size}x${size}" "$target"
  else
    echo "FAIL: no rasterizer found (install librsvg or imagemagick)." >&2
    exit 1
  fi
  echo "  rendered $target"
}

echo "==> rendering $src → $out_dir/{${sizes[*]}}.png"
for size in "${sizes[@]}"; do
  render "$size"
done
echo "OK: ${#sizes[@]} icon PNGs regenerated."
