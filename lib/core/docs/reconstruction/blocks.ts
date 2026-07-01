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

import type { ListMark, ParagraphMarks } from "@/lib/core/docs/decoder/style-allowlist";
import type { DocumentModel } from "./model";
import { type Segment, segmentsAt } from "./render";

/** A block's structural kind. Phase 1 emits only `paragraph` and `embed`;
 *  `heading` / `list` arrive with paragraph-style decode (Phase 2). */
export type BlockKind = "paragraph" | "embed";

/** One run inside a block: a `Segment` plus a GLOBAL, document-order `seq` the
 *  viewport uses to address runs across the nested block tree (writing-caret
 *  latch, author highlight) without depending on array position. */
export type BlockRun = Segment & { readonly seq: number };

/** A rendered block: a paragraph of text runs, or a single opaque embed. A
 *  paragraph block carries its resolved `marks` (heading / alignment / spacing,
 *  read from the terminating paragraph-mark `\n` — or the EndOfBody sentinel for
 *  the final paragraph). Absent `marks` = the document default. BlockKind stays
 *  `paragraph`/`embed`; heading vs. body is a property (`marks.headingLevel`), not
 *  a separate kind, so a heading can still be aligned, indented, etc. */
export interface Block {
  readonly kind: BlockKind;
  readonly runs: readonly BlockRun[];
  readonly marks?: ParagraphMarks;
  readonly list?: ListMark;
}

/** The resolved style of one paragraph: its block marks and list membership. */
interface ParagraphStyle {
  readonly block?: ParagraphMarks;
  readonly list?: ListMark;
}

/**
 * Collect the resolved paragraph-style marks in document order: one per VISIBLE
 * paragraph-mark `\n` (a live, non-struck char), then one for the EndOfBody
 * sentinel (the final paragraph's mark). This mirrors `blocksAt`'s paragraph
 * emission exactly — the Nth real paragraph block corresponds to the Nth entry —
 * so styles attach without depending on segment coalescing. Struck `\n` are
 * skipped (they don't split a paragraph); the post-EOB footnote region is ignored.
 */
function collectParagraphMarks(model: DocumentModel): readonly ParagraphStyle[] {
  const styles: ParagraphStyle[] = [];
  const push = (block: ParagraphMarks | undefined, list: ListMark | undefined): void => {
    styles.push({
      ...(block !== undefined ? { block } : {}),
      ...(list !== undefined ? { list } : {}),
    });
  };
  for (const el of model.chars) {
    if (el.deleteRevision !== null) {
      continue;
    }
    if (el.kind === "eob") {
      push(el.block, el.list);
      break;
    }
    if (el.kind === "char" && el.char === "\n" && el.suggestionState !== "marked-for-deletion") {
      push(el.block, el.list);
    }
  }
  return styles;
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

  // Paragraph styles in document order; a REAL/final paragraph emit consumes the
  // next one. Embed-split pseudo-paragraphs (a leftover run before an embed) do
  // NOT consume — they are a fragment of a larger paragraph, not a boundary.
  const paragraphMarks = collectParagraphMarks(model);
  let paragraphIndex = 0;

  const emitParagraph = (real: boolean): void => {
    const style = real ? paragraphMarks[paragraphIndex++] : undefined;
    blocks.push({
      kind: "paragraph",
      runs,
      ...(style?.block !== undefined ? { marks: style.block } : {}),
      ...(style?.list !== undefined ? { list: style.list } : {}),
    });
    runs = [];
  };
  const emitEmbed = (): void => {
    blocks.push({ kind: "embed", runs });
    runs = [];
  };

  for (const segment of segmentsAt(model)) {
    if (segment.kind === "opaque-placeholder") {
      if (runs.length > 0) emitParagraph(false);
      runs.push({ ...segment, seq: seq++ });
      emitEmbed();
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
        emitParagraph(true);
        openParagraphAfterNewline = true;
      } else {
        openParagraphAfterNewline = false;
      }
    }
  }
  if (runs.length > 0 || openParagraphAfterNewline) emitParagraph(true);
  return blocks;
}
