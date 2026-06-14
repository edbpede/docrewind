#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# review.sh — deterministic "hands" of the two-lane Goose + NanoGPT PR reviewer.
#
# Two review lanes (code-review + architect) each read the diff in their own
# clean, tool-less `goose run` context, in parallel, and emit a distinct
# structured artifact. A third tool-less LLM synthesizer then authors the
# narrative summary and curates a cross-lane-merged inline comment set. This
# script keeps every safety-critical signal deterministic: it alone computes the
# verdict, emits the BLOCK banner + architecture watchlist, re-validates every
# model-proposed anchor against the real diff, and hard-codes the posted GitHub
# event to COMMENT. The models are never given tools, so this shell is the only
# thing that touches GitHub.
#
# Pipeline:
#   precompute : indented diff (YAML-injection-safe) + valid_lines.tsv (anchors)
#   stage 1    : code-review lane  ┐ parallel, tiered goose fallback (gate A)
#                architect lane    ┘ -> two filtered/partitioned artifacts
#   verdict    : scripts/synthesize.jq computes the authoritative recommendation
#   stage 2    : LLM synthesizer (sequential) -> narrative + curated comments,
#                whose anchors are re-validated (gate B, anchor-only mode);
#                on synthesizer failure, deterministic synthesize.jq fallback
#   transcript : (best-effort) full per-lane findings + verdict trace uploaded to
#                a client-side-encrypted PrivateBin paste; linked from a collapsed
#                <details> block. Disabled/failed upload degrades to a local recap.
#   assemble   : deterministic body (verdict/banner/watchlist/caveats/recap) + payload
#                -> 422-tolerant single COMMENT POST
#
# Every stage is env-overridable so it can be exercised with stub `goose`/`gh`
# binaries on PATH and a pure jq unit test for the deterministic core
# (scripts/synthesize.jq). Live posting needs REPO / PR / HEAD_SHA / GH_TOKEN
# and a real NANOGPT_API_KEY (CI only).

set -euo pipefail

# --- configuration (env-overridable) ----------------------------------------
CODE_RECIPE="${CODE_RECIPE:-.goose/recipe.code-review.yaml}"
ARCH_RECIPE="${ARCH_RECIPE:-.goose/recipe.architect.yaml}"
SYNTH_RECIPE="${SYNTH_RECIPE:-.goose/recipe.synthesize.yaml}"
SYNTH_JQ="${SYNTH_JQ:-scripts/synthesize.jq}"
DIFF_FILE="${DIFF_FILE:-diff.patch}"
WORKDIR="${WORKDIR:-.}"
AWK_SCRIPT="${AWK_SCRIPT:-scripts/hunk-lines.awk}"
MARKER="${MARKER:-<!-- goose-pr-reviewer -->}"
MAX_DIFF_BYTES="${MAX_DIFF_BYTES:-400000}"
GOOSE_TIMEOUT="${GOOSE_TIMEOUT:-600}"   # per-stage wall-clock cap; :thinking models on a large diff can exceed 300s (a tier rc=124 timeout falls through to the next tier)
# Turn budget for the goose agent loop, passed via the --max-turns FLAG below.
# This must be enforced on the CLI (or via the GOOSE_MAX_TURNS env): goose 1.37.0
# IGNORES a recipe-level `settings.max_turns` for `goose run` (verified — it ran
# to the default ~1000). It must exceed 1 because goose delivers the recipes'
# `response.json_schema` through an agentic "final output" tool the model must
# CALL, and a :thinking model spends a turn reasoning before that call — a budget
# of 1 stalls with "I've reached the maximum number of actions". Tool-less
# recipes (extensions: []) keep these turns harmless: they can only emit JSON.
GOOSE_MAX_TURNS="${GOOSE_MAX_TURNS:-5}"
POST_RETRY_MAX="${POST_RETRY_MAX:-5}"
SKIP_POST="${SKIP_POST:-0}"   # tests set 1 to stop after building payload.json

# --- transcript paste (best-effort, off by default in tests) -----------------
# After assembling the review, the full per-lane findings + verdict derivation
# are uploaded to a client-side-encrypted PrivateBin paste (gearnode/privatebin
# CLI) and linked from a collapsed <details> block in the posted review, so a
# reader can inspect "what the lanes discussed" without bloating the comment.
# This is strictly best-effort: if disabled, if the CLI is absent, if the config
# is missing, or if the upload fails for any reason, the review still posts —
# just without the link. Only already-public review output is uploaded (model
# findings about a public PR diff), never secrets or the diff itself. The offline
# test suite sets TRANSCRIPT_ENABLED=0 so it never touches the network; the
# dedicated transcript test flips it on with a stub `privatebin` on PATH.
TRANSCRIPT_ENABLED="${TRANSCRIPT_ENABLED:-1}"
PRIVATEBIN_BIN="${PRIVATEBIN_BIN:-privatebin}"
PRIVATEBIN_CONFIG="${PRIVATEBIN_CONFIG:-.github/privatebin.json}"
PRIVATEBIN_BIN_NAME="${PRIVATEBIN_BIN_NAME:-}"   # configured bin to target (--bin); empty = default
PRIVATEBIN_EXPIRE="${PRIVATEBIN_EXPIRE:-1year}"
PRIVATEBIN_TIMEOUT="${PRIVATEBIN_TIMEOUT:-30}"   # upload wall-clock cap (seconds)

