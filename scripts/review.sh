#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# review.sh — deterministic "hands" of the Goose + NanoGPT PR reviewer.
#
# Goose (the brain) reads the diff and emits one structured review object; this
# script validates it, filters its comments to valid diff anchors, and posts a
# single COMMENT review via `gh api`. The model is never given tools, so this
# shell is the only thing that touches GitHub.
#
# Pipeline:
#   gate A : tiered goose fallback loop -> schema-valid review.json
#   gate B : anchor pre-filter (hunk-lines.awk + jq) -> payload.json
#            422-tolerant single-review POST
#
# Every stage is env-overridable so it can be exercised with stub `goose`/`gh`
# binaries on PATH (see scripts/test/run-pr-review-tests.sh). Live posting needs
# REPO / PR / HEAD_SHA / GH_TOKEN and a real NANOGPT_API_KEY (CI only).

set -euo pipefail

# --- configuration (env-overridable) ----------------------------------------
RECIPE="${RECIPE:-.goose/recipe.yaml}"
DIFF_FILE="${DIFF_FILE:-diff.patch}"
WORKDIR="${WORKDIR:-.}"
AWK_SCRIPT="${AWK_SCRIPT:-scripts/hunk-lines.awk}"
MARKER="${MARKER:-<!-- goose-pr-reviewer -->}"
MAX_DIFF_BYTES="${MAX_DIFF_BYTES:-400000}"
GOOSE_TIMEOUT="${GOOSE_TIMEOUT:-300}"
POST_RETRY_MAX="${POST_RETRY_MAX:-5}"
SKIP_POST="${SKIP_POST:-0}"   # tests set 1 to stop after building payload.json

# Priority-ordered model tiers; REVIEW_MODELS overrides for tests.
DEFAULT_MODELS="deepseek/deepseek-v4-pro-cheaper:thinking xiaomi/mimo-v2.5-pro:thinking minimax/minimax-m3:thinking"
REVIEW_MODELS="${REVIEW_MODELS:-$DEFAULT_MODELS}"

mkdir -p "$WORKDIR"
RAW_OUT="$WORKDIR/raw.out"
GOOSE_ERR="$WORKDIR/goose.err"
CLEANED="$WORKDIR/cleaned.out"
REVIEW_JSON="$WORKDIR/review.json"
VALID_TSV="$WORKDIR/valid_lines.tsv"
FILTERED_JSON="$WORKDIR/filtered.json"
PAYLOAD="$WORKDIR/payload.json"
POST_ERR="$WORKDIR/post.err"

ESC=$(printf '\033')   # real ESC byte; portable across BSD/GNU sed

# --- timeout resolver (timeout on CI, gtimeout on some macs, no-op otherwise) -
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"; fi
run_with_timeout() {
  if [ -n "$TIMEOUT_BIN" ]; then "$TIMEOUT_BIN" "$GOOSE_TIMEOUT" "$@"; else "$@"; fi
}

log() { echo "$@" >&2; }

# --- JSON extraction: robust to ANSI + leading reasoning text from :thinking --
# 1) whole-output parse  (production path: response.json_schema -> clean JSON)
# 2) jq brace-scan        (fallback: last top-level object after prose/reasoning)
# A bad extraction is rejected by gate A and degrades to the next tier, never a
# wrong post. Limitation: the scan can mis-balance on braces inside a comment
# body code block — acceptable because (1) is the primary path under the schema.
extract_json() {
  raw="$1"; out="$2"
  sed "s/${ESC}\[[0-9;]*[a-zA-Z]//g" "$raw" > "$CLEANED" 2>/dev/null || cp "$raw" "$CLEANED"
  if jq -ce . "$CLEANED" > "$out" 2>/dev/null && [ -s "$out" ]; then
    return 0
  fi
  if jq -Rsc '[scan("\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}")] | last // empty' "$CLEANED" 2>/dev/null \
       | jq -ce 'fromjson' > "$out" 2>/dev/null && [ -s "$out" ]; then
    return 0
  fi
  return 1
}

