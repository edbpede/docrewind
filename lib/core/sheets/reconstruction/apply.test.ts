// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeSheetsOperations } from "@/lib/core/sheets/decoder/decode";
import { asGid } from "@/lib/core/sheets/decoder/types";
import { applySheetsRevision } from "./apply";
import { cellKey, createModel, type GridModel } from "./model";
import { rowSegments } from "./render";

const GID0 = asGid("0");

function changelog(ops: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, changelog: ops.map((op, i) => [op, 1000 + i, "u", i + 1, "s", i]) };
}

function gridFrom(payload: Record<string, unknown>): GridModel {
  const model = createModel();
  for (const revision of decodeSheetsOperations(payload)) {
    applySheetsRevision(model, revision);
  }
  return model;
}

function setNum(row: number, col: number, value: number, gid = "0"): unknown {
  return [
    21299578,
    [
      null,
      [null, gid, row, row + 1, col, col + 1],
      [null, 132274236, 3, { "1": 3, "3": value }, null, null, 0],
      {},
    ],
  ];
}

function cellOf(model: GridModel, row: number, col: number, gid = GID0) {
  return model.sheets.get(gid)?.cells.get(cellKey(row, col));
}

describe("apply — cell content", () => {
  test("writes a numeric value into the implicit default sheet", () => {
    const model = gridFrom(changelog([setNum(1, 0, 12345)]));
    expect(model.order).toEqual([GID0]);
    expect(cellOf(model, 1, 0)?.value).toBe(12345);
    expect(model.sheets.get(GID0)?.rowCount).toBe(2);
    expect(model.sheets.get(GID0)?.colCount).toBe(1);
  });

  test("stores a formula as text without a value", () => {
    const formula = [
      21299578,
      [null, [null, "0", 3, 4, 0, 1], [null, 132274236, 3, [null, 2, "=SUM(A2:A3)"]], {}],
    ];
    const model = gridFrom(changelog([formula]));
    expect(cellOf(model, 3, 0)?.formula).toBe("=SUM(A2:A3)");
    expect(cellOf(model, 3, 0)?.value).toBeNull();
  });

  test("clear empties the value but the cell remains", () => {
    const clear = [21299578, [null, [null, "0", 1, 2, 0, 1], { "1": 2 }, []]];
    const model = gridFrom(changelog([setNum(1, 0, 42), clear]));
    expect(cellOf(model, 1, 0)?.value).toBeNull();
  });
});

describe("apply — formatting", () => {
  test("a bold mask sets the visual style without changing the value", () => {
    const bold = [
      21299578,
      [null, [null, "0", 1, 2, 0, 1], { "2": 2, "6": 0 }, { "2": [{ "2": 16384, "17": 1 }] }],
    ];
    const model = gridFrom(changelog([setNum(1, 0, 7), bold]));
    expect(cellOf(model, 1, 0)?.value).toBe(7);
    expect(cellOf(model, 1, 0)?.style.bold).toBe(true);
  });

  test("a supported number format raises no fidelity notice", () => {
    const currency = [
      21299578,
      [
        null,
        [null, "0", 1, 2, 0, 1],
        { "1": 32 },
        { "2": [{ "2": 1, "3": [null, 4, "#,##0.00"] }] },
      ],
    ];
    const model = gridFrom(changelog([setNum(1, 0, 5), currency]));
    expect(cellOf(model, 1, 0)?.numberFormat).toBe("#,##0.00");
    expect(model.fidelityNotices).toHaveLength(0);
  });

  test("an unsupported number format raises a fallback notice", () => {
    const dateFmt = [
      21299578,
      [
        null,
        [null, "0", 1, 2, 0, 1],
        { "1": 32 },
        { "2": [{ "2": 1, "3": [null, 4, "yyyy-mm-dd"] }] },
      ],
    ];
    const model = gridFrom(changelog([setNum(1, 0, 5), dateFmt]));
    expect(model.fidelityNotices.some((n) => n.kind === "number-format-fallback")).toBe(true);
  });
});

