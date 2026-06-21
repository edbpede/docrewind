// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Document-summary derivation (the "advanced view" linked from the replay page).
// PURE and browser-free (same contract as the rest of the pure core): it walks
// the decoded revisions ONCE to produce the two content-free signals the summary
// page visualizes —
//
//   1. document LENGTH over time (the area chart), and
//   2. the POSITION of each edit in the document over time (the scatter).
//
// Everything here is metadata only (timestamps, character COUNTS, and 1-indexed
// edit POSITIONS) — never any document text — so it stays inside the privacy
// model (R5, §13.7), exactly like lib/timeline and the diagnostics shapes.
//
// Scale-safety / cost: this is O(total ops), a single forward scan. The emitted
// `series` is capped to `MAX_SERIES_POINTS` by even down-sampling (endpoints
// preserved) so a multi-thousand-revision document still renders a bounded,
// lightweight SVG. The length axis (`maxLength`) and the position axis
// (`posDenominator`) are resolved in the same scan so normalization needs no
// second pass over the raw data.

import type { Operation } from "../decoder/types";
import type { DecodedRevision } from "../domain/model";

/** One plotted moment: a timed revision's resulting length + where it edited. */
export interface SummaryPoint {
  /** Revision timestamp (epoch ms). */
  readonly t: number;
  /** Cumulative accepted-character length of the document AFTER this revision. */
  readonly length: number;
  /**
   * Normalized primary edit position in `[0, 1]` (0 = document start, 1 = end),
   * or `-1` when the revision changed no content position (style-only, opaque,
   * or a bulk base-snapshot load) — such points still contribute to `length`.
   */
  readonly pos: number;
}

/** The full, bounded summary signal for one document's revision history. */
export interface DocumentSummary {
  /** True only when the history can be placed on a real time axis (≥2 timed
   *  revisions spanning a non-zero duration). The page shows a friendly empty
   *  state otherwise. */
  readonly available: boolean;
  /** Earliest / latest revision timestamp among timed revisions (epoch ms). */
  readonly startTime: number;
  readonly endTime: number;
  /** Peak document length over the whole history — the length-axis upper bound. */
  readonly maxLength: number;
  /** Final document length (length after the last revision). */
  readonly finalLength: number;
  /** Every revision (timed or not). */
  readonly totalRevisions: number;
  /** Revisions carrying a usable timestamp (the plotted ones). */
  readonly timedRevisions: number;
  /** Total accepted characters inserted / deleted across the whole history. */
  readonly charsInserted: number;
  readonly charsDeleted: number;
  /** Down-sampled, time-sorted plot points (length ≤ `MAX_SERIES_POINTS`). */
  readonly series: readonly SummaryPoint[];
}

/** Render/cost ceiling: the summary never plots more than this many points. */
export const MAX_SERIES_POINTS = 1600;

interface OpScan {
  readonly inserted: number;
  readonly deleted: number;
  /** First content-edit position (1-indexed) in the revision, or null. */
  readonly position: number | null;
}

/** Inserted/deleted character counts for one operation (recurses `mlti`/`rplc`).
 *  Mirrors lib/timeline's delta accounting so the length curve and the timeline
 *  markers agree on what counts as accepted text. */
function operationDelta(op: Operation): { inserted: number; deleted: number } {
  switch (op.ty) {
    case "is":
    case "iss":
      return { inserted: [...op.s].length, deleted: 0 };
    case "ds":
      return { inserted: 0, deleted: op.ei - op.si + 1 };
    case "mlti": {
      let inserted = 0;
      let deleted = 0;
      for (const sub of op.mts) {
        const delta = operationDelta(sub);
        inserted += delta.inserted;
        deleted += delta.deleted;
      }
      return { inserted, deleted };
    }
    case "rplc": {
      let inserted = 0;
      let deleted = 0;
      for (const sub of op.ops) {
        const delta = operationDelta(sub);
        inserted += delta.inserted;
        deleted += delta.deleted;
      }
      return { inserted, deleted };
    }
    default:
      return { inserted: 0, deleted: 0 };
  }
}

/**
 * The 1-indexed document position a single operation edits, or null when it has
 * no meaningful content position. A bulk base-snapshot load (`rplc`) and style /
 * opaque / unknown ops are intentionally null — the scatter is about WHERE a
 * human change landed, not template seeding or formatting passes.
 */
