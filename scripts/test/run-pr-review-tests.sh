#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# run-pr-review-tests.sh — deterministic, offline tests for the two-lane PR
# reviewer. No live NanoGPT API, no live PR: stub `goose`/`gh` on PATH plus a
# pure jq unit test of the deterministic core (scripts/synthesize.jq).
#
# Coverage maps to the plan's acceptance criteria:
#   AC1/AC2  three distinct goose runs; both lanes before the synthesizer
#   AC3/AC10 synthesizer anchors re-validated (anchor-only mode keeps the
#            confidence-less curated comment, drops the hallucinated one)
#   AC4/AC9  synthesize.jq gating truth table (9 cells + 3 degrade rules),
#            exact-anchor dedup/merge, watchlist rendering, banner
#   AC5/AC7  partial-lane survivor + caveat; both-fail exit 1; stage namespacing
#   AC8      same-anchor finding from both lanes merges with both tags (fallback)
#   AC11     deterministic safety overlay survives a contradictory synth prose
#   AC12     synthesizer failure -> deterministic fallback posts, logs note
#   AC6      scripts/check-pr-review-workflow.sh exits 0
#
# Usage: bash scripts/test/run-pr-review-tests.sh   (exits non-zero on any FAIL)

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$ROOT"

FIX="$SCRIPT_DIR/fixtures"
STUBS="$SCRIPT_DIR/stubs"
REVIEW="$ROOT/scripts/review.sh"
AWK="$ROOT/scripts/hunk-lines.awk"
SYNJQ="$ROOT/scripts/synthesize.jq"
GUARD="$ROOT/scripts/check-pr-review-workflow.sh"
PATCH="$FIX/multi.patch"

