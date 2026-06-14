#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# verify-reproducible-build.sh — Phase 7 same-environment determinism gate.
#
# WHAT THIS PROVES (and what it deliberately does NOT):
#   Builds the two extension zips TWICE, back-to-back, in this same environment,
#   then asserts the EXTRACTED CONTENTS are byte-identical via a per-file sha256
#   manifest. This proves PER-FILE CONTENT DETERMINISM of the build *within one
#   environment* — it catches an intra-build nondeterminism regression (e.g. a
#   hash-seeded chunk name, an embedded timestamp, map-iteration-ordered output).
#
#   It does NOT prove cross-machine byte reproducibility. That is the PRD §0.9
#   STRETCH GOAL, documented (with a pinned-container recipe sketch) in
#   docs/RELEASE.md — not asserted here.
#
# NORMALIZATION: zip entry order and per-entry mtimes are environment-dependent
# zip *metadata*, so they are NORMALIZED AWAY rather than asserted stable — we
# extract each zip and hash the file CONTENTS, sorting the manifest by path. We
# never hash the zip container or any mtime.
#
# SCOPE: the two EXTENSION zips only (*-chrome.zip, *-firefox.zip). The AMO
# archive (*-sources.zip) is EXCLUDED — it is not a shipped artifact, and it is
# the most zip-metadata-noisy of the three; gating on it would add flakiness
# without protecting a shipped byte.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# The determinism gate is meaningless without the committed lockfile pinning the
# dependency graph — fail loudly and specifically if it is absent.
if [ ! -f bun.lock ]; then
  echo "FAIL: bun.lock not found at $repo_root/bun.lock." >&2
  echo "      This gate builds from the committed lockfile; run it from the repo root" >&2
  echo "      with bun.lock present (it is a tracked file)." >&2
  exit 1
fi

# Portable sha256 (sha256sum on Linux/CI; shasum -a 256 fallback on macOS).
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> bun install --frozen-lockfile"
bun install --frozen-lockfile >"$work/install.log" 2>&1 || {
  echo "FAIL: 'bun install --frozen-lockfile' failed; see log below." >&2
  cat "$work/install.log" >&2
  exit 1
}

# Build + zip both browsers, then write a per-file content sha256 manifest of the
# two extension zips' EXTRACTED contents into "$1-<kind>.sha".
hash_build() {
  local tag="$1"
  rm -f .output/*.zip
  bun run build >"$work/$tag-build.log" 2>&1
  bun run build:firefox >>"$work/$tag-build.log" 2>&1
  bun run zip >>"$work/$tag-build.log" 2>&1
  bun run zip:firefox >>"$work/$tag-build.log" 2>&1

  local kind zip ex n
  for kind in chrome firefox; do
    # Require EXACTLY one match: the preceding `rm -f .output/*.zip` plus WXT's
    # version-templated naming ({{name}}-{{version}}-{{browser}}.zip) normally
    # yields one zip per browser, but assert it rather than silently hashing
    # whichever sorts first if a stray second zip ever coexists.
    n="$(ls .output/*-"$kind".zip 2>/dev/null | wc -l | tr -d '[:space:]')"
    if [ "$n" -eq 0 ]; then
      echo "FAIL: build '$tag' produced no .output/*-$kind.zip." >&2
      cat "$work/$tag-build.log" >&2
      exit 1
    fi
    if [ "$n" -ne 1 ]; then
      echo "FAIL: build '$tag' produced $n .output/*-$kind.zip files; expected exactly 1:" >&2
      ls .output/*-"$kind".zip >&2
      exit 1
    fi
    zip="$(ls .output/*-"$kind".zip)"
    ex="$work/$tag-$kind"
    mkdir -p "$ex"
    unzip -q -o "$zip" -d "$ex"
    # Per-file content hash, path-sorted; relative paths so the temp dir name
    # (which differs between runs) never enters the manifest.
    ( cd "$ex" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
        printf '%s  %s\n' "$(sha256 "$f" | awk '{print $1}')" "$f"
      done ) >"$work/$tag-$kind.sha"
  done
}

echo "==> build #1"
hash_build a
echo "==> build #2"
hash_build b

status=0
for kind in chrome firefox; do
  if diff -u "$work/a-$kind.sha" "$work/b-$kind.sha" >"$work/$kind.diff"; then
    echo "OK: $kind extension is per-file content-deterministic across two builds."
  else
    echo "FAIL: $kind extension differs between two same-environment builds:" >&2
    cat "$work/$kind.diff" >&2
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "OK: same-environment per-file content determinism verified for both extensions."
  echo "    (Cross-machine byte reproducibility is the PRD §0.9 stretch goal — see docs/RELEASE.md.)"
fi
exit "$status"
