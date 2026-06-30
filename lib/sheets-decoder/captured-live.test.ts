// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end census proof against a REAL 26-revision Sheets capture (plan Phase 5
// acceptance #2; ground truth .omc/plans/sheets-ritz-format-findings.md). Runs the
// content-free sanitized capture (lib/fixtures/sheets-captured.ts) through the SAME
// production pipeline the worker uses (parseFramed → detectSchema →
// decodeSheetsOperations → buildSheetsReplayIndex) and asserts the five newly
// confirmed op families (merge / opaque / chart-datasource / cond-format /
// reorder-sheet) decode with ZERO `unknown` ops — the census the handoff promised
// (down from 5 unknowns). This is the Sheets counterpart to the Docs
// captured-live.test.ts.

import { describe, expect, test } from "bun:test";
import { SHEETS_CAPTURED_HISTORY } from "../fixtures/sheets-captured";
import { gridAtRevisionIndex } from "../sheets-reconstruction/snapshot";
import { runSheetsPipelineOverBodies } from "../worker/pipeline";
import { decodeSheetsOperations } from "./decode";
import { asGid, type SheetsOperation } from "./types";

const ENVELOPE = SHEETS_CAPTURED_HISTORY.envelope;

/** Flatten every op (recursing through txn wrappers) into one list. */
function flatten(ops: readonly SheetsOperation[]): SheetsOperation[] {
  const out: SheetsOperation[] = [];
  for (const op of ops) {
    if (op.op === "txn") {
      out.push(...flatten(op.ops));
    } else {
      out.push(op);
    }
  }
  return out;
}

/** A `kind → count` census over every decoded op in the capture. */
function census(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const revision of decodeSheetsOperations(ENVELOPE)) {
    for (const op of flatten(revision.operations)) {
      counts.set(op.op, (counts.get(op.op) ?? 0) + 1);
    }
  }
  return counts;
}

describe("captured live Sheets history — Phase 5 census (26 revisions)", () => {
  test("the pipeline reconstructs the capture to `ok` (never unsupported)", () => {
    const result = runSheetsPipelineOverBodies([ENVELOPE]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.revisions).toHaveLength(26);
  });

  test("all five new op families are present with ZERO unknown ops", () => {
    const counts = census();
    expect(counts.get("unknown") ?? 0).toBe(0);
    expect(counts.get("merge")).toBeGreaterThan(0);
    expect(counts.get("opaque")).toBeGreaterThan(0);
    expect(counts.get("chart-datasource")).toBeGreaterThan(0);
    expect(counts.get("cond-format")).toBeGreaterThan(0);
    expect(counts.get("reorder-sheet")).toBeGreaterThan(0);
  });

  test("worked example — the merge decodes to its captured A1:B1 range", () => {
    const merge = flatten(decodeSheetsOperations(ENVELOPE).flatMap((r) => [...r.operations])).find(
      (op) => op.op === "merge",
    );
    if (merge?.op !== "merge") throw new Error("no merge decoded");
    expect(merge.range).toMatchObject({ rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 2 });
  });

  test("worked example — a chart object AND an image object decode by spec shape", () => {
    const opaques = flatten(
      decodeSheetsOperations(ENVELOPE).flatMap((r) => [...r.operations]),
    ).filter((op) => op.op === "opaque");
    const kinds = opaques.map((op) => (op.op === "opaque" ? op.kind : null));
    expect(kinds).toContain("chart");
    expect(kinds).toContain("image");
  });

  test("worked example — the reorder moves the sheet gid to the back of the order", () => {
    const result = runSheetsPipelineOverBodies([ENVELOPE]);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    const grid = gridAtRevisionIndex(result.replayIndex, result.revisions.length);
    // Sheets added in order [ "0", "849076485" ]; the reorder [from 0, to 2] moves
    // gid "0" to the back, so the final order is [ "849076485", "0" ].
    expect(grid.order).toEqual([asGid("849076485"), asGid("0")]);
  });
});
