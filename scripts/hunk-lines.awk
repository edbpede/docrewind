# SPDX-License-Identifier: AGPL-3.0-or-later
#
# hunk-lines.awk — enumerate the diff-anchorable lines of a unified git diff.
#
# Reads a `git diff` / `gh pr diff` patch on stdin and prints one TAB-separated
# row per anchorable line:
#
#     <path><TAB><side><TAB><line>
#
#   side = RIGHT  ->  line is numbered in the NEW file (added + context lines)
#   side = LEFT   ->  line is numbered in the OLD file (deleted + context lines)
#
# This is the gate-B anchor source for scripts/review.sh: GitHub's review POST is
# atomic, so a single comment whose (path, line, side) is not part of the diff
# 422s the *entire* review. Filtering the model's comments against this set makes
# anchor validity true by construction.
#
# It is deliberately NOT a full diff parser. It only reads `diff --git` headers
# (for the path) and `@@` hunk headers (for line numbering), then walks hunk
# bodies. Filename comes from `diff --git ... b/<path>` plus an in-hunk flag —
# never from `+++ `/`--- ` lines — so a content line that begins with `+++ ` or
# `--- ` inside a hunk is not mistaken for a file header.
#
# Known limitation: a rename anchors LEFT-side (deleted) lines under the new
# path; review.sh's 422-retry tolerates the rare drop. Paths containing spaces
# are not handled (git would quote them); acceptable for a low-noise reviewer.

# New file section: take the post-image path from the final field (b/<path>),
# strip the "b/" prefix, and leave the hunk until the next @@.
/^diff --git / {
  path = $NF
  sub(/^b\//, "", path)
  in_hunk = 0
  next
}

# Hunk header: @@ -<oldStart>[,<oldLen>] +<newStart>[,<newLen>] @@
# Reset both running line counters to the hunk's declared starts.
/^@@ / {
  old = $2; sub(/^-/, "", old); split(old, o, ","); ll = o[1] + 0
  new = $3; sub(/^\+/, "", new); split(new, n, ","); rl = n[1] + 0
  in_hunk = 1
  next
}

# Hunk body. The leading marker is the diff status of the line; the rest is
# content and is never re-interpreted as a header because in_hunk is set.
in_hunk && /^\+/  { print path "\tRIGHT\t" rl; rl++; next }   # added   -> NEW numbering
in_hunk && /^-/   { print path "\tLEFT\t"  ll; ll++; next }   # deleted -> OLD numbering
in_hunk && /^ /   { print path "\tRIGHT\t" rl; print path "\tLEFT\t" ll; rl++; ll++; next }   # context -> both
in_hunk && /^\\/  { next }   # "\ No newline at end of file" — not a real line
