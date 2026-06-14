#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Static network-isolation guard (Phase 6 WI-5 / PRD §17), complementary to the
# runtime audit e2e/network-isolation.spec.ts. Defense-in-depth: the runtime
# audit proves isolation for the exercised flow; this lint proves no source line
# even NAMES a non-Google network target or reaches for a non-fetch network API.
#
# Greps lib/ + entrypoints/ (production .ts/.tsx, excluding tests/specs/fixtures)
# for:
#   1. absolute http(s):// URLs in CODE (comment lines are exempt — the codebase
#      cites third-party repos like github.com/harvard-vpal/gdocrevisions in
#      doc comments), allowing only docs.google.com.
#   2. non-fetch network egress APIs (XMLHttpRequest / WebSocket / EventSource /
#      sendBeacon / importScripts). `fetch(` is the extension's single, Google-only
#      network path and is allowed; rule 1 catches any foreign literal it targets.
#
# Exits non-zero (and prints offending lines) on any violation.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

scan_dirs=(lib entrypoints)
allowed_host="docs.google.com"
status=0

# Collect production source files (skip tests, specs, fixtures).
mapfile -t files < <(
  find "${scan_dirs[@]}" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.spec.ts' \
    ! -path '*/fixtures/*' | sort
)

# Rule 1 — foreign absolute URLs in non-comment code lines.
foreign_urls=""
for f in "${files[@]}"; do
  # Strip whole-line comments (// … and * … / /* …) before matching, so cited
  # repo URLs in doc comments are exempt while code-line literals are checked.
  while IFS= read -r line; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      //*|\**|/\**) continue ;;
    esac
    while read -r host; do
      [ -z "$host" ] && continue
      if [ "$host" != "$allowed_host" ]; then
        foreign_urls+="$f: $host"$'\n'
      fi
    done < <(printf '%s\n' "$line" | grep -oE 'https?://[A-Za-z0-9.-]+' | sed -E 's#^https?://##')
  done < "$f"
done

if [ -n "$foreign_urls" ]; then
  echo "FAIL: foreign absolute URL(s) referenced in production code (allowed: $allowed_host):"
  printf '%s' "$foreign_urls"
  status=1
fi

# Rule 2 — non-fetch network egress APIs.
egress_hits="$(grep -rEn 'XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\(' "${files[@]}" || true)"
if [ -n "$egress_hits" ]; then
  echo "FAIL: non-fetch network egress API used in production code:"
  printf '%s\n' "$egress_hits"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "OK: no foreign hosts or non-fetch egress APIs in lib/ + entrypoints/ (only $allowed_host)."
fi
exit "$status"
