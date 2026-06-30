// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeSheetsOperations } from "../sheets-decoder/decode";
import { applySheetsOperation, applySheetsRevision } from "./apply";
import { createModel, type GridModel } from "./model";
import { buildSheetsReplayIndex, gridAtRevisionIndex, SHEETS_SNAPSHOT_CADENCE } from "./snapshot";

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

const OPS: unknown[] = [
  setNum(0, 0, 1),
  setNum(1, 0, 2),
  setNum(2, 0, 3),
  [24502104, [null, "0", 1, 1, 0, 0]], // insert a row at index 1
  setNum(1, 0, 99),
  [25037233, [null, "0", 0, 1, 0]], // delete row 0
];

const REVS = decodeSheetsOperations({
  changelog: OPS.map((op, i) => [op, 1000 + i, "u", i + 1, "s", i]),
});

/** Content-stable serialization of every sheet's cells, for equivalence checks. */
function serialize(model: GridModel): string {
  const parts: string[] = [];
  for (const gid of model.order) {
    const sheet = model.sheets.get(gid);
    if (sheet === undefined) continue;
    const cells = [...sheet.cells.entries()]
      .map(([key, c]) => `${key}=${c.formula ?? c.value}`)
      .sort();
    parts.push(`${gid}[${sheet.name}]:${cells.join(",")}`);
  }
  return parts.join("|");
}

function linearAfter(n: number): string {
  const model = createModel();
  for (let i = 0; i < n; i++) {
    const revision = REVS[i];
    if (revision !== undefined) applySheetsRevision(model, revision);
  }
  return serialize(model);
}

describe("sheets snapshot — scrub equivalence (R8, shared spine)", () => {
  test("snapshot-assisted grid equals linear replay at every revision", () => {
    const index = buildSheetsReplayIndex(REVS, 2); // force multiple snapshots
    for (let n = 0; n <= REVS.length; n++) {
      expect(serialize(gridAtRevisionIndex(index, n))).toBe(linearAfter(n));
    }
  });

  test("the default cadence builds a usable end-of-history grid", () => {
    expect(SHEETS_SNAPSHOT_CADENCE).toBeGreaterThan(0);
    const index = buildSheetsReplayIndex(REVS);
    expect(serialize(gridAtRevisionIndex(index, REVS.length))).toBe(linearAfter(REVS.length));
  });

  test("base seed (chunkedSnapshot) is present at snapshot(0)", () => {
    const baseOps = decodeSheetsOperations({ changelog: [[setNum(5, 5, 500), 1, "u", 1, "s", 0]] });
    // Re-apply the decoded base op under the pre-history id via the same engine.
    const seedModel = createModel();
    for (const r of baseOps) {
      for (const op of r.operations) applySheetsOperation(seedModel, op, r.revisionId);
    }
    const index = buildSheetsReplayIndex(
      REVS,
      2,
      baseOps.flatMap((r) => r.operations),
    );
    expect(serialize(gridAtRevisionIndex(index, 0))).toBe(serialize(seedModel));
  });
});
