#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-pure-core.sh — durable purity guard for the DocRewind pure core.
#
# The decoder / reconstruction / timeline / domain / protocol / fixtures layers
# MUST stay free of any browser or WXT coupling (PRD §10.2, plan Principle 2) so
# they remain unit-testable under `bun test` and storage stays swappable. This
# script greps the six pure directories for forbidden imports and exits non-zero
# on any match.
# It is wired into prek as a committed local hook so the invariant survives into
# Phase 4 rather than being a one-time manual check.
#
# Forbidden tokens: `#imports` (WXT virtual module), `browser.` (extension API
# calls), and the bare `wxt` package import.
set -euo pipefail

PURE_DIRS=(lib/decoder lib/reconstruction lib/timeline lib/domain lib/protocol lib/fixtures)
PATTERN='#imports|browser\.|wxt'

# Only scan directories that already exist (the tree is built incrementally).
scan_dirs=()
for d in "${PURE_DIRS[@]}"; do
  [ -d "$d" ] && scan_dirs+=("$d")
done

if [ ${#scan_dirs[@]} -eq 0 ]; then
  exit 0
fi

if matches=$(grep -rnE --include='*.ts' "$PATTERN" "${scan_dirs[@]}"); then
  echo "ERROR: forbidden browser/WXT import found in the pure core:" >&2
  echo "$matches" >&2
  echo "The pure core (decoder/reconstruction/timeline/domain/protocol/fixtures) must not import #imports, browser.*, or wxt." >&2
  exit 1
fi

exit 0
