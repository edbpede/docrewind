#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-pure-core.sh — durable purity guard for the DocRewind pure core.
#
# The decoder / reconstruction / timeline / domain / protocol / fixtures layers
# plus the Phase 4 pure tiers (retrieval orchestration, worker pipeline, docs-url)
# MUST stay free of any browser/WXT coupling (PRD §10.2, plan Principle 2) so they
# remain unit-testable under `bun test` and storage stays swappable. This script
# greps the pure directories for forbidden imports/usages and exits non-zero on any
# match. It is wired into prek as a committed local hook so the invariant survives.
#
# Two tiers of guard:
#   BASE_PATTERN (all pure dirs): `#imports` (WXT virtual module), `browser.`
#     (extension API), and the bare `wxt` package import.
#   EXTRA_PATTERN (Phase 4 pure dirs only): also forbids a live `fetch(` call,
#     `new Worker`, and `globalThis` — so "no live fetch / Worker in the pure
#     orchestration" is MECHANICALLY enforced (plan §1.4 Architect requirement),
#     not merely aspirational. The single live `fetch` adapter lives only in
#     `entrypoints/background.ts`; the worker shell lives in `entrypoints/`.
set -euo pipefail

BASE_DIRS=(lib/decoder lib/reconstruction lib/timeline lib/domain lib/protocol lib/fixtures)
EXTRA_DIRS=(lib/retrieval lib/worker lib/docs-url)
BASE_PATTERN='#imports|browser\.|wxt'
EXTRA_PATTERN='\bfetch\(|new Worker|globalThis'

# Only scan directories that already exist (the tree is built incrementally).
existing() {
  local out=()
  for d in "$@"; do
    [ -d "$d" ] && out+=("$d")
  done
  printf '%s\n' "${out[@]}"
}

fail=0

# --- Base guard: every pure dir (base + extra) -------------------------------
mapfile -t base_scan < <(existing "${BASE_DIRS[@]}" "${EXTRA_DIRS[@]}")
if [ ${#base_scan[@]} -gt 0 ]; then
  if matches=$(grep -rnE --include='*.ts' "$BASE_PATTERN" "${base_scan[@]}"); then
    echo "ERROR: forbidden browser/WXT import found in the pure core:" >&2
    echo "$matches" >&2
    echo "The pure core must not import #imports, browser.*, or wxt." >&2
    fail=1
  fi
fi

# --- Extra guard: Phase 4 pure dirs only -------------------------------------
mapfile -t extra_scan < <(existing "${EXTRA_DIRS[@]}")
if [ ${#extra_scan[@]} -gt 0 ]; then
  if matches=$(grep -rnE --include='*.ts' "$EXTRA_PATTERN" "${extra_scan[@]}"); then
    echo "ERROR: live fetch/Worker/globalThis found in the pure orchestration dirs:" >&2
    echo "$matches" >&2
    echo "lib/retrieval, lib/worker, and lib/docs-url must not call fetch(), construct a Worker, or use globalThis. The live adapter belongs in entrypoints/background.ts." >&2
    fail=1
  fi
fi

exit "$fail"
