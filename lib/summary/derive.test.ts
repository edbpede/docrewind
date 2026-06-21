// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "bun:test";
import type { Operation } from "../decoder/types";
import { asRevisionId } from "../domain/ids";
import type { DecodedRevision } from "../domain/model";
import { deriveDocumentSummary, MAX_SERIES_POINTS } from "./derive";

let nextId = 1;

function rev(time: number | null, operations: readonly Operation[] = []): DecodedRevision {
  return {
    revisionId: asRevisionId(nextId++),
    userId: null,
    sessionId: null,
    time,
    operations,
  };
}

function insert(text: string, ibi: number): Operation {
  return { ty: "is", s: text, ibi };
}

function del(si: number, ei: number): Operation {
  return { ty: "ds", si, ei };
}

describe("deriveDocumentSummary", () => {
  it("returns an unavailable summary for no revisions", () => {
    const summary = deriveDocumentSummary([]);
    expect(summary.available).toBe(false);
    expect(summary.series).toEqual([]);
    expect(summary.totalRevisions).toBe(0);
    expect(summary.timedRevisions).toBe(0);
  });

  it("is unavailable when fewer than two revisions are timed", () => {
    const summary = deriveDocumentSummary([
      rev(1_000, [insert("hello", 1)]),
      rev(null, [insert("x", 6)]),
    ]);
    expect(summary.available).toBe(false);
    // Counts still accumulate over every revision, timed or not.
    expect(summary.totalRevisions).toBe(2);
    expect(summary.timedRevisions).toBe(1);
    expect(summary.charsInserted).toBe(6);
  });

  it("is unavailable when all timestamps collapse to one instant", () => {
    const summary = deriveDocumentSummary([
      rev(5_000, [insert("ab", 1)]),
      rev(5_000, [insert("cd", 3)]),
    ]);
    expect(summary.available).toBe(false);
  });

  it("accumulates document length over time and tracks the peak", () => {
    const summary = deriveDocumentSummary([
      rev(1_000, [insert("hello", 1)]), // len 5
      rev(2_000, [insert(" world", 6)]), // len 11
      rev(3_000, [del(1, 5)]), // len 6
    ]);
    expect(summary.available).toBe(true);
    expect(summary.charsInserted).toBe(11);
    expect(summary.charsDeleted).toBe(5);
    expect(summary.maxLength).toBe(11);
    expect(summary.finalLength).toBe(6);
    expect(summary.series.map((p) => p.length)).toEqual([5, 11, 6]);
    expect(summary.startTime).toBe(1_000);
    expect(summary.endTime).toBe(3_000);
  });

  it("clamps cumulative length at zero when deletions exceed inserts", () => {
    const summary = deriveDocumentSummary([
      rev(1_000, [insert("ab", 1)]),
      rev(2_000, [del(1, 10)]),
    ]);
    expect(summary.series.map((p) => p.length)).toEqual([2, 0]);
    expect(summary.finalLength).toBe(0);
  });

  it("normalizes edit positions into [0,1] against the largest position seen", () => {
    const summary = deriveDocumentSummary([
      rev(1_000, [insert("a", 1)]),
      rev(2_000, [insert("b", 2)]),
      rev(3_000, [insert("c", 100)]),
    ]);
    const positions = summary.series.map((p) => p.pos);
    expect(positions[0]).toBeCloseTo(1 / 100, 5);
    expect(positions[1]).toBeCloseTo(2 / 100, 5);
    expect(positions[2]).toBeCloseTo(1, 5);
    expect(positions.every((p) => p >= 0 && p <= 1)).toBe(true);
  });

  it("marks position-free revisions with pos -1 but keeps their length point", () => {
    const styleOp: Operation = {
      ty: "as",
      scope: "text",
      si: 1,
      ei: 3,
      suggested: false,
    };
    const summary = deriveDocumentSummary([rev(1_000, [insert("abc", 1)]), rev(2_000, [styleOp])]);
    expect(summary.series).toHaveLength(2);
    expect(summary.series[1]?.pos).toBe(-1);
    expect(summary.series[1]?.length).toBe(3); // style op leaves length unchanged
  });

  it("recurses into mlti for both delta and the first edit position", () => {
    const compound: Operation = {
      ty: "mlti",
      mts: [insert("xy", 5), del(1, 2)],
    };
    const summary = deriveDocumentSummary([
      rev(1_000, [insert("abcd", 1)]), // len 4
      rev(2_000, [compound]), // +2 -2 => len 4, position from first sub-op (ibi 5)
    ]);
    expect(summary.series[1]?.length).toBe(4);
    // posDenominator is max position (5); first sub-op position is 5 -> 1.0
    expect(summary.series[1]?.pos).toBeCloseTo(1, 5);
  });

  it("sorts plotted points onto the time axis even when stamps are out of order", () => {
    const summary = deriveDocumentSummary([
      rev(3_000, [insert("c", 1)]),
      rev(1_000, [insert("a", 1)]),
      rev(2_000, [insert("b", 1)]),
    ]);
    expect(summary.series.map((p) => p.t)).toEqual([1_000, 2_000, 3_000]);
    // The cumulative length must accumulate in chronological order, so each
    // plotted length is paired with the moment it actually held — not the order
    // the revisions happened to arrive in.
    expect(summary.series.map((p) => p.length)).toEqual([1, 2, 3]);
  });

  it("pairs cumulative length with the right moment when deltas vary and stamps are out of order", () => {
    // Arrival order ≠ timestamp order, with differing per-revision deltas, so an
    // arrival-order accumulator would mis-pair lengths against timestamps.
    const summary = deriveDocumentSummary([
      rev(3_000, [insert("xyz", 1)]), // arrives first, but is chronologically last
      rev(1_000, [insert("a", 1)]), // chronologically first
      rev(2_000, [insert("bb", 1)]), // chronologically middle
    ]);
    expect(summary.series.map((p) => p.t)).toEqual([1_000, 2_000, 3_000]);
    // Chronological cumulative: 1 → 1+2=3 → 3+3=6.
    expect(summary.series.map((p) => p.length)).toEqual([1, 3, 6]);
    // finalLength is the length at the latest timestamp (the series endpoint).
    expect(summary.finalLength).toBe(6);
    expect(summary.series[summary.series.length - 1]?.length).toBe(6);
    expect(summary.maxLength).toBe(6);
  });

  it("ignores out-of-range timestamps", () => {
    const summary = deriveDocumentSummary([
      rev(1_000, [insert("a", 1)]),
      rev(9e15, [insert("b", 2)]), // beyond ±8.64e15? 9e15 > 8.64e15 -> dropped
      rev(2_000, [insert("c", 3)]),
    ]);
    expect(summary.timedRevisions).toBe(2);
    expect(summary.series.map((p) => p.t)).toEqual([1_000, 2_000]);
  });

  it("caps and down-samples a large history while preserving endpoints", () => {
    const revisions: DecodedRevision[] = [];
    const count = MAX_SERIES_POINTS * 3;
    for (let i = 0; i < count; i++) {
      revisions.push(rev(1_000 + i, [insert("z", i + 1)]));
    }
    const summary = deriveDocumentSummary(revisions);
    expect(summary.available).toBe(true);
    expect(summary.totalRevisions).toBe(count);
    expect(summary.timedRevisions).toBe(count);
    expect(summary.series.length).toBeLessThanOrEqual(MAX_SERIES_POINTS);
    // Endpoints are exact: first and last plotted points are the true bounds.
    expect(summary.series[0]?.t).toBe(1_000);
    expect(summary.series[summary.series.length - 1]?.t).toBe(1_000 + count - 1);
  });
});
