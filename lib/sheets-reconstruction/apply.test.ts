// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeSheetsOperations } from "../sheets-decoder/decode";
import { asGid } from "../sheets-decoder/types";
import { applySheetsRevision } from "./apply";
import { cellKey, createModel, type GridModel } from "./model";

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
