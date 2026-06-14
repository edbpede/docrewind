#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# checksums.sh — Phase 7 release checksum emitter.
#
# Emits a SHA256SUMS file over every zip in .output/ (globbed — never
# version-hard-coded), covering both shipped extension archives AND the AMO
# *-sources.zip (reviewers checksum the source archive too). The format is the
# standard `sha256sum -c`-compatible "<hash>␠␠<name>" with bare basenames, so a
# downloader can verify with `sha256sum -c SHA256SUMS` from inside .output/.
#
# Run AFTER `bun run zip` + `bun run zip:firefox`. Build provenance (Bun version,
# bun.lock sha256, git sha, date) is recorded separately in docs/RELEASE.md.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Portable sha256 (sha256sum on Linux/CI; shasum -a 256 fallback on macOS).
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

shopt -s nullglob
zips=(.output/*.zip)
shopt -u nullglob

if [ "${#zips[@]}" -eq 0 ]; then
  echo "FAIL: no .output/*.zip artifacts found." >&2
  echo "      Run 'bun run zip' and 'bun run zip:firefox' before generating checksums." >&2
  exit 1
fi

out=".output/SHA256SUMS"
: >"$out"
for zip in "${zips[@]}"; do
  # Hash with a bare basename so SHA256SUMS verifies from within .output/.
  ( cd .output && sha256 "$(basename "$zip")" ) >>"$out"
done

echo "==> wrote $out"
cat "$out"