describe("apply — fidelity signal", () => {
  test("an unknown opcode appends an unknown-op notice", () => {
    const model = gridFrom(changelog([[99999999, [null]]]));
    expect(model.fidelityNotices).toEqual([{ kind: "unknown-op", detail: "99999999" }]);
  });

  test("a modelVersion mismatch appends a single notice (R9)", () => {
    const model = gridFrom(changelog([setNum(0, 0, 1), setNum(0, 1, 2)], { modelVersion: 100 }));
    expect(model.fidelityNotices.filter((n) => n.kind === "model-version-mismatch")).toHaveLength(
      1,
    );
  });
});

describe("apply — structure ops (collision-safe shifts §7)", () => {
  test("inserting a row shifts downstream cells down with no collision", () => {
    const insert = [24502104, [null, "0", 1, 1, 0, 0]];
    const model = gridFrom(
      changelog([setNum(0, 0, 10), setNum(1, 0, 20), setNum(2, 0, 30), insert]),
    );
    expect(cellOf(model, 0, 0)?.value).toBe(10);
    expect(cellOf(model, 1, 0)).toBeUndefined();
    expect(cellOf(model, 2, 0)?.value).toBe(20);
    expect(cellOf(model, 3, 0)?.value).toBe(30);
  });

  test("inserting a column shifts downstream cells right", () => {
    const insert = [24502104, [null, "0", 1, 2, 1, 0]];
    const model = gridFrom(changelog([setNum(0, 0, 1), setNum(0, 1, 2), insert]));
    expect(cellOf(model, 0, 0)?.value).toBe(1);
    expect(cellOf(model, 0, 3)?.value).toBe(2);
  });

  test("deleting a row removes it and shifts the rest up", () => {
    const del = [25037233, [null, "0", 1, 1, 0]];
    const model = gridFrom(
      changelog([setNum(0, 0, 10), setNum(1, 0, 20), setNum(2, 0, 30), setNum(3, 0, 40), del]),
    );
    expect(cellOf(model, 0, 0)?.value).toBe(10);
    expect(cellOf(model, 1, 0)?.value).toBe(30);
    expect(cellOf(model, 2, 0)?.value).toBe(40);
    expect(cellOf(model, 3, 0)).toBeUndefined();
  });
});

describe("apply — sheets (tabs)", () => {
  test("add-sheet appends to order with its name; rename updates it", () => {
    const add = [21350203, [null, 1, 0, "849076485", { "1": [[null, 0, 0, "Ark2"]] }]];
    const rename = [26812461, [null, "0", { "1": [[null, 0, 0, "Renamed"]] }]];
    const model = gridFrom(changelog([setNum(0, 0, 1), add, rename]));
    expect(model.order).toEqual([GID0, asGid("849076485")]);
    expect(model.sheets.get(asGid("849076485"))?.name).toBe("Ark2");
    expect(model.sheets.get(GID0)?.name).toBe("Renamed");
  });

  test("add-sheet repositions a lazily-created sheet to its wire index (not just rename)", () => {
    // A cell op references gid "849076485" before its add-sheet arrives, so
    // ensureSheet lazily creates it at the END of order: [GID0, "849076485"].
    // The later add-sheet declares index 0 — it must MOVE the sheet to the front,
    // not merely set its name (the index gap that claim 3501810500 describes).
    const add0 = [21350203, [null, 0, 0, "849076485", { "1": [[null, 0, 0, "Ark2"]] }]];
    const model = gridFrom(changelog([setNum(0, 0, 1), setNum(0, 0, 5, "849076485"), add0]));
    expect(model.order).toEqual([asGid("849076485"), GID0]);
    expect(model.sheets.get(asGid("849076485"))?.name).toBe("Ark2");
  });
});

