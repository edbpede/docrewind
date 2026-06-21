// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Block grouping (plan Phase 1). `segmentsAt(model)` yields a FLAT run list; this
// module regroups those runs into paragraph / embed BLOCKS so the viewport can
// render real <p> structure (and Phase 2+ can attach paragraph style) instead of
// one pre-wrapped slab.
//
// SINGLE-ARG, exactly like `segmentsAt`: the model is ALREADY time-traveled by
// `modelAtRevisionIndex`. `blocksAt` calls `segmentsAt` internally and never
// takes a `t`/index. `segmentsAt` (and its proven concatenation invariant in
// render.test.ts) is UNTOUCHED — blocks are a derived view layered on top.
//
// TEXT IS PRESERVED, NOT ALTERED. Paragraph splitting happens on the newline
// character, but the '\n' is NEVER dropped: it stays the LAST character of the
// run before the boundary, so concatenating every accepted-text + suggested-insert
// BlockRun text STILL equals currentText(model) — the exact render.test.ts
// invariant, mirrored in blocks.test.ts. The viewport strips a single trailing
// '\n' from a block's last run for display (paragraph separation comes from the
// <p> box, not the mark). marked-for-deletion runs are kept WHOLE (never split on
// their '\n') because struck text is excluded from currentText, so a
// suggestion-deleted paragraph mark must not forge a real paragraph boundary.

import type { DocumentModel } from "./model";
import { type Segment, segmentsAt } from "./render";

/** A block's structural kind. Phase 1 emits only `paragraph` and `embed`;
 *  `heading` / `list` arrive with paragraph-style decode (Phase 2). */
export type BlockKind = "paragraph" | "embed";

/** One run inside a block: a `Segment` plus a GLOBAL, document-order `seq` the
 *  viewport uses to address runs across the nested block tree (writing-caret
 *  latch, author highlight) without depending on array position. */
export type BlockRun = Segment & { readonly seq: number };

/** A rendered block: a paragraph of text runs, or a single opaque embed. */
export interface Block {
  readonly kind: BlockKind;
  readonly runs: readonly BlockRun[];
}

/**
 * Group the model's flat segments into paragraph / embed blocks.
 *
 * Rules:
 *  - `accepted-text` / `suggested-insert` runs split at '\n'; each '\n' stays
 *    attached to the end of its run (text is never dropped) and flushes the
 *    current paragraph. A trailing '\n' yields a final empty paragraph block
 *    (so N newlines produce N+1 paragraph blocks), exactly like `split("\n")`.
 *  - `marked-for-deletion` runs are kept whole (struck text + any '\n' is
 *    excluded from currentText, so it never forms a paragraph boundary).
 *  - An `opaque-placeholder` becomes its OWN `embed` block (deterministic
 *    boundaries; true inline-image fidelity is deferred to a later phase).
 *  - Every run carries a contiguous, unique global `seq` in document order.
 *
 * Invariant (proven in blocks.test.ts, mirroring render.test.ts): concatenating
 * the `accepted-text` + `suggested-insert` run text across all blocks equals
 * `currentText(model)`.
 */
export function blocksAt(model: DocumentModel): readonly Block[] {
  const blocks: Block[] = [];
  let runs: BlockRun[] = [];
  let seq = 0;
  // A '\n' just closed a paragraph, opening a fresh (so far empty) one. Recorded
  // so a trailing newline still emits its empty final paragraph, while an
  // embed/EOF after non-newline content does not invent a spurious empty block.
  let openParagraphAfterNewline = false;

  const emit = (kind: BlockKind): void => {
    blocks.push({ kind, runs });
    runs = [];
  };

  for (const segment of segmentsAt(model)) {
    if (segment.kind === "opaque-placeholder") {
      if (runs.length > 0) emit("paragraph");
      runs.push({ ...segment, seq: seq++ });
      emit("embed");
      openParagraphAfterNewline = false;
      continue;
    }
    if (segment.kind === "marked-for-deletion") {
      runs.push({ ...segment, seq: seq++ });
      openParagraphAfterNewline = false;
      continue;
    }
    // accepted-text | suggested-insert: split on '\n', keeping each '\n' on the
    // left part so no character is dropped (the concatenation invariant).
    for (const part of segment.text.split(/(?<=\n)/)) {
      runs.push({ ...segment, text: part, seq: seq++ });
      if (part.endsWith("\n")) {
        emit("paragraph");
        openParagraphAfterNewline = true;
      } else {
        openParagraphAfterNewline = false;
      }
    }
  }
  if (runs.length > 0 || openParagraphAfterNewline) emit("paragraph");
  return blocks;
}
