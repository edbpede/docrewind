#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-coverage-gate-disjoint.sh — durable guard for the Phase 6 coverage gate
# (Decision D1), enforcing the ONE static invariant that keeps the gate honest.
#
# The gated tier is defined POSITIVELY by the path args of the `test:coverage`
# script in package.json (currently `./lib/core/docs/decoder ./lib/core/docs/reconstruction`) and the
# per-file floor is shaped NEGATIVELY by `coveragePathIgnorePatterns` in
# bunfig.toml (which drops transitively-loaded non-gated modules from the report).
# These two lists are NOT complements of each other — the ignore list mirrors the
# gated tests' runtime import graph, not "test:logic minus gated" — so they cannot
# be derived from one another statically, and asserting complement-equality would
# wrongly fail the correct config. See the bunfig.toml [test] comment for the full
# transitive-import semantics.
#
# What CAN and MUST hold statically is DISJOINTNESS: a directory gated by
# `test:coverage` must never have its WHOLE SELF suppressed by
# `coveragePathIgnorePatterns`. If it were, the gate would load that directory's
# files but suppress them from the per-file floor — a VACUOUS gate that reports
# "pass" while measuring nothing. This is the one coherent silent-drift failure
# mode; this guard catches it.
#
# Granularity: only WHOLE-DIRECTORY suppression globs (`**/lib/<dir>/**`) count as
# gating violations. A SINGLE-FILE exemption (`**/lib/core/docs/decoder/thin-adapter.ts`) is
# the sanctioned iter3 escape hatch — it exempts one file inside a gated tier that
# cannot meet the per-file floor while the rest of the tier stays measured — so it
# is explicitly PERMITTED and never trips this guard, even though its path contains
# a gated-dir segment.
#
# Exits non-zero (naming the offending dir) if a gated dir is suppressed wholesale.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Gated paths: the positional path args of the `test:coverage` script, dropping the
# `bun test --coverage` prefix flags. Normalized to bare dir names (strip ./ and
# trailing /) for matching against the ignore globs.
mapfile -t gated < <(
  jq -r '.scripts["test:coverage"]' package.json \
    | tr ' ' '\n' \
    | grep -E '^\./lib/' \
    | sed -E 's#^\./##; s#/$##'
)

if [ "${#gated[@]}" -eq 0 ]; then
  echo "FAIL: could not parse any ./lib/* gated paths from package.json test:coverage." >&2
  exit 1
fi

# Ignore-list dirs: ONLY the whole-directory suppression globs `**/lib/<dir>/**`
# from bunfig.toml's coveragePathIgnorePatterns, normalized to the bare `lib/<dir>`
# form. We deliberately anchor extraction on a trailing `/**` so that single-file
# exemptions (the iter3 escape hatch — e.g. `**/lib/core/docs/decoder/thin-adapter.ts`, which
# ends in a specific filename) are NOT treated as gating their parent dir. A
# single-file exemption inside a gated tier is sanctioned: it exempts one file that
# cannot meet the per-file floor while the rest of the tier stays gated, so it must
# NOT trip the disjointness check. Only suppressing the WHOLE directory makes the
# gate vacuous, and only that shape (`.../lib/<dir>/**`) is captured here.
mapfile -t ignored < <(
  python3 - <<'PY'
import re, tomllib
with open("bunfig.toml", "rb") as fh:
    cfg = tomllib.load(fh)
for pat in cfg.get("test", {}).get("coveragePathIgnorePatterns", []):
    # Match only whole-directory suppression: pattern ends in `/lib/<path>/**`.
    # Captures the FULL nested lib path (e.g. `lib/core/domain`), so it matches the
    # gated paths, which are also full nested dirs (e.g. `lib/core/docs/decoder`).
    # Single-file globs (ending in a `*.ts`/`*.tsx` filename) are intentionally skipped.
    m = re.search(r'(lib/[^*]+?)/\*\*$', pat)
    if m:
        print(m.group(1))
PY
)

# Disjointness check: no gated dir may also appear in the ignore list.
status=0
for g in "${gated[@]}"; do
  for i in "${ignored[@]}"; do
    if [ "$g" = "$i" ]; then
      echo "FAIL: '$g' is gated by test:coverage AND ignored by coveragePathIgnorePatterns." >&2
      echo "       A gated dir that is also ignored makes the coverage gate VACUOUS" >&2
      echo "       (its files load but are suppressed from the per-file floor)." >&2
      echo "       Remove '**/$i/**' from bunfig.toml, or drop ./$g from test:coverage." >&2
      status=1
    fi
  done
done

if [ "$status" -eq 0 ]; then
  echo "OK: coverage-gated dirs (${gated[*]}) are disjoint from the ignore list (${ignored[*]})."
fi
exit "$status"