const CHART_OBJECT = [
  27809640,
  { "1": [null, "974979131", { "1": 3 }, [null, 0, "0", [null, 1, 0]], null, "Diagram"] },
];
const IMAGE_OBJECT = [
  27809640,
  {
    "1": [
      null,
      "501988802",
      [null, 2, [null, 2, "s-blob-v1-IMAGE-x", null, 2048, 2048]],
      [null, 0, "0", [null, 14, 5]],
      null,
      "Billede",
    ],
  },
];
const COND_FORMAT = [45416218, [null, "0", 0, [null, [[null, "0", 2, 5, 0, 1]]]]];
const CHART_DATASOURCE = [
  34070425,
  [null, "1430258216", [null, "0", 2, 3, 0, 2], 3, { "2": 1, "3": "974979131" }],
];

describe("apply — Phase-5 op families", () => {
  test("merge populates merges; an absorbed cell that held a value renders blank (§0)", () => {
    // Write B1 (row 0, col 1), THEN merge A1:B1 (row 0, cols 0-2).
    const merge = [27911206, { "1": [null, "0", 0, 1, 0, 2] }];
    const model = gridFrom(changelog([setNum(0, 1, 777), merge]));
    const sheet = model.sheets.get(GID0);
    if (sheet === undefined) throw new Error("no sheet");
    expect(sheet.merges).toHaveLength(1);
    // The merge's companion clear decodes to {none}, so B1's value is NOT cleared
    // in the cell map — the merges set is the SOLE authority that blanks it.
    expect(cellOf(model, 0, 1)?.value).toBe(777);
    // rowSegments collapses A1:B1 into a single 2-wide segment → B1 is never
    // emitted as its own cell, so it renders blank.
    const segs = rowSegments(sheet, 0, 4);
    expect(segs[0]).toEqual({ col: 0, colSpan: 2 });
    expect(segs.some((s) => s.col === 1)).toBe(false);
  });

  test("opaque populates placeholders with the decoded kind + anchor", () => {
    const model = gridFrom(changelog([CHART_OBJECT, IMAGE_OBJECT]));
    const sheet = model.sheets.get(GID0);
    if (sheet === undefined) throw new Error("no sheet");
    expect(sheet.placeholders).toEqual([
      { kind: "chart", row: 1, col: 0 },
      { kind: "image", row: 14, col: 5 },
    ]);
    // The extent re-grew to cover the image anchor (row 14, col 5).
    expect(sheet.rowCount).toBe(15);
    expect(sheet.colCount).toBe(6);
  });

  test("cond-format raises exactly one conditional-format-dropped notice (de-duped)", () => {
    const model = gridFrom(changelog([COND_FORMAT, COND_FORMAT]));
    expect(model.fidelityNotices).toEqual([{ kind: "conditional-format-dropped", detail: "" }]);
  });

  test("chart-datasource is inert and raises no notice", () => {
    const model = gridFrom(changelog([CHART_DATASOURCE]));
    expect(model.fidelityNotices).toHaveLength(0);
  });

  test("reorder moves a gid within order; gids unchanged", () => {
    const add = [21350203, [null, 1, 0, "849076485", { "1": [[null, 0, 0, "Ark2"]] }]];
    const reorder = [31997291, [null, 0, 2]]; // from 0, to clamps into [0, len)
    const model = gridFrom(changelog([setNum(0, 0, 1), add, reorder]));
    expect(model.order).toEqual([asGid("849076485"), GID0]);
  });

  test("reorder is a no-op (never throws) when from === to or out of range", () => {
    const reorder = [31997291, [null, 5, 9]]; // both clamp to the single sheet's index 0
    const model = gridFrom(changelog([setNum(0, 0, 1), reorder]));
    expect(model.order).toEqual([GID0]);
  });

  test("reorder ignores an out-of-range `from` instead of moving the wrong sheet", () => {
    // Two sheets: [GID0, "849076485"]. `from=5` is out of range for len 2 — clamping
    // it would move whatever sheet sits at the clamped index (the WRONG sheet, since
    // the op carries no gid). The op must be a no-op (claim 3501810505).
    const add = [21350203, [null, 1, 0, "849076485", { "1": [[null, 0, 0, "Ark2"]] }]];
    const reorder = [31997291, [null, 5, 0]]; // from out of range, to = 0
    const model = gridFrom(changelog([setNum(0, 0, 1), add, reorder]));
    expect(model.order).toEqual([GID0, asGid("849076485")]);
  });

  test("structure-shift on a WIDE merge + TALL placeholder shifts AND re-grows extent", () => {
    const merge = [27911206, { "1": [null, "0", 0, 1, 15, 17] }]; // cols beyond MIN_COLS
    const chart = [27809640, { "1": [null, "obj", { "1": 3 }, [null, 0, "0", [null, 30, 0]]] }];
    const insertCol = [24502104, [null, "0", 0, 1, 1, 0]]; // insert 1 col at index 0
    const insertRow = [24502104, [null, "0", 0, 1, 0, 0]]; // insert 1 row at index 0
    const model = gridFrom(changelog([merge, chart, insertCol, insertRow]));
    const sheet = model.sheets.get(GID0);
    if (sheet === undefined) throw new Error("no sheet");
    // Merge cols shifted right (15-17 -> 16-18); colCount re-grew to 18.
    expect(sheet.merges[0]).toMatchObject({ colStart: 16, colEnd: 18 });
    expect(sheet.colCount).toBe(18);
    // Placeholder row shifted down (30 -> 31), col right (0 -> 1); rowCount re-grew.
    expect(sheet.placeholders[0]).toEqual({ kind: "chart", row: 31, col: 1 });
    expect(sheet.rowCount).toBe(32);
  });

  test("a merge/placeholder inside a deleted band is dropped", () => {
    const merge = [27911206, { "1": [null, "0", 0, 1, 15, 17] }];
    const chart = [27809640, { "1": [null, "obj", { "1": 3 }, [null, 0, "0", [null, 30, 0]]] }];
    const delCols = [25037233, [null, "0", 15, 3, 1]]; // delete cols 15-17 (the whole merge)
    const delRows = [25037233, [null, "0", 30, 1, 0]]; // delete row 30 (the placeholder)
    const model = gridFrom(changelog([merge, chart, delCols, delRows]));
    const sheet = model.sheets.get(GID0);
    if (sheet === undefined) throw new Error("no sheet");
    expect(sheet.merges).toHaveLength(0);
    expect(sheet.placeholders).toHaveLength(0);
  });

  test("a straddling merge is clamped (not dropped) on a partial delete", () => {
    const merge = [27911206, { "1": [null, "0", 0, 1, 13, 18] }]; // cols 13-17
    const delCols = [25037233, [null, "0", 15, 2, 1]]; // delete cols 15-16
    const model = gridFrom(changelog([merge, delCols]));
    const sheet = model.sheets.get(GID0);
    if (sheet === undefined) throw new Error("no sheet");
    // 13-18 minus the 2 deleted interior cols -> 13-16.
    expect(sheet.merges[0]).toMatchObject({ colStart: 13, colEnd: 16 });
  });
});