# --- gate A: schema sanity (type + COMMENT-only) -----------------------------
validate_gate_a() {
  jq -e '
    .review_event == "COMMENT"
    and (.summary | type == "string")
    and (.comments | type == "array")
    and (.should_post_review | type == "boolean")
  ' "$1" >/dev/null 2>&1
}

# --- tiered fallback loop -> review.json -------------------------------------
run_review() {
  attempt=0; ok=0; host_fail=0
  for model in $REVIEW_MODELS; do
    attempt=$((attempt + 1))
    : > "$GOOSE_ERR"
    if ! GOOSE_MODEL="$model" run_with_timeout \
          goose run --recipe "$RECIPE" --params diff="$DIFF_FILE" \
          > "$RAW_OUT" 2> "$GOOSE_ERR"; then
      if grep -qiE '404|no route|invalid url|unknown host|could not resolve|connection refused|name or service not known' \
            "$GOOSE_ERR" "$RAW_OUT" 2>/dev/null; then
        host_fail=$((host_fail + 1))
      fi
      log "tier $attempt ($model): goose failed (exit/timeout)"
      continue
    fi
    if ! extract_json "$RAW_OUT" "$REVIEW_JSON"; then
      log "tier $attempt ($model): no JSON extractable"
      continue
    fi
    if validate_gate_a "$REVIEW_JSON"; then
      jq --arg m "$model" --argjson a "$((attempt - 1))" \
         '.model_used = $m | .fallback_attempts = $a' "$REVIEW_JSON" > "$REVIEW_JSON.tmp" \
         && mv "$REVIEW_JSON.tmp" "$REVIEW_JSON"
      log "tier $attempt ($model): accepted (fallback_attempts=$((attempt - 1)))"
      ok=1; break
    fi
    log "tier $attempt ($model): schema-invalid output"
  done
  if [ "$ok" -ne 1 ]; then
    if [ "$host_fail" -ge 2 ]; then
      log "::error::all tiers failed identically — likely OPENAI_HOST/provider misconfig, not model flakiness"
    fi
    log "all tiers failed"
    return 1
  fi
  return 0
}