# Priority-ordered model tiers (space-separated); *_MODELS override for tests.
DEFAULT_CODE_MODELS="deepseek/deepseek-v4-pro-cheaper:thinking xiaomi/mimo-v2.5-pro:thinking minimax/minimax-m3:thinking"
DEFAULT_ARCH_MODELS="deepseek/deepseek-v4-pro-cheaper:thinking minimax/minimax-m3:thinking"
DEFAULT_SYNTH_MODELS="deepseek/deepseek-v4-pro-cheaper:thinking minimax/minimax-m3:thinking"
CODE_REVIEW_MODELS="${CODE_REVIEW_MODELS:-$DEFAULT_CODE_MODELS}"
ARCHITECT_MODELS="${ARCHITECT_MODELS:-$DEFAULT_ARCH_MODELS}"
SYNTH_MODELS="${SYNTH_MODELS:-$DEFAULT_SYNTH_MODELS}"

mkdir -p "$WORKDIR"

# --- shared, NON-stage-namespaced work files ---------------------------------
# These are pure functions of the diff, computed serially BEFORE fan-out, then
# read read-only by both lanes and the synthesizer re-validation. valid_lines
# is deliberately shared (never stage-prefixed): it is the single anchor source.
INDENTED_DIFF="$WORKDIR/diff.indented.patch"
VALID_TSV="$WORKDIR/valid_lines.tsv"
EMPTY_JSON="$WORKDIR/empty.json"
# Per-stage artifacts (the raw.out / goose.err / cleaned.out per-attempt files
# live inside run_stage as "$WORKDIR/<stage>.*" so concurrent lanes never race).
CODE_JSON="$WORKDIR/code-review.review.json"
ARCH_JSON="$WORKDIR/architect.review.json"
SYNTH_JSON="$WORKDIR/synth.review.json"
CODE_FILTERED="$WORKDIR/code-review.filtered.json"
ARCH_FILTERED="$WORKDIR/architect.filtered.json"     # partitioned (inline + watchlist)
SYNTH_FILTERED="$WORKDIR/synth.filtered.json"         # anchor-re-validated
FINDINGS_JSON="$WORKDIR/synth.findings.json"
FINDINGS_INDENTED="$WORKDIR/synth.findings.indented.json"
SYNTH_FALLBACK_JSON="$WORKDIR/synth.fallback.json"
BODY_FILE="$WORKDIR/body.md"
PAYLOAD="$WORKDIR/payload.json"
POST_ERR="$WORKDIR/post.err"
TRANSCRIPT_FILE="$WORKDIR/transcript.md"
PB_ERR="$WORKDIR/privatebin.err"

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
# wrong post. `cleaned` is stage-namespaced by the caller so parallel lanes do
# not race on a shared scratch file.
extract_json() {
  raw="$1"; out="$2"; cleaned="$3"
  sed "s/${ESC}\[[0-9;]*[a-zA-Z]//g" "$raw" > "$cleaned" 2>/dev/null || cp "$raw" "$cleaned"
  if jq -ce . "$cleaned" > "$out" 2>/dev/null && [ -s "$out" ]; then
    return 0
  fi
  if jq -Rsc '[scan("\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}")] | last // empty' "$cleaned" 2>/dev/null \
       | jq -ce 'fromjson' > "$out" 2>/dev/null && [ -s "$out" ]; then
    return 0
  fi
  return 1
}

# --- gate A: stage-aware schema sanity ---------------------------------------
# The COMMENT-only guarantee is no longer asserted here (the recipes dropped
# review_event/should_post_review); it now lives solely in build_payload's
# hard-coded event literal.
validate_gate_a() {
  case "$1" in
    code-review)
      jq -e '(.recommendation | type == "string")
        and (.summary | type == "string")
        and (.comments | type == "array")' "$2" >/dev/null 2>&1 ;;
    architect)
      jq -e '(.architectural_status | type == "string")
        and (.summary | type == "string")
        and (.concerns | type == "array")' "$2" >/dev/null 2>&1 ;;
    synth)
      jq -e '(.summary | type == "string")
        and (.comments | type == "array")' "$2" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# --- generalized tiered fallback loop (one clean goose context per attempt) ---
