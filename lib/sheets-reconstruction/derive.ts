// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sheets summary/timeline op-accounting (plan P4). The metadata-derived analysis
// (session grouping, pauses, the time axis) is shared via `RevisionMeta`, but the
// OP-derived numbers are kind-specific: a `SheetsOperation` is a disjoint union,
// so the Docs char-delta extractor would score every Sheets revision zero. This
// module supplies the Sheets extractors — counting CELL edits — injected into the
// shared summary/timeline cores. "Cells edited" vs "characters typed" is a
// presentation label ON TOP of these numbers, never a substitute.
//
// PURE: no browser / fetch / Worker.

import type { TimelineEvent } from "../domain/model";
import type { SheetsDecodedRevision, SheetsOperation, SheetsRange } from "../sheets-decoder/types";
import { type DocumentSummary, deriveSummaryWith, type SummaryExtractor } from "../summary/derive";
import { type DeriveOptions, deriveTimelineWith, type TimelineExtractor } from "../timeline/derive";

/** Cap on cells counted per op so a whole-column format never inflates the metric. */
const MAX_COUNTED_CELLS = 4096;

function rangeCellCount(range: SheetsRange): number {
  const rows = Math.max(0, range.rowEnd - range.rowStart);
  const cols = Math.max(0, range.colEnd - range.colStart);
  return Math.min(rows * cols, MAX_COUNTED_CELLS);
}

/** Inserted/deleted CELL counts for one op (set = inserted, clear = deleted). */
function opDelta(op: SheetsOperation): { inserted: number; deleted: number } {
  switch (op.op) {
    case "txn": {
      let inserted = 0;
      let deleted = 0;
      for (const sub of op.ops) {
        const d = opDelta(sub);
        inserted += d.inserted;
        deleted += d.deleted;
      }
      return { inserted, deleted };
    }
    case "cell": {
      if (op.content.kind === "none") return { inserted: 0, deleted: 0 };
      const n = rangeCellCount(op.range);
      return op.content.kind === "clear"
        ? { inserted: 0, deleted: n }
        : { inserted: n, deleted: 0 };
    }
    default:
      return { inserted: 0, deleted: 0 };
  }
}

/** The 1-indexed row of the first cell edit in an op (a rough "where" proxy), or null. */
function opPosition(op: SheetsOperation): number | null {
  switch (op.op) {
    case "txn": {
      for (const sub of op.ops) {
        const position = opPosition(sub);
        if (position !== null) return position;
      }
      return null;
    }
    case "cell":
      return op.range.rowStart + 1;
    default:
      return null;
  }
}

/** The Sheets summary extractor: cell-edit counts + the first edited row. */
export const sheetsSummaryExtractor: SummaryExtractor<SheetsDecodedRevision> = {
  delta(revision) {
    let inserted = 0;
    let deleted = 0;
    for (const op of revision.operations) {
      const d = opDelta(op);
      inserted += d.inserted;
      deleted += d.deleted;
    }
    return { inserted, deleted };
  },
  position(revision) {
    for (const op of revision.operations) {
      const position = opPosition(op);
      if (position !== null) return position;
    }
    return null;
  },
};

/** The Sheets timeline extractor: net cell-edit count per revision. */
export const sheetsTimelineExtractor: TimelineExtractor<SheetsDecodedRevision> = {
  delta: sheetsSummaryExtractor.delta,
};

/** Derive the document summary for a Sheets document (cells-edited accounting). */
export function deriveSheetsSummary(revisions: readonly SheetsDecodedRevision[]): DocumentSummary {
  return deriveSummaryWith(revisions, sheetsSummaryExtractor);
}

/** Derive timeline events for a Sheets document (cells-edited accounting). */
export function deriveSheetsTimeline(
  revisions: readonly SheetsDecodedRevision[],
  options: DeriveOptions = {},
): TimelineEvent[] {
  return deriveTimelineWith(revisions, sheetsTimelineExtractor, options);
}
