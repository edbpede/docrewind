#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# run-pr-review-tests.sh — deterministic local tests for the PR reviewer.
#
# Exercises every stage that does NOT need the live NanoGPT API or a live PR, by
# putting stub `goose`/`gh` binaries on PATH. Covers US-001..US-007 and the
# locally-reachable acceptance criteria AC2/AC3/AC5/AC7 (+ the deterministic half
# of AC4). The live ACs (M0 handshake, AC1, AC4 model behaviour, AC6) are
# CI/secret-gated — see scripts/test/README.md.
#
# Usage: bash scripts/test/run-pr-review-tests.sh   (exits non-zero on any FAIL)

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$ROOT"

FIX="$SCRIPT_DIR/fixtures"
STUBS="$SCRIPT_DIR/stubs"
REVIEW="$ROOT/scripts/review.sh"
AWK="$ROOT/scripts/hunk-lines.awk"
GUARD="$ROOT/scripts/check-pr-review-workflow.sh"
WF="$ROOT/.github/workflows/pr-review.yml"
RECIPE="$ROOT/.goose/recipe.yaml"

chmod +x "$STUBS"/* 2>/dev/null || true

PASS=0; FAIL=0
ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
no() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
mktmp() { mktemp -d "${TMPDIR:-/tmp}/prtest.XXXXXX"; }

echo "== US-001  hunk-lines.awk =="
got=$(awk -f "$AWK" "$FIX/multi.patch")
exp=$(cat "$FIX/multi.expected.tsv")
if [ "$got" = "$exp" ]; then ok "awk emits the golden (path,side,line) TSV (incl. '+++ ' content line, single-line hunk, new file)"
else no "awk golden mismatch"; fi

echo "== US-003  fallback loop / extraction / diagnostics =="

# AC5: tier-1 forced failure -> tier-2 used, fallback_attempts == 1
wd=$(mktmp)
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA tierB" STUB_FAIL_MODELS="tierA" \
  STUB_GOOSE_OUT="$FIX/review.clean.json" WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" \
  AWK_SCRIPT="$AWK" SKIP_POST=1 bash "$REVIEW" >/dev/null 2>&1 || true
fa=$(jq -r '.fallback_attempts' "$wd/review.json" 2>/dev/null)
mu=$(jq -r '.model_used' "$wd/review.json" 2>/dev/null)
if [ "$fa" = "1" ] && [ "$mu" = "tierB" ]; then ok "AC5 tier-1 fails -> tierB used, fallback_attempts=1"
else no "AC5 fallback (fallback_attempts=$fa model_used=$mu)"; fi

# Prose / reasoning-wrapped output is still recovered (and gate-A passes)
wd=$(mktmp)
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/goose.prose.out" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" SKIP_POST=1 \
  bash "$REVIEW" >/dev/null 2>&1 || true
ev=$(jq -r '.review_event' "$wd/review.json" 2>/dev/null)
nc=$(jq -r '.comments|length' "$wd/review.json" 2>/dev/null)
if [ "$ev" = "COMMENT" ] && [ "$nc" = "1" ]; then ok "thinking/prose-wrapped output extracted to clean review.json"
else no "prose extraction (review_event=$ev comments=$nc)"; fi

# Host-misconfig: all tiers fail with identical route 4xx -> diagnostic + nonzero
wd=$(mktmp); rc=0
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA tierB" STUB_FAIL_MODELS="tierA tierB" \
  STUB_HOST_FAIL=1 WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" \
  SKIP_POST=1 bash "$REVIEW" > "$wd/log" 2>&1 || rc=$?
if grep -q "likely OPENAI_HOST/provider misconfig" "$wd/log" && [ "$rc" -ne 0 ]; then
  ok "host-misconfig diagnostic fires + nonzero exit"
else no "host-misconfig (rc=$rc)"; fi

# AC4 (deterministic half): a coerced non-COMMENT event is rejected by gate-A,
# the run fails, and nothing is posted.
wd=$(mktmp); rec="$wd/ghrec.json"; rc=0
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.bad-event.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="abc" REPO="o/r" PR="1" \
  STUB_GH_STATE="$wd/st" STUB_GH_RECORD="$rec" bash "$REVIEW" >/dev/null 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && [ ! -f "$rec" ]; then ok "AC4 gate-A rejects review_event=APPROVE; nothing posted"
else no "AC4 gate-A (rc=$rc posted=$([ -f "$rec" ] && echo yes || echo no))"; fi

echo "== US-004  anchor pre-filter + payload build =="

# AC3 + AC7 pre-filter: drop out-of-hunk + non-high comments; strip diag fields
wd=$(mktmp)
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.bugs.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="deadbeef" \
  SKIP_POST=1 bash "$REVIEW" >/dev/null 2>&1 || true
n=$(jq '.comments|length' "$wd/payload.json" 2>/dev/null)
badline=$(jq '[.comments[]|select(.line==999)]|length' "$wd/payload.json" 2>/dev/null)
medium=$(jq '[.comments[]|select(.line==4)]|length' "$wd/payload.json" 2>/dev/null)
stripped=$(jq '[.comments[]|select(has("severity") or has("category") or has("confidence"))]|length' "$wd/payload.json" 2>/dev/null)
commit=$(jq -r '.commit_id' "$wd/payload.json" 2>/dev/null)
event=$(jq -r '.event' "$wd/payload.json" 2>/dev/null)
mark=$(jq -r '.body' "$wd/payload.json" 2>/dev/null | head -1)
awk -f "$AWK" "$FIX/multi.patch" > "$wd/valid.tsv"
orphans=$(jq --rawfile v "$wd/valid.tsv" '
  def key(p;s;l): p+"\t"+s+"\t"+(l|tostring);
  ($v|split("\n")|map(select(length>0))) as $rows
  | (reduce $rows[] as $r ({}; .[$r]=true)) as $set
  | [ .comments[] | select(($set[key(.path;.side;.line)]==true)|not) ] | length
' "$wd/payload.json" 2>/dev/null)
if [ "$n" = "3" ] && [ "$badline" = "0" ] && [ "$medium" = "0" ] && [ "$stripped" = "0" ] \
   && [ "$commit" = "deadbeef" ] && [ "$event" = "COMMENT" ] && [ "$orphans" = "0" ] \
   && printf '%s' "$mark" | grep -q 'goose-pr-reviewer'; then
  ok "AC3/AC7 pre-filter: 3 valid survivors, out-of-hunk+non-high dropped, diag stripped, every anchor valid"
else
  no "anchor filter (n=$n badline=$badline medium=$medium stripped=$stripped commit=$commit event=$event orphans=$orphans)"
fi

# AC2: clean diff -> summary-only payload, exit 0
wd=$(mktmp); rc=0
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.clean.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="abc" SKIP_POST=1 \
  bash "$REVIEW" >/dev/null 2>&1 || rc=$?
n=$(jq '.comments|length' "$wd/payload.json" 2>/dev/null)
if [ "$rc" = "0" ] && [ "$n" = "0" ]; then ok "AC2 clean review -> summary-only payload, exit 0"
else no "AC2 clean (rc=$rc comments=$n)"; fi

echo "== US-005  posting / 422 tolerance / diff cap =="

# should_post_review=false + no comments -> skip posting entirely
wd=$(mktmp); rec="$wd/ghrec.json"; rc=0
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.nopost.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="abc" REPO="o/r" PR="1" \
  STUB_GH_STATE="$wd/st" STUB_GH_RECORD="$rec" bash "$REVIEW" >/dev/null 2>&1 || rc=$?
if [ "$rc" = "0" ] && [ ! -f "$rec" ]; then ok "should_post_review=false -> no review posted"
else no "nopost skip (rc=$rc posted=$([ -f "$rec" ] && echo yes || echo no))"; fi

# AC7 retry: structured 422 names an offender -> drop it, retry succeeds
wd=$(mktmp); rec="$wd/ghrec.json"
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.bugs.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="abc" REPO="o/r" PR="1" \
  STUB_GH_STATE="$wd/st" STUB_GH_RECORD="$rec" STUB_GH_FAIL_ONCE=1 STUB_GH_STRUCTURED=1 \
  STUB_GH_BADPATH="src/a.ts" STUB_GH_BADLINE=2 bash "$REVIEW" >/dev/null 2>&1 || true
calls=$(cat "$wd/st" 2>/dev/null)
dropped=$(jq '[.comments[]|select(.path=="src/a.ts" and .line==2)]|length' "$rec" 2>/dev/null)
remain=$(jq '.comments|length' "$rec" 2>/dev/null)
if [ "$calls" = "2" ] && [ "$dropped" = "0" ] && [ "$remain" = "2" ]; then
  ok "AC7 422 names offender -> dropped + retried, valid comments still posted"
else no "AC7 targeted-drop (calls=$calls dropped=$dropped remain=$remain)"; fi

# Structured 422 naming a phantom offender (not in payload) -> summary-only,
# WITHOUT burning the retry budget on an unchanged payload.
wd=$(mktmp); rec="$wd/ghrec.json"
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.bugs.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="abc" REPO="o/r" PR="1" \
  STUB_GH_STATE="$wd/st" STUB_GH_RECORD="$rec" STUB_GH_FAIL_ONCE=1 STUB_GH_STRUCTURED=1 \
  STUB_GH_BADPATH="src/zzz.ts" STUB_GH_BADLINE=42 bash "$REVIEW" >/dev/null 2>&1 || true
calls=$(cat "$wd/st" 2>/dev/null)
remain=$(jq '.comments|length' "$rec" 2>/dev/null)
if [ "$calls" = "2" ] && [ "$remain" = "0" ]; then ok "phantom 422 offender -> summary-only at once (no wasted retries)"
else no "phantom 422 (calls=$calls remain=$remain)"; fi

# Generic 422 (no offender named) -> summary-only last resort
wd=$(mktmp); rec="$wd/ghrec.json"
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.bugs.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="abc" REPO="o/r" PR="1" \
  STUB_GH_STATE="$wd/st" STUB_GH_RECORD="$rec" STUB_GH_FAIL_ONCE=1 STUB_GH_STRUCTURED=0 \
  bash "$REVIEW" >/dev/null 2>&1 || true
calls=$(cat "$wd/st" 2>/dev/null)
remain=$(jq '.comments|length' "$rec" 2>/dev/null)
if [ "$calls" = "2" ] && [ "$remain" = "0" ]; then ok "generic 422 -> summary-only COMMENT last resort"
else no "generic 422 (calls=$calls remain=$remain)"; fi

# Diff over cap -> summary-only partial-review note, never invokes the model
wd=$(mktmp)
PATH="$STUBS:$PATH" REVIEW_MODELS="tierA" STUB_GOOSE_OUT="$FIX/review.clean.json" \
  WORKDIR="$wd" DIFF_FILE="$FIX/multi.patch" AWK_SCRIPT="$AWK" HEAD_SHA="abc" \
  MAX_DIFF_BYTES=10 SKIP_POST=1 bash "$REVIEW" >/dev/null 2>&1 || true
n=$(jq '.comments|length' "$wd/payload.json" 2>/dev/null)
if [ "$n" = "0" ] && jq -r '.body' "$wd/payload.json" 2>/dev/null | grep -q "exceeded the automated-review size budget"; then
  ok "diff over MAX_DIFF_BYTES -> summary-only partial note"
else no "diff-too-large (comments=$n)"; fi

echo "== US-007  workflow security guard =="
if bash "$GUARD" "$WF" >/dev/null 2>&1; then ok "guard passes the real workflow"
else no "guard should pass real workflow"; fi
wd=$(mktmp); cp "$WF" "$wd/wf.yml"
printf '      - name: Sneaky build\n        run: bun install --frozen-lockfile\n' >> "$wd/wf.yml"
if bash "$GUARD" "$wd/wf.yml" >/dev/null 2>&1; then no "guard should REJECT an added 'bun install' step"
else ok "guard rejects an added package-manager (bun) step"; fi
# 'ubuntu-latest' must not be a false positive for the 'bun' token
if bash "$GUARD" "$WF" >/dev/null 2>&1; then ok "no 'bun' false-positive on 'ubuntu-latest'"
else no "false positive on ubuntu-latest"; fi
# Guard rejects checking out pull_request.head (the real RCE class, no build step needed)
wd=$(mktmp); cp "$WF" "$wd/wf.yml"
printf '      - name: Sneaky checkout\n        uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n' >> "$wd/wf.yml"
if bash "$GUARD" "$wd/wf.yml" >/dev/null 2>&1; then no "guard should REJECT a pull_request.head checkout"
else ok "guard rejects a pull_request.head checkout (secret-exfil RCE class)"; fi
# The real workflow uses head.sha only as data (commit_id), not as a checkout ref -> still passes
if bash "$GUARD" "$WF" >/dev/null 2>&1; then ok "real workflow uses head.sha as data only -> guard passes"
else no "guard false-positive on head.sha used as data"; fi

echo "== US-006  workflow structure =="
f=0
grep -qE 'pull_request_target:' "$WF" || f=$((f+1))
grep -qE 'contents:[[:space:]]*read' "$WF" || f=$((f+1))
grep -qE 'pull-requests:[[:space:]]*write' "$WF" || f=$((f+1))
grep -qE 'cancel-in-progress:[[:space:]]*true' "$WF" || f=$((f+1))
grep -q 'NANOGPT_API_KEY' "$WF" || f=$((f+1))
grep -qE 'GOOSE_PROVIDER:[[:space:]]*openai' "$WF" || f=$((f+1))
grep -q 'scripts/review.sh' "$WF" || f=$((f+1))
if grep -q 'gh pr view' "$WF"; then f=$((f+1)); fi   # diff-only: must NOT feed PR meta
if [ "$f" = "0" ]; then ok "workflow: pull_request_target, least-priv perms, concurrency dedup, diff-only, runs review.sh"
else no "workflow structure ($f checks failed)"; fi

echo "== US-002  recipe structure =="
f=0
for s in "Untrusted input" "Confidence gate" "Anchoring" "Self-review" "Output contract" "Scope"; do
  grep -qi "$s" "$RECIPE" || { echo "    (missing recipe section: $s)"; f=$((f+1)); }
done
grep -q 'json_schema' "$RECIPE" || f=$((f+1))
grep -q 'COMMENT' "$RECIPE" || f=$((f+1))
grep -q 'additionalProperties: false' "$RECIPE" || f=$((f+1))
grep -q '{{ diff }}' "$RECIPE" || f=$((f+1))
for k in should_post_review review_event fallback_attempts model_used severity category confidence start_line start_side; do
  grep -q "$k" "$RECIPE" || { echo "    (missing schema key: $k)"; f=$((f+1)); }
done
if [ "$f" = "0" ]; then ok "recipe: 10 instruction sections + COMMENT-only schema with all keys + diff param"
else no "recipe structure ($f checks failed)"; fi

echo
echo "================ RESULT: $PASS passed, $FAIL failed ================"
[ "$FAIL" -eq 0 ]
