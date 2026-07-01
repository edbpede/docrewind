// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeSheetsOperations } from "@/lib/core/sheets/decoder/decode";
import {
  deriveSheetsSummary,
  deriveSheetsTimeline,
  sheetsSummaryExtractor,
  sheetsTimelineExtractor,
} from "./derive";

function setNum(row: number, col: number, value: number): unknown {
  return [
    21299578,
    [
      null,
      [null, "0", row, row + 1, col, col + 1],
      [null, 132274236, 3, { "1": 3, "3": value }, null, null, 0],
      {},
    ],
  ];
}

function revs(ops: unknown[], times: number[] = []) {
  return decodeSheetsOperations({
    changelog: ops.map((op, i) => [op, times[i] ?? 1000 + i * 1000, "u", i + 1, "s", i]),
  });
}

describe("sheets derive — extractors", () => {
  test("counts a single cell set as one inserted cell", () => {
    const r = revs([setNum(0, 0, 1)])[0];
    if (r === undefined) throw new Error("no revision");
    expect(sheetsSummaryExtractor.delta(r)).toEqual({ inserted: 1, deleted: 0 });
    expect(sheetsSummaryExtractor.position(r)).toBe(1);
    expect(sheetsTimelineExtractor.delta(r)).toEqual({ inserted: 1, deleted: 0 });
  });

  test("counts a clear as a deleted cell and a format-only op as zero", () => {
    const clear = [21299578, [null, [null, "0", 2, 3, 0, 1], { "1": 2 }, []]];
    const r = revs([clear])[0];
    if (r === undefined) throw new Error("no revision");
    expect(sheetsSummaryExtractor.delta(r)).toEqual({ inserted: 0, deleted: 1 });
    expect(sheetsSummaryExtractor.position(r)).toBe(3); // rowStart 2 → row 3
    const fmt = [
      21299578,
      [null, [null, "0", 0, 1, 0, 1], { "2": 2 }, { "2": [{ "2": 16384, "17": 1 }] }],
    ];
    const f = revs([fmt])[0];
    if (f === undefined) throw new Error("no revision");
    expect(sheetsSummaryExtractor.delta(f)).toEqual({ inserted: 0, deleted: 0 });
    expect(sheetsSummaryExtractor.position(f)).toBeNull(); // format-only → no edit position
  });

  test("a structural / unknown op contributes no delta and a null position", () => {
    const r = revs([[24502104, [null, "0", 0, 1, 0, 0]]])[0];
    if (r === undefined) throw new Error("no revision");
    expect(sheetsTimelineExtractor.delta(r)).toEqual({ inserted: 0, deleted: 0 });
    expect(sheetsSummaryExtractor.position(r)).toBeNull();
  });
});

describe("sheets derive — summary + timeline", () => {
  test("summary places the cells-edited series on the time axis", () => {
    const summary = deriveSheetsSummary(revs([setNum(0, 0, 1), setNum(1, 0, 2)], [1000, 2000]));
    expect(summary.available).toBe(true);
    expect(summary.charsInserted).toBe(2);
    expect(summary.finalLength).toBe(2);
  });

  test("timeline flags a large cell edit over the threshold", () => {
    const txn = [4444216, Array.from({ length: 60 }, (_v, i) => setNum(i, 0, i))];
    const events = deriveSheetsTimeline(revs([txn]));
    expect(events.some((e) => e.kind === "large-insertion")).toBe(true);
  });
});
