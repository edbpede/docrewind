# SPDX-License-Identifier: AGPL-3.0-or-later
#
# synthesize.jq — the deterministic core of the two-lane PR reviewer.
#
# This is the "script disposes" half of the design: the verdict, the
# fallback summary/comment synthesis, and the architecture watchlist are
# all computed here by pure jq — never by a model — so a synthesizer
# omission, contradiction, or outage can neither hide a blocker nor fake an
# approval. review.sh calls it in three modes; the committed unit test
# (scripts/test/run-pr-review-tests.sh) exercises every branch with no
# network, model, goose, or gh.
#
# Invocation (always run with `jq -nr`):
#   jq -nr --arg mode <verdict|watchlist|fallback> \
#          --arg code_avail <0|1> --arg arch_avail <0|1> \
#          --slurpfile code <code-lane filtered json | {}> \
#          --slurpfile arch <architect-lane partitioned json | {}> \
#          -f scripts/synthesize.jq
#
# Inputs (both UNTRUSTED model output, already anchor-filtered upstream):
#   code : { recommendation, summary, comments[] }            (code-review lane)
#   arch : { architectural_status, summary,
#            inline_concerns[], watchlist_concerns[] }         (architect lane)
# When a lane is unavailable the caller passes `{}` and sets its *_avail to 0.
#
# Modes:
#   verdict   -> raw string: the authoritative final recommendation (§3.2.1).
#   watchlist -> raw string: the "### Architecture watchlist" markdown ("" if none).
#   fallback  -> JSON object { summary, comments[] }: the deterministic synthesis
#                used only when the LLM synthesizer fails all tiers.

# --- §3.2.1 gating truth table + partial-lane degrade overlay ----------------
# Ordered conditionals reproduce the 3x3 table exactly (see the test's truth
# table). APPROVE is only ever reachable on CLEAR x APPROVE with both lanes up.
def verdict($aav; $cav; $as; $cr):
  if $aav and $cav then
    if   $as == "BLOCK"            then "REQUEST_CHANGES"
    elif $cr == "REQUEST_CHANGES"  then "REQUEST_CHANGES"
    elif $as == "WATCH"            then "COMMENT"
    elif $cr == "COMMENT"          then "COMMENT"
    elif ($cr == "APPROVE" and $as == "CLEAR") then "APPROVE"
    else "COMMENT" end
  elif $cav then                              # architect unavailable: clamp <= COMMENT
    if $cr == "APPROVE" then "COMMENT" else (if $cr == "" then "COMMENT" else $cr end) end
  elif $aav then                              # code unavailable
    if $as == "BLOCK" then "REQUEST_CHANGES" else "COMMENT" end
  else "COMMENT" end;                         # both unavailable (caller exits 1 first)

def trim: (. // "") | gsub("^\\s+|\\s+$"; "");

# --- deterministic watchlist render ------------------------------------------
def watchlist_md($wl):
  ($wl // [])
  | if length == 0 then ""
    else "### Architecture watchlist\n"
       + ( map("- [" + (.status // "WATCH") + "] " + (.body | trim)) | join("\n") )
    end;

# --- deterministic fallback comment merge (exact-anchor dedup across lanes) ---
# Each lane's findings are tagged with their origin, then grouped by the exact
# anchor key (path,side,line); same-anchor findings from both lanes merge into
# one comment carrying both tags. group_by preserves input order, so the
# code-review tag precedes the architect tag in a merged body.
def tag($lane; $arr):
  ($arr // []) | map({
    path, side, line,
    start_line: (.start_line // null),
    start_side: (.start_side // null),
    body: ("**[" + $lane + "]** " + (.body | trim)),
    _key: (.path + "\t" + .side + "\t" + (.line | tostring))
  });

def merge_comments($code_comments; $arch_inline):
  ( tag("code-review"; $code_comments) + tag("architect"; $arch_inline) )
  | group_by(._key)
  | map(
      .[0] as $f
      | { path: $f.path, side: $f.side, line: $f.line,
          body: ( map(.body) | join("\n\n") ) }
        + (if $f.start_line != null then { start_line: $f.start_line } else {} end)
        + (if $f.start_side != null then { start_side: $f.start_side } else {} end)
    );

# --- deterministic fallback summary (templated, never narrative prose) --------
def lane_summary($avail; $label; $verdict_field; $summary):
  if $avail then
    ($label + " (" + $verdict_field + "): "
      + (if ($summary | trim) == "" then "no summary provided." else ($summary | trim) end))
  else
    ($label + ": unavailable — partial review.")
  end;

# --- entrypoint --------------------------------------------------------------
($code[0] // {}) as $c
| ($arch[0] // {}) as $a
| ($code_avail == "1") as $cav
| ($arch_avail == "1") as $aav
| ($a.architectural_status // "") as $as
| ($c.recommendation // "") as $cr
| verdict($aav; $cav; $as; $cr) as $final
| if   $mode == "verdict"   then $final
  elif $mode == "watchlist" then watchlist_md($a.watchlist_concerns)
  elif $mode == "fallback"  then
    { summary: ( [ lane_summary($cav; "Code review"; $cr; $c.summary),
                   lane_summary($aav; "Architecture"; $as; $a.summary) ]
                 | join("\n\n") ),
      comments: merge_comments($c.comments; $a.inline_concerns) }
  else error("synthesize.jq: unknown mode \"" + ($mode // "") + "\"") end