describe("apply — additional coverage", () => {
  test("writes a plain text value", () => {
    const text = [
      21299578,
      [null, [null, "0", 0, 1, 0, 1], [null, 132274236, 3, [null, 2, "hi"]], {}],
    ];
    const model = gridFrom(changelog([text]));
    expect(cellOf(model, 0, 0)?.value).toBe("hi");
    expect(cellOf(model, 0, 0)?.formula).toBeNull();
  });

  test("clear-format resets style + number format on an existing cell", () => {
    const bold = [
      21299578,
      [null, [null, "0", 0, 1, 0, 1], { "2": 2 }, { "2": [{ "2": 16384, "17": 1 }] }],
    ];
    const clearFmt = [21299578, [null, [null, "0", 0, 1, 0, 1], { "1": 132274237 }, []]];
    const model = gridFrom(changelog([setNum(0, 0, 1), bold, clearFmt]));
    expect(cellOf(model, 0, 0)?.style.bold).toBe(false);
  });

  test("an oversized format range only touches existing cells (bounded)", () => {
    const hugeBold = [
      21299578,
      [null, [null, "0", 0, 70000, 0, 2], { "2": 2 }, { "2": [{ "2": 16384, "17": 1 }] }],
    ];
    const model = gridFrom(changelog([setNum(5, 0, 7), hugeBold]));
    expect(cellOf(model, 5, 0)?.style.bold).toBe(true);
    expect(model.sheets.get(GID0)?.cells.size).toBe(1);
    // Format-only is lossless over the bounded path → no fidelity notice fires.
    expect(model.fidelityNotices).toHaveLength(0);
  });

  test("an oversized VALUE mutation stays bounded but signals the dropped content", () => {
    // rows*cols (70000 * 2) exceeds MAX_CELLS_PER_MUTATION, so new cells are NOT
    // materialized (R7). The one pre-existing cell in range is still updated, but
    // the dropped new-cell values are surfaced honestly (claim 3501810512).
    const hugeNum = [
      21299578,
      [
        null,
        [null, "0", 0, 70000, 0, 2],
        [null, 132274236, 3, { "1": 3, "3": 99 }, null, null, 0],
        {},
      ],
    ];
    const model = gridFrom(changelog([setNum(5, 0, 7), hugeNum]));
    expect(cellOf(model, 5, 0)?.value).toBe(99); // existing cell still written
    expect(model.sheets.get(GID0)?.cells.size).toBe(1); // no new cells materialized
    expect(model.fidelityNotices.some((n) => n.kind === "oversized-mutation-dropped")).toBe(true);
  });

  test("an oversized clear loses nothing and raises no oversized-mutation notice", () => {
    // A clear over an oversized range only empties existing cells — absent cells
    // are already empty — so it must NOT raise a false 'dropped content' notice.
    const hugeClear = [21299578, [null, [null, "0", 0, 70000, 0, 2], { "1": 2 }, []]];
    const model = gridFrom(changelog([setNum(5, 0, 7), hugeClear]));
    expect(cellOf(model, 5, 0)?.value).toBeNull(); // existing cell cleared
    expect(model.fidelityNotices.some((n) => n.kind === "oversized-mutation-dropped")).toBe(false);
  });

  test("deleting a column removes it and shifts the rest left", () => {
    const del = [25037233, [null, "0", 1, 1, 1]];
    const model = gridFrom(changelog([setNum(0, 0, 1), setNum(0, 1, 2), setNum(0, 2, 3), del]));
    expect(cellOf(model, 0, 0)?.value).toBe(1);
    expect(cellOf(model, 0, 1)?.value).toBe(3);
    expect(cellOf(model, 0, 2)).toBeUndefined();
  });

  test("a transaction wrapper applies all sub-ops in one revision", () => {
    const txn = [4444216, [setNum(0, 0, 1), setNum(1, 0, 2)]];
    const model = gridFrom(changelog([txn]));
    expect(cellOf(model, 0, 0)?.value).toBe(1);
    expect(cellOf(model, 1, 0)?.value).toBe(2);
  });

  test("inert opcodes change nothing and raise no notices", () => {
    const model = gridFrom(
      changelog([
        [25813757, [null, "0"]],
        [28950036, [null]],
        [25104121, []],
      ]),
    );
    expect(model.fidelityNotices).toHaveLength(0);
    expect(model.order).toHaveLength(0);
  });

  test("a second add-sheet for the same gid updates its name", () => {
    const add = [21350203, [null, 1, 0, "X", { "1": [[null, 0, 0, "First"]] }]];
    const readd = [21350203, [null, 1, 0, "X", { "1": [[null, 0, 0, "Second"]] }]];
    const model = gridFrom(changelog([add, readd]));
    expect(model.order.filter((g) => g === asGid("X"))).toHaveLength(1);
    expect(model.sheets.get(asGid("X"))?.name).toBe("Second");
  });
});