# run_stage <stage> <recipe> <models_var_name> <param_key> <param_file> <out_json>
# Returns 0 on the first tier that yields schema-valid JSON, 1 if all fail. Safe
# to run as a background job: every per-attempt file is "$WORKDIR/<stage>.*".
run_stage() {
  stage="$1"; recipe="$2"; models_var="$3"; param_key="$4"; param_file="$5"; out_json="$6"
  models="${!models_var}"
  raw="$WORKDIR/$stage.raw.out"
  gerr="$WORKDIR/$stage.goose.err"
  cleaned="$WORKDIR/$stage.cleaned.out"
  attempt=0; ok=0; host_fail=0; auth_fail=0
  for model in $models; do
    attempt=$((attempt + 1))
    : > "$gerr"; : > "$raw"; rc=0
    # A recipe run ignores GOOSE_MODEL/GOOSE_PROVIDER env, so the tier model is
    # passed via the explicit --model/--provider flags. --quiet keeps stdout to
    # the model response; --no-session avoids writing session state in CI.
    # --max-turns bounds the structured-output agent loop (recipe settings are
    # ignored by `goose run`; this flag / GOOSE_MAX_TURNS is the only lever).
    run_with_timeout \
      goose run --recipe "$recipe" --params "$param_key=$param_file" \
      --provider "${GOOSE_PROVIDER:-openai}" --model "$model" \
      --max-turns "$GOOSE_MAX_TURNS" \
      --quiet --no-session \
      > "$raw" 2> "$gerr" || rc=$?
    # goose can exit 0 even on provider/auth errors (the error text lands on
    # stdout), so a tier "succeeds" only if it yields schema-valid JSON — never
    # by exit code alone.
    if extract_json "$raw" "$out_json" "$cleaned" && validate_gate_a "$stage" "$out_json"; then
      jq --arg m "$model" --argjson a "$((attempt - 1))" \
         '.model_used = $m | .fallback_attempts = $a' "$out_json" > "$out_json.tmp" \
         && mv "$out_json.tmp" "$out_json"
      log "stage=$stage tier=$attempt ($model): accepted (fallback_attempts=$((attempt - 1)))"
      ok=1; break
    fi
    # Diagnose this tier from BOTH streams (rc is unreliable; errors may be on
    # stdout). host/auth signatures repeated across tiers indicate a config bug
    # rather than model flakiness.
    if grep -qiE '404|no route|invalid url|unknown host|could not resolve|connection refused|name or service not known' \
          "$gerr" "$raw" 2>/dev/null; then host_fail=$((host_fail + 1)); fi
    if grep -qiE '401|403|unauthorized|forbidden|authentication failed|invalid session|invalid api key' \
          "$gerr" "$raw" 2>/dev/null; then auth_fail=$((auth_fail + 1)); fi
    log "stage=$stage tier=$attempt ($model): failed (rc=$rc): $({ tail -c 300 "$raw"; cat "$gerr"; } 2>/dev/null | tr '\n' ' ' | cut -c1-280)"
  done
  if [ "$ok" -ne 1 ]; then
    if [ "$auth_fail" -ge 2 ]; then
      log "::error::stage=$stage all tiers failed authentication — likely a missing/invalid NANOGPT_API_KEY secret"
    elif [ "$host_fail" -ge 2 ]; then
      log "::error::stage=$stage all tiers failed identically — likely OPENAI_HOST/provider misconfig, not model flakiness"
    fi
    log "stage=$stage: all tiers failed"
    return 1
  fi
  return 0
}

