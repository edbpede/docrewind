#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# verify-manifest.sh — Phase 7 built-artifact privacy/permission audit.
#
# Re-asserts the privacy invariant on the SHIPPED BYTES (the zipped artifacts),
# not just on wxt.config.ts. WXT generates manifest.json, so the only trustworthy
# proof is to unzip what we actually ship and read its manifest. For each
# extension zip this asserts the exact minimal footprint plus the no-remote-code
# and no-obfuscation properties required by PRD §11.4 / §12 and
# IMPLEMENTATION.md:410,414-416. Exits non-zero (naming each violation) on any
# breach; prints an OK line when the shipped bytes are clean.
#
# Scope:
#   - *-chrome.zip, *-firefox.zip  → full manifest permission/identity audit.
#   - *-sources.zip (AMO archive)  → audited ONLY for the readable-source
#     (non-obfuscated) property, not for a manifest (it carries none).
#
# Run AFTER `bun run zip` + `bun run zip:firefox`. Globs the version out of the
# filenames so it never hard-codes the package version.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

status=0
fail() {
  echo "FAIL: $*" >&2
  status=1
}

# Resolve a single .output zip matching a glob, or exit loudly if none exists.
find_zip() {
  local pat="$1" hit
  # shellcheck disable=SC2086
  hit="$(ls .output/$pat 2>/dev/null | head -1 || true)"
  if [ -z "$hit" ]; then
    echo "FAIL: no artifact matching .output/$pat." >&2
    echo "      Run 'bun run zip' and 'bun run zip:firefox' before this audit." >&2
    exit 1
  fi
  printf '%s\n' "$hit"
}

# Audit one extension manifest extracted from its shipped zip.
audit_manifest() {
  local kind="$1" zip="$2"
  local dir="$work/$kind"
  mkdir -p "$dir"
  unzip -q -o "$zip" manifest.json -d "$dir"
  local m="$dir/manifest.json"

  # Exact minimal permission footprint (PRD §12 / CONSTRAINTS §4).
  if [ "$(jq -cS '.permissions' "$m")" != '["storage"]' ]; then
    fail "$kind .permissions = $(jq -c '.permissions' "$m"), expected [\"storage\"]"
  fi
  if [ "$(jq -cS '.host_permissions' "$m")" != '["*://docs.google.com/*"]' ]; then
    fail "$kind .host_permissions = $(jq -c '.host_permissions' "$m"), expected [\"*://docs.google.com/*\"]"
  fi

  # Never the broad host grant, anywhere in the manifest.
  if grep -q '<all_urls>' "$m"; then
    fail "$kind manifest contains <all_urls>"
  fi

  # No remote-code / remote-connection manifest keys.
  for key in externally_connectable update_url; do
    if [ "$(jq --arg k "$key" 'has($k)' "$m")" = "true" ]; then
      fail "$kind manifest declares remote-code-adjacent key '$key'"
    fi
  done
  # A CSP, if present, must not whitelist a remote (http/https) code origin.
  if [ "$(jq 'has("content_security_policy")' "$m")" = "true" ]; then
    if jq -r '.content_security_policy | tostring' "$m" | grep -qiE 'https?://'; then
      fail "$kind content_security_policy references a remote origin"
    fi
  fi

  # MV3 floor (both browsers are built MV3 — see wxt.config.ts).
  if [ "$(jq '.manifest_version' "$m")" != "3" ]; then
    fail "$kind manifest is not MV3 (manifest_version != 3)"
  fi

  # Firefox identity + event-page background (MV3 Firefox uses background.scripts,
  # not a service_worker).
  if [ "$kind" = "firefox" ]; then
    if [ -z "$(jq -r '.browser_specific_settings.gecko.id // empty' "$m")" ]; then
      fail "firefox manifest missing browser_specific_settings.gecko.id"
    fi
    if [ "$(jq '(.background.scripts // []) | length' "$m")" -eq 0 ]; then
      fail "firefox manifest missing event-page background.scripts"
    fi
  fi
}

chrome_zip="$(find_zip '*-chrome.zip')"
firefox_zip="$(find_zip '*-firefox.zip')"
echo "==> auditing $(basename "$chrome_zip") + $(basename "$firefox_zip")"
audit_manifest chrome "$chrome_zip"
audit_manifest firefox "$firefox_zip"

# --- No-obfuscation, minification-with-sources (PRD §11.4 / IMPLEMENTATION.md:410) ---
# (1) wxt.config.ts must declare no obfuscation/terser-obfuscate plugin. Vite's
#     default esbuild minify is fine (minification WITH sources is allowed);
#     only an explicit obfuscator plugin is prohibited. Strip comment lines so a
#     doc comment merely naming the banned tooling is exempt.
if grep -nEi 'obfuscat|javascript-obfuscator|rollup-plugin-obfuscator|\bterser\b' wxt.config.ts \
  | sed -E 's/^[0-9]+://' \
  | grep -vE '^[[:space:]]*(//|\*|/\*)' \
  | grep -qEi 'obfuscat|terser'; then
  fail "wxt.config.ts appears to declare an obfuscation/terser plugin (obfuscation is prohibited)"
fi

# (2) The AMO sources archive must carry readable (non-obfuscated) source. Use
#     wxt.config.ts (stored at the archive root) as the anchor: a real,
#     human-readable source file still containing its defineConfig call.
sources_zip="$(find_zip '*-sources.zip')"
src_dir="$work/sources"
mkdir -p "$src_dir"
if unzip -q -o "$sources_zip" 'wxt.config.ts' -d "$src_dir" 2>/dev/null \
  && grep -q 'defineConfig' "$src_dir/wxt.config.ts" 2>/dev/null; then
  : # readable, non-obfuscated source confirmed
else
  fail "sources archive lacks readable wxt.config.ts (defineConfig token absent)"
fi

if [ "$status" -eq 0 ]; then
  echo "OK: shipped manifests carry the exact minimal footprint (storage + docs.google.com only),"
  echo "    no <all_urls>, no remote-code keys; firefox has gecko.id + event-page; sources are readable."
fi
exit "$status"
