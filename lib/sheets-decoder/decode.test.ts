// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Decode tests built from the live-capture worked examples
// (.omc/plans/sheets-ritz-format-findings.md, 2026-06-30).
import { describe, expect, test } from "bun:test";
import { asRevisionId } from "../domain/ids";
import { decodeSheetsOperations, decodeSheetsSnapshot } from "./decode";
import type { SheetsCellMutation, SheetsOperation } from "./types";

// Wrap one op array into a live changelog tuple [op, time, userId, revId, sessionId, seq].
function changelog(ops: unknown[]): { changelog: unknown[] } {
  return {
    changelog: ops.map((op, i) => [op, 1000 + i, "user1", i + 1, "sessA", i]),
  };
}

function firstOp(payload: { changelog: unknown[] }): SheetsOperation {
  const op = decodeSheetsOperations(payload)[0]?.operations[0];
  if (op === undefined) throw new Error("no op decoded");
  return op;
}

const A2_NUMBER = [
  21299578,
  [
    null,
    [null, "0", 1, 2, 0, 1],
    [null, 132274236, 3, { "1": 3, "3": 12345.0 }, null, null, 0],
    {},
  ],
];
const A4_FORMULA = [
  21299578,
  [null, [null, "0", 3, 4, 0, 1], [null, 132274236, 3, [null, 2, "=SUM(A2:A3)"]], {}],
];
const B2_CURRENCY = [
  21299578,
  [
    null,
    [null, "0", 1, 2, 1, 2],
    { "1": 32, "2": 2, "6": 0 },
    { "2": [{ "2": 1, "3": [null, 4, "[$kr-406] #,##0.00"] }] },
  ],
];
const G2_BOLD = [
  21299578,
  [null, [null, "0", 1, 2, 6, 7], { "2": 2, "6": 0 }, { "2": [{ "2": 16384, "17": 1 }] }],
];

describe("decodeSheetsOperations — cell mutations", () => {
  test("decodes a numeric cell value with its half-open range", () => {
    const op = firstOp(changelog([A2_NUMBER])) as SheetsCellMutation;
    expect(op.op).toBe("cell");
    expect(op.range).toEqual({ gid: "0" as never, rowStart: 1, rowEnd: 2, colStart: 0, colEnd: 1 });
    expect(op.content).toEqual({ kind: "number", value: 12345 });
  });

  test("decodes a formula as text (no evaluation)", () => {
    const op = firstOp(changelog([A4_FORMULA])) as SheetsCellMutation;
    expect(op.content).toEqual({ kind: "formula", formula: "=SUM(A2:A3)" });
  });

  test("decodes a currency number-format pattern from the format block", () => {
    const op = firstOp(changelog([B2_CURRENCY])) as SheetsCellMutation;
    expect(op.content).toEqual({ kind: "none" });
    expect(op.format.numberFormat).toBe("[$kr-406] #,##0.00");
  });

  test("decodes a bold visual-style mask", () => {
    const op = firstOp(changelog([G2_BOLD])) as SheetsCellMutation;
    expect(op.format.bold).toBe(true);
    expect(op.content).toEqual({ kind: "none" });
  });

  test("decodes a plain text value (non-formula string)", () => {
    const op = firstOp(
      changelog([
        [21299578, [null, [null, "0", 0, 1, 0, 1], [null, 132274236, 3, [null, 2, "hi"]], {}]],
      ]),
    ) as SheetsCellMutation;
    expect(op.content).toEqual({ kind: "text", text: "hi" });
  });
});

describe("decodeSheetsOperations — clear (transaction wrapper)", () => {
  test("decodes a clear-cell transaction into clear-value + clear-format", () => {
    const range = [null, "0", 1, 2, 0, 1];
    const clear = [
      4444216,
      [
        [21299578, [null, range, { "1": 2 }, []]],
        [21299578, [null, range, { "1": 132274237 }, []]],
      ],
    ];
    const op = firstOp(changelog([clear]));
    expect(op.op).toBe("txn");
    if (op.op !== "txn") throw new Error("expected txn");
    const [clearValue, clearFormat] = op.ops as SheetsCellMutation[];
    expect(clearValue?.content).toEqual({ kind: "clear" });
    expect(clearFormat?.format.clearFormat).toBe(true);
  });
});