chmod +x "$STUBS"/* 2>/dev/null || true

PASS=0; FAIL=0
ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
no() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
mktmp() { mktemp -d "${TMPDIR:-/tmp}/prtest.XXXXXX"; }

# run_review <workdir> -- runs review.sh with stubs on PATH; extra env via caller.
# Common env (REVIEW_MODELS etc.) is set by each caller before invoking.

echo "== hunk-lines.awk golden (unchanged; regression) =="
got=$(awk -f "$AWK" "$PATCH"); exp=$(cat "$FIX/multi.expected.tsv")
if [ "$got" = "$exp" ]; then ok "awk emits the golden (path,side,line) TSV"
else no "awk golden mismatch"; fi

echo "== AC4/AC9  synthesize.jq deterministic core (pure jq) =="
wd=$(mktmp)
verdict() { jq -nr --arg mode verdict --arg code_avail "$3" --arg arch_avail "$4" \
  --slurpfile code "$1" --slurpfile arch "$2" -f "$SYNJQ"; }
echo '{}' > "$wd/empty.json"
# Build the 9-cell table.
tbl_fail=0
declare_cell() { # arch code expect
  printf '{"recommendation":"%s","summary":"x","comments":[]}' "$2" > "$wd/c.json"
  printf '{"architectural_status":"%s","summary":"y","inline_concerns":[],"watchlist_concerns":[]}' "$1" > "$wd/a.json"
  g=$(verdict "$wd/c.json" "$wd/a.json" 1 1)
  [ "$g" = "$3" ] || { tbl_fail=1; echo "    cell arch=$1 code=$2 got=$g want=$3"; }
}
declare_cell CLEAR APPROVE          APPROVE
declare_cell CLEAR COMMENT          COMMENT
declare_cell CLEAR REQUEST_CHANGES  REQUEST_CHANGES
declare_cell WATCH APPROVE          COMMENT
declare_cell WATCH COMMENT          COMMENT
declare_cell WATCH REQUEST_CHANGES  REQUEST_CHANGES
declare_cell BLOCK APPROVE          REQUEST_CHANGES
declare_cell BLOCK COMMENT          REQUEST_CHANGES
declare_cell BLOCK REQUEST_CHANGES  REQUEST_CHANGES
[ "$tbl_fail" -eq 0 ] && ok "gating truth table: all 9 cells correct" || no "gating truth table"

# Degrade rules.
printf '{"recommendation":"APPROVE","summary":"x","comments":[]}' > "$wd/c.json"
printf '{"architectural_status":"BLOCK","summary":"y","inline_concerns":[],"watchlist_concerns":[]}' > "$wd/a.json"
d1=$(verdict "$wd/c.json" "$wd/empty.json" 1 0)   # arch down, code APPROVE -> clamp COMMENT
d2=$(verdict "$wd/empty.json" "$wd/a.json" 0 1)   # code down, arch BLOCK -> REQUEST_CHANGES
printf '{"architectural_status":"CLEAR","summary":"y","inline_concerns":[],"watchlist_concerns":[]}' > "$wd/a2.json"
d3=$(verdict "$wd/empty.json" "$wd/a2.json" 0 1)  # code down, arch CLEAR -> COMMENT
if [ "$d1" = "COMMENT" ] && [ "$d2" = "REQUEST_CHANGES" ] && [ "$d3" = "COMMENT" ]; then
  ok "degrade rules: arch-down clamp, code-down BLOCK/CLEAR"
else no "degrade rules (d1=$d1 d2=$d2 d3=$d3)"; fi

# Watchlist rendering + non-anchorable BLOCK present.
printf '{"architectural_status":"BLOCK","summary":"y","inline_concerns":[],"watchlist_concerns":[{"status":"BLOCK","body":"No rollback."},{"status":"WATCH","body":"Ordering hazard."}]}' > "$wd/awl.json"
wl=$(jq -nr --arg mode watchlist --arg code_avail 1 --arg arch_avail 1 --slurpfile code "$wd/empty.json" --slurpfile arch "$wd/awl.json" -f "$SYNJQ")
if printf '%s' "$wl" | grep -q '### Architecture watchlist' \
   && printf '%s' "$wl" | grep -q -- '- \[BLOCK\] No rollback.' \
   && printf '%s' "$wl" | grep -q -- '- \[WATCH\] Ordering hazard.'; then
  ok "watchlist rendering incl. non-anchorable BLOCK"
else no "watchlist rendering"; fi

# AC8: exact-anchor dedup/merge across lanes (fallback synthesis).
printf '{"recommendation":"COMMENT","summary":"cs","comments":[{"path":"src/a.ts","line":2,"side":"RIGHT","body":"code body","confidence":"high"}]}' > "$wd/cc.json"
printf '{"architectural_status":"WATCH","summary":"as","inline_concerns":[{"path":"src/a.ts","line":2,"side":"RIGHT","body":"arch body","confidence":"high","status":"WATCH"}],"watchlist_concerns":[]}' > "$wd/ac.json"
fb=$(jq -n --arg mode fallback --arg code_avail 1 --arg arch_avail 1 --slurpfile code "$wd/cc.json" --slurpfile arch "$wd/ac.json" -f "$SYNJQ")
ncom=$(printf '%s' "$fb" | jq '.comments | length')
hastags=$(printf '%s' "$fb" | jq -r '.comments[0].body')
if [ "$ncom" = "1" ] && printf '%s' "$hastags" | grep -q '\[code-review\]' && printf '%s' "$hastags" | grep -q '\[architect\]'; then
  ok "AC8 same-anchor finding from both lanes merges into one comment with both tags"
else no "AC8 dedup/merge (ncom=$ncom body=$hastags)"; fi

echo "== AC1/AC2/AC3/AC10  full 3-stage pipeline (code REQUEST_CHANGES + arch BLOCK + synth) =="
wd=$(mktmp); glog="$wd/goose.log"
PATH="$STUBS:$PATH" \
  CODE_REVIEW_MODELS="m1" ARCHITECT_MODELS="m1" SYNTH_MODELS="m1" \
  STUB_GOOSE_LOG="$glog" \
  STUB_CODE_OUT="$FIX/code.bugs.json" STUB_ARCH_OUT="$FIX/arch.block.json" STUB_SYNTH_OUT="$FIX/synth.good.json" \
  WORKDIR="$wd" DIFF_FILE="$PATCH" AWK_SCRIPT="$AWK" HEAD_SHA="deadbeef" SKIP_POST=1 \
  bash "$REVIEW" > "$wd/run.log" 2>&1 || true

runs=$(grep -c 'recipe=' "$glog" 2>/dev/null || echo 0)
distinct=$(grep -o 'stage=[a-z-]*' "$glog" 2>/dev/null | sort -u | wc -l | tr -d ' ')
last_stage=$(tail -1 "$glog" 2>/dev/null | grep -o 'stage=[a-z-]*')
if [ "$runs" = "3" ] && [ "$distinct" = "3" ] && [ "$last_stage" = "stage=synth" ]; then
  ok "AC1 three distinct goose runs; synth runs last"
else no "AC1 (runs=$runs distinct=$distinct last=$last_stage)"; fi

if [ -s "$wd/code-review.review.json" ] && [ -s "$wd/architect.review.json" ]; then
  ok "AC2 both lane artifacts written (non-empty) before synthesis"
else no "AC2 lane artifacts"; fi

# AC3/AC10: payload has only the valid anchor (line 2); the hallucinated 999 is
# dropped; the surviving comment has NO confidence field (anchor-only mode).
np=$(jq '.comments | length' "$wd/payload.json" 2>/dev/null)
has999=$(jq '[.comments[] | select(.line == 999)] | length' "$wd/payload.json" 2>/dev/null)
hasconf=$(jq '[.comments[] | select(has("confidence"))] | length' "$wd/payload.json" 2>/dev/null)
line2=$(jq '[.comments[] | select(.line == 2 and .side == "RIGHT")] | length' "$wd/payload.json" 2>/dev/null)
if [ "$np" = "1" ] && [ "$has999" = "0" ] && [ "$hasconf" = "0" ] && [ "$line2" = "1" ]; then
  ok "AC3/AC10 synth anchors re-validated: hallucinated dropped, confidence-less survivor kept"
else no "AC3/AC10 (np=$np has999=$has999 hasconf=$hasconf line2=$line2)"; fi

echo "== AC11  deterministic safety overlay survives contradictory synth prose =="
wd=$(mktmp)
PATH="$STUBS:$PATH" CODE_REVIEW_MODELS="m1" ARCHITECT_MODELS="m1" SYNTH_MODELS="m1" \
  STUB_CODE_OUT="$FIX/code.bugs.json" STUB_ARCH_OUT="$FIX/arch.block.json" STUB_SYNTH_OUT="$FIX/synth.contradict.json" \
  WORKDIR="$wd" DIFF_FILE="$PATCH" AWK_SCRIPT="$AWK" HEAD_SHA="abc" SKIP_POST=1 \
  bash "$REVIEW" >/dev/null 2>&1 || true
body=$(jq -r '.body' "$wd/payload.json" 2>/dev/null)
markers=$(printf '%s' "$body" | grep -c 'goose-pr-reviewer')
if printf '%s' "$body" | grep -q 'Final recommendation:\*\* REQUEST_CHANGES' \
   && printf '%s' "$body" | grep -q 'ARCHITECT BLOCK' \
   && printf '%s' "$body" | grep -q 'recommendation above is authoritative' \
   && printf '%s' "$body" | grep -q '### Architecture watchlist' \
   && printf '%s' "$body" | grep -q 'rollback path' \
   && [ "$markers" = "1" ]; then
  ok "AC11 verdict line + BLOCK banner + disclaimer + watchlist present; exactly one marker (prose said 'approve')"
else no "AC11 safety overlay (markers=$markers)"; fi

echo "== AC12  synthesizer failure -> deterministic fallback posts =="
wd=$(mktmp)
PATH="$STUBS:$PATH" CODE_REVIEW_MODELS="m1" ARCHITECT_MODELS="m1" SYNTH_MODELS="m1 m2" \
  STUB_FAIL_STAGES="synth" \
  STUB_CODE_OUT="$FIX/code.bugs.json" STUB_ARCH_OUT="$FIX/arch.block.json" \
  WORKDIR="$wd" DIFF_FILE="$PATCH" AWK_SCRIPT="$AWK" HEAD_SHA="abc" SKIP_POST=1 \
  bash "$REVIEW" > "$wd/run.log" 2>&1 || true
fb_note=$(grep -c 'deterministic fallback' "$wd/run.log" 2>/dev/null || echo 0)
np=$(jq '.comments | length' "$wd/payload.json" 2>/dev/null)
# fallback comment is the code lane's valid anchor (line 2), tagged.
tagged=$(jq -r '.comments[0].body // ""' "$wd/payload.json" 2>/dev/null | grep -c '\[code-review\]')
body=$(jq -r '.body' "$wd/payload.json" 2>/dev/null)
if [ "$fb_note" -ge 1 ] && [ "$np" = "1" ] && [ "$tagged" = "1" ] \
   && printf '%s' "$body" | grep -q 'Final recommendation:\*\* REQUEST_CHANGES'; then
  ok "AC12 synth fail -> deterministic fallback summary+dedup posts, logged"
else no "AC12 fallback (fb_note=$fb_note np=$np tagged=$tagged)"; fi

echo "== AC5/AC7  partial-lane survivor + caveat; both-fail exit 1 =="
# Architect lane down: code survives, caveat present, verdict from code, exit 0.
wd=$(mktmp); rc=0
PATH="$STUBS:$PATH" CODE_REVIEW_MODELS="m1" ARCHITECT_MODELS="m1" SYNTH_MODELS="m1" \
  STUB_FAIL_STAGES="architect" \
  STUB_CODE_OUT="$FIX/code.bugs.json" STUB_SYNTH_OUT="$FIX/synth.good.json" \
  WORKDIR="$wd" DIFF_FILE="$PATCH" AWK_SCRIPT="$AWK" HEAD_SHA="abc" SKIP_POST=1 \
  bash "$REVIEW" > "$wd/run.log" 2>&1 || rc=$?
body=$(jq -r '.body' "$wd/payload.json" 2>/dev/null)
if [ "$rc" = "0" ] && [ -s "$wd/payload.json" ] \
   && printf '%s' "$body" | grep -q 'architect lane unavailable' \
   && printf '%s' "$body" | grep -q 'Final recommendation:\*\* REQUEST_CHANGES'; then
  ok "AC5 architect down -> code survivor posts with partial-review caveat, exit 0"
else no "AC5 partial (rc=$rc)"; fi

# Both lanes down: exit 1, nothing posted.
wd=$(mktmp); rec="$wd/ghrec.json"; rc=0
PATH="$STUBS:$PATH" CODE_REVIEW_MODELS="m1" ARCHITECT_MODELS="m1" SYNTH_MODELS="m1" \
  STUB_FAIL_STAGES="code-review architect" \
  STUB_CODE_OUT="$FIX/code.bugs.json" STUB_ARCH_OUT="$FIX/arch.block.json" \
  WORKDIR="$wd" DIFF_FILE="$PATCH" AWK_SCRIPT="$AWK" HEAD_SHA="abc" REPO="o/r" PR="1" \
  STUB_GH_STATE="$wd/st" STUB_GH_RECORD="$rec" \
  bash "$REVIEW" >/dev/null 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && [ ! -f "$rec" ]; then ok "AC5 both lanes fail -> exit 1, nothing posted"
else no "AC5 both-fail (rc=$rc posted=$([ -f "$rec" ] && echo yes || echo no))"; fi

# AC7: stage-namespacing + serial precompute (static check of the script).
if grep -q '\$WORKDIR/\$stage.raw.out' "$REVIEW" \
   && grep -q '\$WORKDIR/\$stage.goose.err' "$REVIEW" \
   && grep -q '\$WORKDIR/\$stage.cleaned.out' "$REVIEW" \
   && grep -q 'code-review.review.json' "$REVIEW" \
   && grep -q 'architect.review.json' "$REVIEW" \
   && grep -qE 'sed .s/\^/  /. "\$DIFF_FILE" > "\$INDENTED_DIFF"' "$REVIEW" \
   && grep -qE 'awk -f "\$AWK_SCRIPT" "\$DIFF_FILE" > "\$VALID_TSV"' "$REVIEW"; then
  ok "AC7 per-stage work files namespaced; INDENTED_DIFF/valid_lines precomputed before fan-out"
else no "AC7 namespacing/precompute static check"; fi

echo "== AC6  workflow security guard =="
if bash "$GUARD" >/dev/null 2>&1; then ok "AC6 check-pr-review-workflow.sh exits 0"
else no "AC6 workflow guard"; fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
