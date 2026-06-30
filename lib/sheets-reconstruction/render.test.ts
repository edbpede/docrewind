// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { type Cell, cellKey, createModel, createSheet } from "./model";
import { columnLabel, hasFidelityNotice, renderCell, renderCellAt } from "./render";

function cell(overrides: Partial<Cell>): Cell {
  return {
    value: null,
    formula: null,
    numberFormat: null,
    style: { bold: false, italic: false },
    ...overrides,
  };
}

describe("render — columnLabel", () => {
  test("maps 0-indexed columns to A1 labels", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(columnLabel(27)).toBe("AB");
    expect(columnLabel(701)).toBe("ZZ");
  });
});

describe("render — renderCell", () => {
  test("renders a formula as its text", () => {
    expect(renderCell(cell({ formula: "=A1+A2" }))).toMatchObject({
      text: "=A1+A2",
      formula: true,
      numeric: false,
    });
  });

  test("renders a number through a supported format", () => {
    expect(renderCell(cell({ value: 1234.5, numberFormat: "#,##0.00" }))).toMatchObject({
      text: "1,234.50",
      numeric: true,
    });
  });

  test("falls back to the raw number string for an unsupported format", () => {
    expect(renderCell(cell({ value: 45000, numberFormat: "yyyy-mm-dd" })).text).toBe("45000");
  });

  test("renders a number with no format as its raw string", () => {
    expect(renderCell(cell({ value: 42 })).text).toBe("42");
  });

  test("renders text verbatim and carries style flags", () => {
    expect(renderCell(cell({ value: "hi", style: { bold: true, italic: true } }))).toMatchObject({
      text: "hi",
      bold: true,
      italic: true,
      numeric: false,
    });
  });

  test("renders an empty cell as the empty string", () => {
    expect(renderCell(cell({})).text).toBe("");
  });
});

describe("render — renderCellAt + hasFidelityNotice", () => {
  test("returns null for an unset cell and a rendered cell when present", () => {
    const sheet = createSheet("Sheet 1");
    sheet.cells.set(cellKey(0, 0), cell({ value: "x" }));
    expect(renderCellAt(sheet, 0, 0)?.text).toBe("x");
    expect(renderCellAt(sheet, 9, 9)).toBeNull();
  });

  test("reports whether the model carries any fidelity notice", () => {
    const model = createModel();
    expect(hasFidelityNotice(model)).toBe(false);
    model.fidelityNotices.push({ kind: "unknown-op", detail: "123" });
    expect(hasFidelityNotice(model)).toBe(true);
  });
});
