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
// Kind-agnostic core (plan §1 Chosen-option): the TIME-axis machinery reads only
// `RevisionMeta.time`, and the op-accounting (length delta + edit position) is an
// INJECTED `SummaryExtractor`. Docs binds `docsSummaryExtractor`
// (`operationDelta`/`operationPosition`, switching on the Docs `Operation.ty`
// union); Sheets binds its own cell-edit extractor. `deriveDocumentSummary`
// stays the Docs-bound public entry so the existing tests pin byte-identical
// Docs output.
//
// Scale-safety / cost: this is O(total ops), a single forward scan. The emitted
// `series` is capped to `MAX_SERIES_POINTS` by even down-sampling (endpoints
// preserved) so a multi-thousand-revision document still renders a bounded,
// lightweight SVG. The length axis (`maxLength`) and the position axis
// (`posDenominator`) are resolved in the same scan so normalization needs no
// second pass over the raw data.

import type { Operation } from "../decoder/types";
import type { DecodedRevision } from "../domain/model";
import type { RevisionMeta } from "../replay-core/meta";

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
  /** Peak document length across the WHOLE history (timed and untimed
   *  revisions) — the length-axis upper bound. Untimed size-changing revisions
   *  (e.g. a base-snapshot load) count here even though they are not plotted, so
   *  the axis and the headline character counts stay consistent. */
  readonly maxLength: number;
  /** Document length after the WHOLE history (timed and untimed revisions, in
   *  arrival order). When every revision is timed this equals the plotted
   *  series' right endpoint; when untimed size-changing revisions exist it
   *  reflects the true final document size and may exceed that endpoint. */
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

/**
 * Kind-specific op-accounting injected into the summary core. `delta` is the
 * revision's net inserted/deleted unit count (characters for Docs, cells for
 * Sheets); `position` is the 1-indexed primary edit position, or null when the
 * revision has no meaningful content position.
 */
export interface SummaryExtractor<R> {
  delta(revision: R): { inserted: number; deleted: number };
  position(revision: R): number | null;
}

/** Render/cost ceiling: the summary never plots more than this many points. */
export const MAX_SERIES_POINTS = 1600;

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

/**
 * The Docs op-accounting extractor: net character delta (summed over the
 * revision's ops) plus the first content-edit position. This is the existing
 * behaviour, lifted verbatim into an extractor so the Docs summary output is
 * unchanged.
 */
export const docsSummaryExtractor: SummaryExtractor<DecodedRevision> = {
  delta(revision) {
    let inserted = 0;
    let deleted = 0;
    for (const op of revision.operations) {
      const d = operationDelta(op);
      inserted += d.inserted;
      deleted += d.deleted;
    }
    return { inserted, deleted };
  },
  position(revision) {
    for (const op of revision.operations) {
      const position = operationPosition(op);
      if (position !== null) return position;
    }
    return null;
  },
};

/** A raw plot point before chronological accumulation / normalization /
 *  down-sampling. `delta` is this revision's net character change (inserted −
 *  deleted, pre-clamp); cumulative length is summed in timestamp order below so
 *  the area curve never mis-pairs a length with the wrong moment. */
interface RawPoint {
  readonly t: number;
  readonly delta: number;
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
 * Derive the bounded document-summary signal from decoded revisions, generic
 * over the revision kind: the time axis reads `RevisionMeta.time`, and the
 * length/position accounting is supplied by the injected `extractor`. Pure and
 * deterministic: no clocks, no randomness, no DOM.
 */
export function deriveSummaryWith<R extends RevisionMeta>(
  revisions: readonly R[],
  extractor: SummaryExtractor<R>,
): DocumentSummary {
  let charsInserted = 0;
  let charsDeleted = 0;
  let posDenominator = 1;
  let startTime = Number.POSITIVE_INFINITY;
  let endTime = Number.NEGATIVE_INFINITY;
  let timedRevisions = 0;

  // Whole-history document size, accumulated in arrival order over EVERY revision
  // (timed or not). The length-axis bound (`maxLength`) and the final-size stat
  // must reflect untimed size-changing revisions too — e.g. a base-snapshot load
  // with a null stamp — or the axis would mis-scale against the headline counts.
  let wholeLength = 0;
  let maxLength = 0;

  const raw: RawPoint[] = [];

  // First pass: order-independent aggregates + per-revision deltas. The plotted
  // cumulative length is summed later, in timestamp order, so each plotted length
  // is paired with the moment it actually held (revision arrival order is usually
  // chronological, but a non-monotonic stamp must not mis-pair lengths).
  for (const revision of revisions) {
    const { inserted, deleted } = extractor.delta(revision);
    const position = extractor.position(revision);
    charsInserted += inserted;
    charsDeleted += deleted;
    if (position !== null) {
      posDenominator = Math.max(posDenominator, position);
    }

    wholeLength = Math.max(0, wholeLength + (inserted - deleted));
    maxLength = Math.max(maxLength, wholeLength);

    const time = revision.time;
    // Guard against absent and out-of-range stamps: Date math beyond ±8.64e15ms
    // is meaningless, and the UI's Intl formatters throw there.
    if (time === null || !Number.isFinite(time) || Math.abs(time) > 8.64e15) {
      continue;
    }
    timedRevisions += 1;
    startTime = Math.min(startTime, time);
    endTime = Math.max(endTime, time);
    raw.push({ t: time, delta: inserted - deleted, position });
  }
  // Final document length after the whole history (arrival order). Equals the
  // plotted series' right endpoint when every revision is timed.
  const finalLength = wholeLength;

  // Sort onto the time axis, then accumulate the plotted cumulative length
  // chronologically. Stable on equal stamps, so same-instant revisions keep
  // arrival order.
  const sorted = [...raw].sort((a, b) => a.t - b.t);
  let plottedLength = 0;
  const plotted: { t: number; length: number; position: number | null }[] = [];
  for (const point of sorted) {
    plottedLength = Math.max(0, plottedLength + point.delta);
    plotted.push({ t: point.t, length: plottedLength, position: point.position });
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

  const series: SummaryPoint[] = downsample(plotted, MAX_SERIES_POINTS).map((point) => ({
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

/**
 * Derive the bounded document-summary signal for a Docs document. Thin
 * Docs-bound wrapper over {@link deriveSummaryWith} binding the Docs
 * op-accounting extractor — its output is unchanged (pinned by the summary
 * tests).
 */
export function deriveDocumentSummary(revisions: readonly DecodedRevision[]): DocumentSummary {
  return deriveSummaryWith(revisions, docsSummaryExtractor);
}
