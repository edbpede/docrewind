// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for the Slides summary/timeline extractors: char-edit accounting over
// insert/delete/txn ops, edit-position proxy, and the shared summary/timeline cores
// bound to the Slides extractor.

import { describe, expect, test } from "bun:test";
import { unsafeAsRevisionId, unsafeAsSessionId, unsafeAsUserId } from "../domain/ids";
import type { SlidesDecodedRevision, SlidesOperation } from "../slides-decoder/types";
import { deriveSlidesSummary, deriveSlidesTimeline, slidesSummaryExtractor } from "./derive";

function rev(op: SlidesOperation, id: number, time: number | null): SlidesDecodedRevision {
  return {
    revisionId: unsafeAsRevisionId(id),
    userId: unsafeAsUserId("u"),
    sessionId: unsafeAsSessionId("s"),
    time,
    operations: [op],
    modelVersion: 0,
    modelVersionMismatch: false,
  };
}

describe("slidesSummaryExtractor", () => {
  test("counts inserted characters (code points)", () => {
    const r = rev({ op: "insert-text", shapeId: "i0" as never, offset: 2, text: "hello" }, 1, 1);
    expect(slidesSummaryExtractor.delta(r)).toEqual({ inserted: 5, deleted: 0 });
    expect(slidesSummaryExtractor.position(r)).toBe(3); // offset + 1
  });

  test("counts deleted characters and reports the delete start", () => {
    const r = rev({ op: "delete-text", shapeId: "i0" as never, start: 4, end: 9 }, 1, 1);
    expect(slidesSummaryExtractor.delta(r)).toEqual({ inserted: 0, deleted: 5 });
    expect(slidesSummaryExtractor.position(r)).toBe(5);
  });

  test("recurses into txns and returns the first content position", () => {
    const r = rev(
      {
        op: "txn",
        ops: [
          { op: "marker" },
          { op: "insert-text", shapeId: "a" as never, offset: 0, text: "ab" },
          { op: "delete-text", shapeId: "a" as never, start: 0, end: 1 },
        ],
      },
      1,
      1,
    );
    expect(slidesSummaryExtractor.delta(r)).toEqual({ inserted: 2, deleted: 1 });
    expect(slidesSummaryExtractor.position(r)).toBe(1);
  });

  test("non-text ops contribute nothing and have no position", () => {
    const r = rev({ op: "marker" }, 1, 1);
    expect(slidesSummaryExtractor.delta(r)).toEqual({ inserted: 0, deleted: 0 });
    expect(slidesSummaryExtractor.position(r)).toBeNull();
  });
});

describe("derive entry points", () => {
  test("deriveSlidesSummary produces an available series over timed revisions", () => {
    const revisions = [
      rev({ op: "insert-text", shapeId: "a" as never, offset: 0, text: "hello" }, 1, 1000),
      rev({ op: "insert-text", shapeId: "a" as never, offset: 5, text: " world" }, 2, 2000),
    ];
    const summary = deriveSlidesSummary(revisions);
    expect(summary.available).toBe(true);
    expect(summary.charsInserted).toBe(11);
    expect(summary.finalLength).toBe(11);
  });

  test("deriveSlidesTimeline flags a large insertion", () => {
    const big = "x".repeat(60);
    const events = deriveSlidesTimeline([
      rev({ op: "insert-text", shapeId: "a" as never, offset: 0, text: big }, 1, 1000),
    ]);
    expect(events.some((e) => e.kind === "large-insertion")).toBe(true);
  });
});
