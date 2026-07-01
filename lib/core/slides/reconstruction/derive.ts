// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides summary/timeline op-accounting. The metadata-derived analysis (session
// grouping, pauses, the time axis) is shared via `RevisionMeta`, but the OP-derived
// numbers are kind-specific: a `SlidesOperation` is a disjoint union, so the Docs
// char-delta extractor would score every Slides revision zero. This module supplies
// the Slides extractors — counting inserted/deleted text CHARACTERS — injected into
// the shared summary/timeline cores.
//
// PURE: no browser / fetch / Worker.

import type { TimelineEvent } from "@/lib/core/domain/model";
import type { SlidesDecodedRevision, SlidesOperation } from "@/lib/core/slides/decoder/types";
import {
  type DocumentSummary,
  deriveSummaryWith,
  type SummaryExtractor,
} from "@/lib/core/summary/derive";
import {
  type DeriveOptions,
  deriveTimelineWith,
  type TimelineExtractor,
} from "@/lib/core/timeline/derive";

/** Inserted/deleted CHARACTER counts for one op (insert = inserted, delete = deleted). */
function opDelta(op: SlidesOperation): { inserted: number; deleted: number } {
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
    case "insert-text":
      return { inserted: op.text.length, deleted: 0 };
    case "delete-text":
      return { inserted: 0, deleted: Math.max(0, op.end - op.start) };
    default:
      return { inserted: 0, deleted: 0 };
  }
}

/** The text offset an op edits (a rough "where" proxy), or null for non-text ops. */
function opPosition(op: SlidesOperation): number | null {
  switch (op.op) {
    case "txn": {
      for (const sub of op.ops) {
        const position = opPosition(sub);
        if (position !== null) return position;
      }
      return null;
    }
    case "insert-text":
      return op.offset + 1;
    case "delete-text":
      return op.start + 1;
    default:
      return null;
  }
}

/** The Slides summary extractor: char-edit counts + the first edited text offset. */
export const slidesSummaryExtractor: SummaryExtractor<SlidesDecodedRevision> = {
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

/** The Slides timeline extractor: net char-edit count per revision. */
export const slidesTimelineExtractor: TimelineExtractor<SlidesDecodedRevision> = {
  delta: slidesSummaryExtractor.delta,
};

/** Derive the document summary for a Slides presentation (chars-edited accounting). */
export function deriveSlidesSummary(revisions: readonly SlidesDecodedRevision[]): DocumentSummary {
  return deriveSummaryWith(revisions, slidesSummaryExtractor);
}

/** Derive timeline events for a Slides presentation (chars-edited accounting). */
export function deriveSlidesTimeline(
  revisions: readonly SlidesDecodedRevision[],
  options: DeriveOptions = {},
): TimelineEvent[] {
  return deriveTimelineWith(revisions, slidesTimelineExtractor, options);
}