function operationPosition(op: Operation): number | null {
  switch (op.ty) {
    case "is":
    case "iss":
      return op.ibi;
    case "ds":
    case "dss":
    case "msfd":
    case "usfd":
      return op.si;
    case "te":
      return op.spi;
    case "mlti": {
      for (const sub of op.mts) {
        const position = operationPosition(sub);
        if (position !== null) return position;
      }
      return null;
    }
    default:
      return null;
  }
}

/** One revision's net character delta plus its primary edit position. */
function scanRevision(revision: DecodedRevision): OpScan {
  let inserted = 0;
  let deleted = 0;
  let position: number | null = null;
  for (const op of revision.operations) {
    const delta = operationDelta(op);
    inserted += delta.inserted;
    deleted += delta.deleted;
    if (position === null) {
      position = operationPosition(op);
    }
  }
  return { inserted, deleted, position };
}

/** A raw plot point before normalization / down-sampling. */
interface RawPoint {
  readonly t: number;
  readonly length: number;
  readonly position: number | null;
}

/**
 * Even down-sampling that always keeps the first and last point, so the area
 * curve's endpoints (and the document's true span) survive the cap. Returns the
 * input unchanged when it already fits.
 */
function downsample<T>(points: readonly T[], cap: number): T[] {
  if (points.length <= cap) return [...points];
  const out: T[] = [];
  const last = points.length - 1;
  // Map cap evenly across [0, last]; round to nearest index and dedupe so the
  // endpoints are exact and interior strides stay uniform.
  let prev = -1;
  for (let i = 0; i < cap; i++) {
    const index = Math.round((i * last) / (cap - 1));
    if (index !== prev) {
      const point = points[index];
      if (point !== undefined) out.push(point);
      prev = index;
    }
  }
  return out;
}

/**
 * Derive the bounded document-summary signal from decoded revisions. Pure and
 * deterministic: no clocks, no randomness, no DOM.
 */
export function deriveDocumentSummary(revisions: readonly DecodedRevision[]): DocumentSummary {
  let length = 0;
  let maxLength = 0;
  let finalLength = 0;
  let charsInserted = 0;
  let charsDeleted = 0;
  let posDenominator = 1;
  let startTime = Number.POSITIVE_INFINITY;
  let endTime = Number.NEGATIVE_INFINITY;
  let timedRevisions = 0;

  const raw: RawPoint[] = [];

  for (const revision of revisions) {
    const { inserted, deleted, position } = scanRevision(revision);
    charsInserted += inserted;
    charsDeleted += deleted;
    length = Math.max(0, length + inserted - deleted);
    maxLength = Math.max(maxLength, length);
    finalLength = length;
    if (position !== null) {
      posDenominator = Math.max(posDenominator, position);
    }

    const time = revision.time;
    // Guard against absent and out-of-range stamps: Date math beyond ±8.64e15ms
    // is meaningless, and the UI's Intl formatters throw there.
    if (time === null || !Number.isFinite(time) || Math.abs(time) > 8.64e15) {
      continue;
    }
    timedRevisions += 1;
    startTime = Math.min(startTime, time);
    endTime = Math.max(endTime, time);
    raw.push({ t: time, length, position });
  }

  posDenominator = Math.max(posDenominator, maxLength, 1);

  // A real time axis needs ≥2 timed revisions across a non-zero duration.
  const available = timedRevisions >= 2 && endTime > startTime;
  if (!available) {
    return {
      available: false,
      startTime: 0,
      endTime: 0,
      maxLength,
      finalLength,
      totalRevisions: revisions.length,
      timedRevisions,
      charsInserted,
      charsDeleted,
      series: [],
    };
  }

  // Sort onto the time axis (revision order is usually chronological, but a
  // non-monotonic stamp must not zigzag the area path). Stable on equal stamps.
  const sorted = [...raw].sort((a, b) => a.t - b.t);
  const series: SummaryPoint[] = downsample(sorted, MAX_SERIES_POINTS).map((point) => ({
    t: point.t,
    length: point.length,
    pos: point.position === null ? -1 : Math.min(1, Math.max(0, point.position / posDenominator)),
  }));

  return {
    available: true,
    startTime,
    endTime,
    maxLength,
    finalLength,
    totalRevisions: revisions.length,
    timedRevisions,
    charsInserted,
    charsDeleted,
    series,
  };
}