# --- gate B part 1: anchor pre-filter ----------------------------------------
# Drop comments that are not high-confidence or whose (path,line,side) — and
# (path,start_line,start_side) for ranges — is not a real diff anchor.
anchor_filter() {
  awk -f "$AWK_SCRIPT" "$DIFF_FILE" > "$VALID_TSV"
  jq --rawfile valid "$VALID_TSV" '
    def key(p; s; l): p + "\t" + s + "\t" + (l | tostring);
    ( $valid | split("\n") | map(select(length > 0)) ) as $rows
    | ( reduce $rows[] as $r ({}; .[$r] = true) ) as $set
    | .comments |= map(select(
        .confidence == "high"
        and ($set[key(.path; .side; .line)] == true)
        and ( (has("start_line") | not)
              or ($set[key(.path; (.start_side // .side); .start_line)] == true) )
      ))
  ' "$REVIEW_JSON" > "$FILTERED_JSON"
}

# --- gate B part 2: build the single-review payload --------------------------
build_payload() {
  jq --arg commit "${HEAD_SHA:-}" --arg marker "$MARKER" '
    {
      commit_id: $commit,
      event: "COMMENT",
      body: ($marker + "\n\n" + (.summary // "")),
      comments: ( (.comments // []) | map(
          { path, line, side, body }
          + ( if has("start_line") then { start_line } else {} end )
          + ( if has("start_side") then { start_side } else {} end )
      ) )
    }
  ' "$FILTERED_JSON" > "$PAYLOAD"
}

# --- 422-tolerant single POST ------------------------------------------------
post_review() {
  tries=0
  while : ; do
    if gh api --method POST "repos/${REPO}/pulls/${PR}/reviews" --input "$PAYLOAD" \
          > "$WORKDIR/post.out" 2> "$POST_ERR"; then
      log "review posted"
      return 0
    fi
    tries=$((tries + 1))
    if [ "$tries" -gt "$POST_RETRY_MAX" ]; then
      log "::warning::giving up after $POST_RETRY_MAX post attempts"
      return 1
    fi
    msg=$(jq -r '.message // empty' "$POST_ERR" 2>/dev/null || true)
    log "::warning::review POST failed (${msg:-unknown}); attempting recovery"
    # Best-effort targeted drop ONLY when GitHub structurally names the offender
    # in .errors[] AND that comment is actually in the payload. Otherwise fall
    # straight to summary-only — never guess an anchor out of a generic message,
    # and never burn the retry budget re-posting an unchanged payload.
    bad_path=$(jq -r '.errors[0].path // empty' "$POST_ERR" 2>/dev/null || true)
    bad_line=$(jq -r '(.errors[0].line // empty) | tostring' "$POST_ERR" 2>/dev/null || true)
    bad_side=$(jq -r '.errors[0].side // empty' "$POST_ERR" 2>/dev/null || true)
    dropped=0
    if [ -n "$bad_path" ] && [ -n "$bad_line" ] && [ "$bad_line" != "null" ]; then
      before=$(jq '.comments | length' "$PAYLOAD" 2>/dev/null || echo 0)
      jq --arg p "$bad_path" --argjson l "$bad_line" --arg s "$bad_side" \
         '.comments |= map(select((.path == $p and .line == $l and ($s == "" or .side == $s)) | not))' \
         "$PAYLOAD" > "$PAYLOAD.tmp" && mv "$PAYLOAD.tmp" "$PAYLOAD"
      after=$(jq '.comments | length' "$PAYLOAD" 2>/dev/null || echo 0)
      if [ "$before" != "$after" ]; then
        log "dropped offending comment ${bad_path}:${bad_line}${bad_side:+ ($bad_side)} and retrying"
        dropped=1
      fi
    fi
    if [ "$dropped" -ne 1 ]; then
      log "no targetable offender in payload; falling back to summary-only COMMENT"
      jq '{commit_id, event, body, comments: []}' "$PAYLOAD" > "$PAYLOAD.tmp" && mv "$PAYLOAD.tmp" "$PAYLOAD"
    fi
  done
}

# --- main --------------------------------------------------------------------
main() {
  if [ ! -f "$DIFF_FILE" ]; then log "diff file missing: $DIFF_FILE"; exit 1; fi

  bytes=$(wc -c < "$DIFF_FILE" | tr -d ' ')
  if [ "$bytes" -gt "$MAX_DIFF_BYTES" ]; then
    log "diff too large ($bytes > $MAX_DIFF_BYTES bytes); posting summary-only partial-review note"
    jq -n --arg commit "${HEAD_SHA:-}" --arg marker "$MARKER" --argjson b "$bytes" \
      '{ commit_id: $commit, event: "COMMENT",
         body: ($marker + "\n\nThis diff is large (" + ($b | tostring) +
                " bytes) and exceeded the automated-review size budget, so only this note was posted."),
         comments: [] }' > "$PAYLOAD"
    [ "$SKIP_POST" = "1" ] && { log "SKIP_POST set; payload at $PAYLOAD"; return 0; }
    post_review; return $?
  fi

  run_review || exit 1
  anchor_filter
  build_payload

  spr=$(jq -r '.should_post_review' "$REVIEW_JSON" 2>/dev/null || echo "true")
  ncomments=$(jq '.comments | length' "$PAYLOAD" 2>/dev/null || echo 0)
  if [ "$spr" = "false" ] && [ "${ncomments:-0}" -eq 0 ]; then
    log "should_post_review=false and no comments survived — skipping post (valid no-op)"
    return 0
  fi

  [ "$SKIP_POST" = "1" ] && { log "SKIP_POST set; payload at $PAYLOAD"; return 0; }
  post_review
}

main "$@"
