// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Decode tests built from the live-capture worked examples
// (.omc/plans/sheets-ritz-format-findings.md, 2026-06-30).
import { describe, expect, test } from "bun:test";
import { asRevisionId } from "../domain/ids";
import { decodeSheetsOperations, decodeSheetsSnapshot } from "./decode";
import type {
  SheetsCellMutation,
  SheetsMerge,
  SheetsOpaque,
  SheetsOperation,
  SheetsReorderSheet,
} from "./types";

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

// The real captured op arrays for the five Phase-5 families (content-free shapes
// from .omc/captures/op-{merge,chart,image,condfmt,reorder}.txt, 2026-06-30).
const MERGE_A1_B1 = [27911206, { "1": [null, "0", 0, 1, 0, 2] }];
const CHART_OBJECT = [
  27809640,
  {
    "1": [
      null,
      "974979131",
      {
        "1": 3,
        "3": [null, null, ["1430258216"], 0, -1, 0, null, null, 0, null, { "3": 5, "4": [] }],
      },
      [null, 0, "0", [null, 1, 0], 57, 33, 600, 371, 1.0],
      null,
      "Diagram",
    ],
  },
];
const IMAGE_OBJECT = [
  27809640,
  {
    "1": [
      null,
      "501988802",
      [null, 2, [null, 2, "s-blob-v1-IMAGE-41ePOTpd_xM", null, 2048, 2048]],
      [null, 0, "0", [null, 14, 5], 16, 16, 402, 402, 2.0],
      null,
      "Billede",
    ],
  },
];
const CHART_DATASOURCE = [
  34070425,
  [null, "1430258216", [null, "0", 2, 3, 0, 2], 3, { "2": 1, "3": "974979131" }],
];
const COND_FORMAT = [
  45416218,
  [null, "0", 0, [null, [[null, "0", 2, 5, 0, 1]], [null, [null, { "1": 26 }]]]],
];
const REORDER = [31997291, [null, 0, 2]];

describe("decodeSheetsOperations — Phase-5 op families (live capture)", () => {
  test("decodes a merge range from args['1'] (the half-open block)", () => {
    const op = firstOp(changelog([MERGE_A1_B1])) as SheetsMerge;
    expect(op.op).toBe("merge");
    expect(op.range).toEqual({
      gid: "0" as never,
      rowStart: 0,
      rowEnd: 1,
      colStart: 0,
      colEnd: 2,
    });
  });

  test("discriminates a chart object by its record spec shape (spec['1']===3)", () => {
    const op = firstOp(changelog([CHART_OBJECT])) as SheetsOpaque;
    expect(op.op).toBe("opaque");
    expect(op).toEqual({ op: "opaque", kind: "chart", gid: "0" as never, row: 1, col: 0 });
  });

  test("discriminates an image object by its array spec shape (spec[1]===2)", () => {
    const op = firstOp(changelog([IMAGE_OBJECT])) as SheetsOpaque;
    expect(op).toEqual({ op: "opaque", kind: "image", gid: "0" as never, row: 14, col: 5 });
  });

  test("recognizes the chart data-source companion as its own inert variant", () => {
    expect(firstOp(changelog([CHART_DATASOURCE])).op).toBe("chart-datasource");
  });

  test("recognizes conditional formatting", () => {
    expect(firstOp(changelog([COND_FORMAT])).op).toBe("cond-format");
  });

  test("decodes a sheet reorder as [from, to]", () => {
    const op = firstOp(changelog([REORDER])) as SheetsReorderSheet;
    expect(op).toEqual({ op: "reorder-sheet", from: 0, to: 2 });
  });

  test("malformed payloads degrade to unknown (never throw, never guess)", () => {
    // Merge with a truncated range (missing colEnd).
    expect(firstOp(changelog([[27911206, { "1": [null, "0", 0, 1, 0] }]])).op).toBe("unknown");
    // Opaque whose spec is neither a chart record nor an image array.
    expect(
      firstOp(
        changelog([[27809640, { "1": [null, "x", { "1": 99 }, [null, 0, "0", [null, 1, 0]]] }]]),
      ).op,
    ).toBe("unknown");
    // Opaque with a chart spec but a malformed anchor (cell not an array).
    expect(
      firstOp(changelog([[27809640, { "1": [null, "x", { "1": 3 }, [null, 0, "0", "nope"]] }]])).op,
    ).toBe("unknown");
    // Reorder with a non-integer index.
    expect(firstOp(changelog([[31997291, [null, "a", 2]]])).op).toBe("unknown");
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

  test("a confirmed value-set with an unparseable CONTENT degrades to unknown", () => {
    // CELL_CONTENT_TAG (132274236) matched — the decoder has committed "this op
    // sets the cell's value" — but neither known value shape parses, so the op
    // must surface as unknown rather than be silently dropped as {kind:"none"}.
    // Array CONTENT whose text slot ([2]) is not a string.
    expect(
      firstOp(
        changelog([
          [21299578, [null, [null, "0", 1, 2, 0, 1], [null, 132274236, 3, [null, 2, 7]], {}]],
        ]),
      ).op,
    ).toBe("unknown");
    // Record CONTENT whose value field ("3") is neither a number nor a string.
    expect(
      firstOp(
        changelog([
          [
            21299578,
            [null, [null, "0", 1, 2, 0, 1], [null, 132274236, 3, { "1": 3, "3": true }], {}],
          ],
        ]),
      ).op,
    ).toBe("unknown");
    // CONTENT is a bare primitive (neither array nor record).
    expect(
      firstOp(changelog([[21299578, [null, [null, "0", 1, 2, 0, 1], [null, 132274236, 3, 5], {}]]]))
        .op,
    ).toBe("unknown");
  });

  test("a reversed range degrades to unknown (cell + merge)", () => {
    // Half-open ranges are end >= start; a reversed range is a malformed payload.
    // Reversed rows through a cell mutation.
    expect(firstOp(changelog([[21299578, [null, [null, "0", 5, 2, 0, 1], {}, {}]]])).op).toBe(
      "unknown",
    );
    // Reversed cols through a merge.
    expect(firstOp(changelog([[27911206, { "1": [null, "0", 0, 1, 3, 1] }]])).op).toBe("unknown");
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