describe("decodeSheetsOperations — structure ops", () => {
  test("decodes add-sheet with gid, index and name", () => {
    const op = firstOp(
      changelog([[21350203, [null, 1, 0, "849076485", { "1": [[null, 0, 0, "Ark2"]] }]]]),
    );
    expect(op).toEqual({ op: "add-sheet", gid: "849076485" as never, index: 1, name: "Ark2" });
  });

  test("decodes rename-sheet", () => {
    const op = firstOp(changelog([[26812461, [null, "0", { "1": [[null, 0, 0, "RENAMEDZZ"]] }]]]));
    expect(op).toEqual({ op: "rename-sheet", gid: "0" as never, name: "RENAMEDZZ" });
  });

  test("decodes insert rows and insert cols", () => {
    expect(firstOp(changelog([[24502104, [null, "0", 0, 1, 0, 0]]]))).toEqual({
      op: "insert-dim",
      gid: "0" as never,
      index: 0,
      count: 1,
      dim: "row",
    });
    expect(firstOp(changelog([[24502104, [null, "0", 7, 2, 1, 0]]]))).toEqual({
      op: "insert-dim",
      gid: "0" as never,
      index: 7,
      count: 2,
      dim: "col",
    });
  });

  test("decodes delete rows and delete cols", () => {
    expect(firstOp(changelog([[25037233, [null, "0", 4, 1, 0]]]))).toEqual({
      op: "delete-dim",
      gid: "0" as never,
      index: 4,
      count: 1,
      dim: "row",
    });
    expect(firstOp(changelog([[25037233, [null, "0", 1, 2, 1]]]))).toEqual({
      op: "delete-dim",
      gid: "0" as never,
      index: 1,
      count: 2,
      dim: "col",
    });
  });

  test("recognizes inert style-adjust / settings / marker opcodes", () => {
    expect(firstOp(changelog([[25813757, [null, "0"]]])).op).toBe("cell-style-adjust");
    expect(firstOp(changelog([[28950036, [null]]])).op).toBe("settings");
    expect(firstOp(changelog([[25104121, []]])).op).toBe("marker");
    expect(firstOp(changelog([[149980211, []]])).op).toBe("marker");
  });
});

describe("decodeSheetsOperations — open-world degradation", () => {
  test("unrecognized opcode degrades to SheetsUnknownOp (never throws)", () => {
    const op = firstOp(changelog([[99999999, [null, "x"]]]));
    expect(op.op).toBe("unknown");
    if (op.op !== "unknown") throw new Error("expected unknown");
    expect(op.opCode).toBe("99999999");
    expect(op.byteLength).toBeGreaterThan(0);
  });

  test("malformed known op (bad range) degrades to unknown", () => {
    const op = firstOp(changelog([[21299578, [null, "not-a-range", {}, {}]]]));
    expect(op.op).toBe("unknown");
  });

  test("a non-array entry op degrades to unknown without throwing", () => {
    const op = firstOp({ changelog: [["not-an-op", 1, "u", 1, "s", 0]] });
    expect(op.op).toBe("unknown");
  });
});

describe("decodeSheetsOperations — metadata + modelVersion", () => {
  test("lifts attribution metadata from the tuple positions", () => {
    const decoded = decodeSheetsOperations(changelog([A2_NUMBER]))[0];
    expect(decoded?.revisionId).toBe(asRevisionId(1));
    expect(decoded?.userId).toBe("user1" as never);
    expect(decoded?.sessionId).toBe("sessA" as never);
    expect(decoded?.time).toBe(1000);
  });

  test("defaults modelVersion to the baseline with no mismatch", () => {
    const decoded = decodeSheetsOperations(changelog([A2_NUMBER]))[0];
    expect(decoded?.modelVersion).toBe(99);
    expect(decoded?.modelVersionMismatch).toBe(false);
  });

  test("flags a modelVersion mismatch (R9) when the envelope differs", () => {
    const decoded = decodeSheetsOperations({
      modelVersion: 100,
      changelog: [[A2_NUMBER, 1, "u", 1, "s", 0]],
    })[0];
    expect(decoded?.modelVersion).toBe(100);
    expect(decoded?.modelVersionMismatch).toBe(true);
  });
});

describe("decodeSheetsSnapshot — base seed (P-iii)", () => {
  test("decodes chunked base ops; empty/absent yields []", () => {
    expect(decodeSheetsSnapshot({ changelog: [] })).toEqual([]);
    const seeded = decodeSheetsSnapshot({ chunkedSnapshot: [[A2_NUMBER]], changelog: [] });
    expect(seeded[0]?.op).toBe("cell");
  });

  test("decodes a flat (non-chunked) snapshot op list", () => {
    const seeded = decodeSheetsSnapshot({ chunkedSnapshot: [A2_NUMBER], changelog: [] });
    expect(seeded[0]?.op).toBe("cell");
  });
});