# --- gate B: anchor filter (parameterized by array key + mode) ---------------
# anchor_filter <in_json> <array_key> <out_json> [mode]
#   mode=full   (default): keep only confidence=="high" findings on a valid anchor
#   mode=anchor          : keep findings on a valid anchor REGARDLESS of confidence
# The anchor-only mode re-validates synthesizer comments, which are
# {path,line,side,body} with NO confidence field — the full predicate's
# confidence=="high" clause would otherwise drop every curated comment.
anchor_filter() {
  in_json="$1"; akey="$2"; out_json="$3"; mode="${4:-full}"
  jq --rawfile valid "$VALID_TSV" --arg akey "$akey" --arg mode "$mode" '
    def key(p; s; l): p + "\t" + s + "\t" + (l | tostring);
    ( $valid | split("\n") | map(select(length > 0)) ) as $rows
    | ( reduce $rows[] as $r ({}; .[$r] = true) ) as $set
    | .[$akey] |= map(select(
        ( ($mode == "anchor") or (.confidence == "high") )
        and ($set[key(.path; .side; .line)] == true)
        and ( (has("start_line") | not)
              or ($set[key(.path; (.start_side // .side); .start_line)] == true) )
      ))
  ' "$in_json" > "$out_json"
}

# --- architect partition: inline candidates vs non-anchorable watchlist ------
# Anchored, high-confidence concerns become candidate inline comments; every
# other WATCH/BLOCK concern (low confidence OR unanchorable OR off-diff anchor)
# is preserved as a deterministic watchlist item — a blocker is never dropped.
partition_architect() {
  in_json="$1"; out_json="$2"
  jq --rawfile valid "$VALID_TSV" '
    def key(p; s; l): p + "\t" + s + "\t" + (l | tostring);
    ( $valid | split("\n") | map(select(length > 0)) ) as $rows
    | ( reduce $rows[] as $r ({}; .[$r] = true) ) as $set
    | def passes:
        (.confidence == "high")
        and (has("path") and has("line") and has("side"))
        and ($set[key(.path; .side; .line)] == true)
        and ( (has("start_line") | not)
              or ($set[key(.path; (.start_side // .side); .start_line)] == true) );
      ( .concerns // [] ) as $all
    | { architectural_status,
        summary,
        inline_concerns:    [ $all[] | select(passes) ],
        watchlist_concerns: [ $all[] | select(passes | not)
                              | select(.status == "WATCH" or .status == "BLOCK") ],
        model_used: (.model_used // ""),
        fallback_attempts: (.fallback_attempts // 0) }
  ' "$in_json" > "$out_json"
}

# --- synthesize.jq driver (verdict / watchlist / fallback) -------------------
# Reads the two filtered lane artifacts (or {} when a lane is unavailable) and
# the availability flags. verdict/watchlist print raw strings; fallback prints a
# {summary, comments[]} object.
synth_jq() {
  mode="$1"; raw_flag="$2"   # raw_flag: "r" for -nr (verdict/watchlist), "" for -n (fallback)
  jq -n${raw_flag:+r} --arg mode "$mode" \
    --arg code_avail "$CODE_AVAIL" --arg arch_avail "$ARCH_AVAIL" \
    --slurpfile code "$CODE_FOR_JQ" --slurpfile arch "$ARCH_FOR_JQ" \
    -f "$SYNTH_JQ"
}

# --- build the synthesizer input (all lanes' filtered findings + verdict) -----
build_findings() {
  jq -n --arg final "$FINAL_REC" \
        --arg cav "$CODE_AVAIL" --arg aav "$ARCH_AVAIL" \
        --slurpfile code "$CODE_FOR_JQ" --slurpfile arch "$ARCH_FOR_JQ" '
    ($code[0] // {}) as $c | ($arch[0] // {}) as $a
    | { final_recommendation: $final,
        code_available: ($cav == "1"),
        architect_available: ($aav == "1"),
        code_recommendation: ($c.recommendation // null),
        architectural_status: ($a.architectural_status // null),
        code_summary: ($c.summary // null),
        architect_summary: ($a.summary // null),
        code_comments: ($c.comments // []),
        architect_inline: ($a.inline_concerns // []),
        architect_watchlist: ($a.watchlist_concerns // []) }
  ' > "$FINDINGS_JSON"
  # Indent for YAML-block-scalar safety, exactly like the diff (defends the
  # synthesizer prompt against a multi-line param breaking the recipe YAML).
  sed 's/^/  /' "$FINDINGS_JSON" > "$FINDINGS_INDENTED" 2>/dev/null || cp "$FINDINGS_JSON" "$FINDINGS_INDENTED"
}

# --- per-lane recap (compact, always available from the artifacts) -----------
# A small glanceable markdown table of each lane's verdict, model, and finding
# count. Unlike the transcript paste this is built purely from local artifacts,
# so it renders even when the paste upload is disabled or fails — the reader
# still sees what each lane concluded without leaving GitHub. Sets RECAP_MD.
build_recap() {
  code_row="| Code review | _unavailable_ | — | — |"
  if [ "$CODE_AVAIL" -eq 1 ]; then
    code_row=$(jq -r '
      "| Code review | " + (.recommendation // "?")
      + " | `" + (.model_used // "?") + "` (tier " + (((.fallback_attempts // 0) + 1) | tostring) + ")"
      + " | " + ((.comments | length) | tostring) + " |"' "$CODE_JSON" 2>/dev/null \
      || echo "| Code review | ? | — | — |")
  fi
  arch_row="| Architect | _unavailable_ | — | — |"
  if [ "$ARCH_AVAIL" -eq 1 ]; then
    arch_row=$(jq -r '
      "| Architect | " + (.architectural_status // "?")
      + " | `" + (.model_used // "?") + "` (tier " + (((.fallback_attempts // 0) + 1) | tostring) + ")"
      + " | " + ((.concerns | length) | tostring) + " |"' "$ARCH_JSON" 2>/dev/null \
      || echo "| Architect | ? | — | — |")
  fi
  if [ "$1" -eq 1 ]; then   # synth_ok
    synth_row=$(jq -r '
      "| Synthesizer | curated | `" + (.model_used // "?")
      + "` (tier " + (((.fallback_attempts // 0) + 1) | tostring) + ")"
      + " | " + ((.comments | length) | tostring) + " |"' "$SYNTH_JSON" 2>/dev/null \
      || echo "| Synthesizer | curated | — | — |")
  else
    synth_row="| Synthesizer | _deterministic fallback_ | — | — |"
  fi
  RECAP_MD=$(printf '%s\n%s\n%s\n%s\n%s\n%s' \
    "| Lane | Verdict | Model (tier) | Findings |" \
    "| --- | --- | --- | --- |" \
    "$code_row" "$arch_row" "$synth_row")
}

# --- full transcript (uploaded to a paste; the "agents discussing" view) ------
# Renders every lane's raw structured findings + the deterministic verdict
# derivation as readable markdown. Written to TRANSCRIPT_FILE; never posted
# inline (it can be large) — only uploaded and linked. $1 = synth_ok.
render_lane_code() {   # raw code-review json -> markdown
  jq -r '
    "### Lane 1 — Code review\n"
    + "\n- **Model:** `" + (.model_used // "?") + "` (fallback tier " + (((.fallback_attempts // 0) + 1) | tostring) + ")"
    + "\n- **Lane recommendation:** " + (.recommendation // "?")
    + "\n\n**Summary:** " + (.summary // "_(none)_")
    + "\n\n**Findings (" + ((.comments | length) | tostring) + "):**\n"
    + ( if (.comments | length) == 0 then "\n_No inline findings._\n"
        else ( .comments | map(
            "\n- **[" + (.severity // "?") + " / " + (.category // "?") + " / conf " + (.confidence // "?") + "]** `"
            + (.path // "?") + ":" + ((.line // 0) | tostring) + " (" + (.side // "?") + ")`\n\n  "
            + ((.body // "") | gsub("\n"; "\n  "))
          ) | join("\n") ) + "\n" end )
  ' "$1" 2>/dev/null || printf '### Lane 1 — Code review\n\n_(artifact unreadable)_\n'
}
render_lane_arch() {   # raw architect json -> markdown
  jq -r '
    "### Lane 2 — Architect (devil'"'"'s advocate)\n"
    + "\n- **Model:** `" + (.model_used // "?") + "` (fallback tier " + (((.fallback_attempts // 0) + 1) | tostring) + ")"
    + "\n- **Architectural status:** " + (.architectural_status // "?")
    + "\n\n**Summary:** " + (.summary // "_(none)_")
    + "\n\n**Concerns (" + ((.concerns | length) | tostring) + "):**\n"
    + ( if (.concerns | length) == 0 then "\n_No architectural concerns._\n"
        else ( .concerns | map(
            "\n- **[" + (.status // "?") + " / conf " + (.confidence // "?") + "]**"
            + (if has("path") and has("line") then " `" + (.path // "?") + ":" + ((.line // 0) | tostring) + " (" + (.side // "RIGHT") + ")`" else " _(non-anchorable)_" end)
            + "\n\n  " + ((.body // "") | gsub("\n"; "\n  "))
          ) | join("\n") ) + "\n" end )
  ' "$1" 2>/dev/null || printf '### Lane 2 — Architect\n\n_(artifact unreadable)_\n'
}
build_transcript() {
  synth_ok="$1"
  : > "$TRANSCRIPT_FILE"
  {
    printf '# AI PR Review — full reviewer transcript\n\n'
    printf 'PR head: `%s`\n\n' "${HEAD_SHA:-unknown}"
    printf '**Final recommendation: %s**\n\n' "$FINAL_REC"
    printf 'Each lane below ran in its own isolated, tool-less `goose run` context. '
    printf 'The two review lanes ran in parallel; the synthesizer ran last over their '
    printf 'extracted findings (never the diff). The verdict and this transcript are '
    printf 'assembled deterministically by `scripts/review.sh` — the models only propose.\n\n'
    printf -- '---\n\n## Verdict derivation\n\n'
    printf -- '- Code-review lane recommendation: `%s`\n' "$([ "$CODE_AVAIL" -eq 1 ] && jq -r '.recommendation // "?"' "$CODE_JSON" 2>/dev/null || echo 'unavailable')"
    printf -- '- Architect lane status: `%s`\n' "$([ "$ARCH_AVAIL" -eq 1 ] && jq -r '.architectural_status // "?"' "$ARCH_JSON" 2>/dev/null || echo 'unavailable')"
    printf -- '- Deterministic gating rule (`scripts/synthesize.jq`) → **%s**\n' "$FINAL_REC"
    [ "$ARCH_STATUS" = "BLOCK" ] && printf -- '- ⚠️ Architect BLOCK forced REQUEST_CHANGES.\n'
    [ -n "$CAVEAT" ] && printf -- '- %s\n' "$CAVEAT"
    printf '\n---\n\n'
    if [ "$CODE_AVAIL" -eq 1 ]; then
      render_lane_code "$CODE_JSON"
      printf '\n<sub>raw artifact</sub>\n\n```json\n'; jq -S . "$CODE_JSON" 2>/dev/null; printf '\n```\n'
    else
      printf '### Lane 1 — Code review\n\n_Lane unavailable across all fallback tiers — partial review._\n'
    fi
    printf '\n---\n\n'
    if [ "$ARCH_AVAIL" -eq 1 ]; then
      render_lane_arch "$ARCH_JSON"
      printf '\n<sub>raw artifact</sub>\n\n```json\n'; jq -S . "$ARCH_JSON" 2>/dev/null; printf '\n```\n'
    else
      printf '### Lane 2 — Architect\n\n_Lane unavailable across all fallback tiers — partial review._\n'
    fi
    printf '\n---\n\n### Lane 3 — Synthesizer\n\n'
    if [ "$synth_ok" -eq 1 ]; then
      proposed=$(jq '.comments | length' "$SYNTH_JSON" 2>/dev/null || echo '?')
      survived=$(jq '.comments | length' "$SYNTH_FILTERED" 2>/dev/null || echo '?')
      printf -- '- **Model:** `%s`\n' "$(jq -r '.model_used // "?"' "$SYNTH_JSON" 2>/dev/null)"
      printf -- '- **Curated comments:** %s proposed, %s survived anchor re-validation.\n\n' "$proposed" "$survived"
      printf '**Narrative:**\n\n%s\n' "$(jq -r '.summary // "_(none)_"' "$SYNTH_JSON" 2>/dev/null)"
      printf '\n<sub>raw artifact (pre re-validation)</sub>\n\n```json\n'; jq -S . "$SYNTH_JSON" 2>/dev/null; printf '\n```\n'
    else
      printf 'The LLM synthesizer failed all fallback tiers; the summary and merged '
      printf 'comments below were produced deterministically by `scripts/synthesize.jq`.\n\n'
      printf '```json\n'; jq -S . "$SYNTH_FALLBACK_JSON" 2>/dev/null; printf '\n```\n'
    fi
  } >> "$TRANSCRIPT_FILE"
}

# --- best-effort paste upload ------------------------------------------------
# Echoes the paste URL on success, nothing on any failure. Never returns
# non-zero (so a `$(upload_transcript)` capture under set -e cannot abort the
# run). Gated: disabled flag, missing CLI, or missing config all skip silently.
upload_transcript() {
  [ "$TRANSCRIPT_ENABLED" = "1" ] || { log "transcript: disabled (TRANSCRIPT_ENABLED=$TRANSCRIPT_ENABLED)"; return 0; }
  command -v "$PRIVATEBIN_BIN" >/dev/null 2>&1 || { log "transcript: '$PRIVATEBIN_BIN' not on PATH — skipping paste"; return 0; }
  [ -f "$PRIVATEBIN_CONFIG" ] || { log "transcript: config $PRIVATEBIN_CONFIG missing — skipping paste"; return 0; }
  [ -s "$TRANSCRIPT_FILE" ]   || { log "transcript: empty transcript — skipping paste"; return 0; }
  set +e
  if [ -n "$TIMEOUT_BIN" ]; then
    url=$("$TIMEOUT_BIN" "$PRIVATEBIN_TIMEOUT" "$PRIVATEBIN_BIN" --config "$PRIVATEBIN_CONFIG" \
          ${PRIVATEBIN_BIN_NAME:+--bin "$PRIVATEBIN_BIN_NAME"} \
          create --expire "$PRIVATEBIN_EXPIRE" --formatter markdown < "$TRANSCRIPT_FILE" 2> "$PB_ERR")
  else
    url=$("$PRIVATEBIN_BIN" --config "$PRIVATEBIN_CONFIG" \
          ${PRIVATEBIN_BIN_NAME:+--bin "$PRIVATEBIN_BIN_NAME"} \
          create --expire "$PRIVATEBIN_EXPIRE" --formatter markdown < "$TRANSCRIPT_FILE" 2> "$PB_ERR")
  fi
  rc=$?
  set -e
  # Keep only a real http(s) URL — defends against a CLI that prints diagnostics
  # to stdout on partial failure. The `|| true` is load-bearing: with `pipefail`
  # a no-match grep returns 1, which under `set -e` would abort the whole review
  # on an upload failure instead of degrading to the recap.
  url=$(printf '%s' "$url" | tr -d '\r' | grep -oE 'https?://[^[:space:]]+' | head -1 || true)
  if [ "$rc" -eq 0 ] && [ -n "$url" ]; then
    printf '%s' "$url"; return 0
  fi
  log "transcript: paste upload failed (rc=$rc): $(tail -c 200 "$PB_ERR" 2>/dev/null | tr '\n' ' ')"
  return 0
}

# --- deterministic body assembly (script around model prose) -----------------
# The verdict line, BLOCK banner, advisory disclaimer, watchlist, and partial
# caveats are emitted here REGARDLESS of the synthesizer, with exactly one
# MARKER. A blank summary degrades to a neutral non-empty note.
build_body() {
  body_summary="$1"
  : > "$BODY_FILE"
  printf '%s\n\n' "$MARKER" >> "$BODY_FILE"
  printf '**Final recommendation:** %s\n\n' "$FINAL_REC" >> "$BODY_FILE"
  if [ "$ARCH_STATUS" = "BLOCK" ]; then
    printf '> ⚠️ **ARCHITECT BLOCK** — the architecture lane flagged a blocking design concern.\n\n' >> "$BODY_FILE"
  fi
  # Strip any MARKER the model prose may embed, so the body keeps EXACTLY ONE
  # marker (the literal at the top). The marker is not yet used as an edit anchor,
  # but this keeps the one-marker invariant robust against adversarial summaries.
  clean_summary="${body_summary//"$MARKER"/}"
  s=$(printf '%s' "$clean_summary" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  if [ -z "$s" ]; then s="No concerns found in the changed lines."; fi
  printf '%s\n\n' "$s" >> "$BODY_FILE"
  printf '_The recommendation above is authoritative; this narrative is advisory._\n' >> "$BODY_FILE"
  if [ -n "$WATCHLIST_MD" ]; then
    printf '\n%s\n' "$WATCHLIST_MD" >> "$BODY_FILE"
  fi
  if [ -n "$CAVEAT" ]; then
    printf '\n%s\n' "$CAVEAT" >> "$BODY_FILE"
  fi
  # Collapsed reviewer internals: the compact per-lane recap is always shown
  # (built from local artifacts); the full transcript link appears only when the
  # paste upload succeeded. No MARKER is emitted here — the one-marker invariant
  # is preserved.
  if [ -n "${RECAP_MD:-}" ]; then
    {
      printf '\n<details>\n<summary>🔍 Reviewer internals — per-lane findings & verdict trace</summary>\n\n'
      printf '%s\n\n' "$RECAP_MD"
      if [ -n "${TRANSCRIPT_URL:-}" ]; then
        exp_h=$(printf '%s' "$PRIVATEBIN_EXPIRE" | sed -E 's/([0-9])([a-z])/\1 \2/')
        printf 'Full transcript of what each lane found and how the verdict was derived (expires in %s):\n\n' "$exp_h"
        printf '**[View full reviewer transcript →](%s)**\n\n' "$TRANSCRIPT_URL"
        printf '_Hosted on a client-side-encrypted PrivateBin paste; the decryption key lives only in the link fragment._\n'
      else
        printf '_Full transcript paste unavailable for this run; the recap above is built from the lane artifacts._\n'
      fi
      printf '</details>\n'
    } >> "$BODY_FILE"
  fi
}

# --- build the single-review payload (the SOLE owner of the COMMENT event) ----
# Receives the pre-assembled body file and the curated/re-validated comments
# (same {summary,comments} intermediate from both the synth and fallback paths).
build_payload() {
  comments_json="$1"
  jq -n --arg commit "${HEAD_SHA:-}" --rawfile body "$BODY_FILE" \
        --argjson comments "$comments_json" '
    {
      commit_id: $commit,
      event: "COMMENT",
      body: ($body | sub("[[:space:]]+$"; "")),
      comments: ( ($comments // []) | map(
          { path, line, side, body }
          + ( if has("start_line") then { start_line } else {} end )
          + ( if has("start_side") then { start_side } else {} end )
      ) )
    }
  ' > "$PAYLOAD"
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

  # --- serial precompute (pure functions of the diff; shared read-only) -------
  # Indent every diff line by 2 spaces so a substituted multi-line diff cannot
  # break out of the recipe's YAML block scalar (this is also the YAML-injection
  # defense for untrusted diff content). awk reads the ORIGINAL diff for anchors,
  # so line numbers are unaffected.
  sed 's/^/  /' "$DIFF_FILE" > "$INDENTED_DIFF" 2>/dev/null || cp "$DIFF_FILE" "$INDENTED_DIFF"
  awk -f "$AWK_SCRIPT" "$DIFF_FILE" > "$VALID_TSV"
  echo '{}' > "$EMPTY_JSON"

  # --- stage 1: two review lanes in parallel, set -e-safe ---------------------
  run_stage code-review "$CODE_RECIPE" CODE_REVIEW_MODELS diff "$INDENTED_DIFF" "$CODE_JSON" & pid_c=$!
  run_stage architect   "$ARCH_RECIPE" ARCHITECT_MODELS   diff "$INDENTED_DIFF" "$ARCH_JSON" & pid_a=$!
  set +e; wait "$pid_c"; rc_c=$?; wait "$pid_a"; rc_a=$?; set -e

  CODE_AVAIL=0; ARCH_AVAIL=0
  [ "$rc_c" -eq 0 ] && CODE_AVAIL=1
  [ "$rc_a" -eq 0 ] && ARCH_AVAIL=1
  if [ "$CODE_AVAIL" -eq 0 ] && [ "$ARCH_AVAIL" -eq 0 ]; then
    log "::error::both review lanes failed across all tiers — nothing to post"
    exit 1
  fi

  # --- filter / partition each available lane ---------------------------------
  if [ "$CODE_AVAIL" -eq 1 ]; then
    anchor_filter "$CODE_JSON" comments "$CODE_FILTERED" full
    CODE_FOR_JQ="$CODE_FILTERED"
  else
    CODE_FOR_JQ="$EMPTY_JSON"
    log "stage=code-review unavailable — partial review"
  fi
  if [ "$ARCH_AVAIL" -eq 1 ]; then
    partition_architect "$ARCH_JSON" "$ARCH_FILTERED"
    ARCH_FOR_JQ="$ARCH_FILTERED"
  else
    ARCH_FOR_JQ="$EMPTY_JSON"
    log "stage=architect unavailable — partial review"
  fi

  # --- deterministic verdict + watchlist (authoritative; pre-synthesizer) -----
  FINAL_REC=$(synth_jq verdict r)
  WATCHLIST_MD=$(synth_jq watchlist r)
  ARCH_STATUS=$(jq -r '.architectural_status // ""' "$ARCH_FOR_JQ" 2>/dev/null || echo "")
  # At most one lane can be unavailable here (both-unavailable exited above).
  CAVEAT=""
  [ "$CODE_AVAIL" -ne 1 ] && CAVEAT="⚠️ code-review lane unavailable — partial review."
  [ "$ARCH_AVAIL" -ne 1 ] && CAVEAT="⚠️ architect lane unavailable — partial review."

  # --- stage 2: LLM synthesizer (sequential, after both lanes) ----------------
  build_findings
  synth_ok=0
  if run_stage synth "$SYNTH_RECIPE" SYNTH_MODELS findings "$FINDINGS_INDENTED" "$SYNTH_JSON"; then
    # Re-validate every synthesizer-proposed anchor (gate B, anchor-only mode):
    # any comment whose (path,line,side) is not a real diff line is dropped.
    anchor_filter "$SYNTH_JSON" comments "$SYNTH_FILTERED" anchor
    synth_ok=1
  fi

  if [ "$synth_ok" -eq 1 ]; then
    body_summary=$(jq -r '.summary // ""' "$SYNTH_FILTERED")
    comments_json=$(jq -c '.comments // []' "$SYNTH_FILTERED")
    log "stage=synth: LLM synthesis used (curated comments=$(jq '.comments | length' "$SYNTH_FILTERED"))"
  else
    # Deterministic fallback: templated summary + exact-anchor dedup/merge.
    synth_jq fallback "" > "$SYNTH_FALLBACK_JSON"
    body_summary=$(jq -r '.summary // ""' "$SYNTH_FALLBACK_JSON")
    comments_json=$(jq -c '.comments // []' "$SYNTH_FALLBACK_JSON")
    log "stage=synth: synthesizer unavailable — deterministic fallback (merged comments=$(jq '.comments | length' "$SYNTH_FALLBACK_JSON"))"
  fi

  # --- reviewer-internals transcript (always-on recap + best-effort paste) ----
  # The recap is built unconditionally from the artifacts; the full transcript is
  # only assembled and uploaded when enabled. A failed/disabled upload leaves
  # TRANSCRIPT_URL empty and the body degrades to the recap alone.
  build_recap "$synth_ok"
  TRANSCRIPT_URL=""
  if [ "$TRANSCRIPT_ENABLED" = "1" ]; then
    build_transcript "$synth_ok"
    TRANSCRIPT_URL=$(upload_transcript)
    [ -n "$TRANSCRIPT_URL" ] && log "transcript: paste posted ($TRANSCRIPT_URL)"
  else
    log "transcript: disabled (TRANSCRIPT_ENABLED=$TRANSCRIPT_ENABLED) — recap only"
  fi

  # --- assemble body + single payload (one build_payload for both paths) ------
  build_body "$body_summary"
  build_payload "$comments_json"

  ncomments=$(jq '.comments | length' "$PAYLOAD" 2>/dev/null || echo 0)
  log "posting review (recommendation=$FINAL_REC inline comments=${ncomments:-0} path=$([ "$synth_ok" -eq 1 ] && echo synth || echo fallback))"

  [ "$SKIP_POST" = "1" ] && { log "SKIP_POST set; payload at $PAYLOAD"; return 0; }
  post_review
}

main "$@"
