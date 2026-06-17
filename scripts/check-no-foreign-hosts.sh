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
# Single allowed NETWORK host = the confirmed minimal footprint (PRD §12 /
# CONSTRAINTS.md §4: never `<all_urls>` or broader), matching the manifest's lone
# `*://docs.google.com/*` permission. Adding a network host is a deliberate
# doc+manifest decision, not a lint workaround. Keep in sync with
# e2e/network-isolation.spec.ts.
allowed_host="docs.google.com"
# Non-fetch DISPLAY hosts: hosts that only ever appear as user-facing anchor
# hrefs (e.g. the About panel's "Source"/author links to this project's own
# GitHub repo). These open in the user's browser via <a target="_blank">, are
# never fetched by the extension, and need no host permission — so they do not
# widen the network footprint that allowed_host guards. Keep this list to the
# project's own repository host; a NEW fetch target still belongs in the
# manifest+allowed_host path above, not here.
allowed_display_hosts=("github.com")
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
      [ "$host" = "$allowed_host" ] && continue
      is_display=0
      for dh in "${allowed_display_hosts[@]}"; do
        [ "$host" = "$dh" ] && is_display=1 && break
      done
      [ "$is_display" -eq 1 ] && continue
      foreign_urls+="$f: $host"$'\n'
    done < <(printf '%s\n' "$line" | grep -oE 'https?://[A-Za-z0-9.-]+' | sed -E 's#^https?://##')
  done < "$f"
done

if [ -n "$foreign_urls" ]; then
  echo "FAIL: foreign absolute URL(s) referenced in production code (allowed: $allowed_host, display-only: ${allowed_display_hosts[*]}):"
  printf '%s' "$foreign_urls"
  status=1
fi

# Rule 2 — non-fetch network egress APIs in non-comment code lines. Mirrors
# rule 1's comment-strip so a doc comment merely naming a banned API (e.g.
# "// not using XMLHttpRequest because…") is exempt while code uses still fail.
egress_hits=""
for f in "${files[@]}"; do
  lineno=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      //*|\**|/\**) continue ;;
    esac
    if printf '%s\n' "$line" | grep -qE 'XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\('; then
      egress_hits+="$f:$lineno:$line"$'\n'
    fi
  done < "$f"
done
if [ -n "$egress_hits" ]; then
  echo "FAIL: non-fetch network egress API used in production code:"
  printf '%s\n' "$egress_hits"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "OK: no foreign hosts or non-fetch egress APIs in lib/ + entrypoints/ (only $allowed_host)."
fi
exit "$status"
