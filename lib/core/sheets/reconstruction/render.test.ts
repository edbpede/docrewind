// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { asGid, type SheetsRange } from "@/lib/core/sheets/decoder/types";
import { type Cell, cellKey, createModel, createSheet, type SheetGrid } from "./model";
import {
  columnLabel,
  hasFidelityNotice,
  mergeAt,
  placeholderAt,
  placeholdersFor,
  renderCell,
  renderCellAt,
  rowSegments,
} from "./render";

const GID0 = asGid("0");

function range(rowStart: number, rowEnd: number, colStart: number, colEnd: number): SheetsRange {
  return { gid: GID0, rowStart, rowEnd, colStart, colEnd };
}

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

/** A sheet with a single-row horizontal merge A1:C1 and a multi-row merge A3:A4. */
function mergedSheet(): SheetGrid {
  const sheet = createSheet("Sheet 1");
  sheet.merges.push(range(0, 1, 0, 3)); // A1:C1 (anchor (0,0), colSpan 3)
  sheet.merges.push(range(2, 4, 0, 1)); // A3:A4 (anchor (2,0), multi-row)
  return sheet;
}

describe("render — mergeAt (Option B, no rowSpan)", () => {
  test("returns the colSpan at a merge anchor", () => {
    expect(mergeAt(mergedSheet(), 0, 0)).toEqual({ colSpan: 3 });
  });

  test("returns null for a same-row absorbed cell (the segment walk jumps past it)", () => {
    expect(mergeAt(mergedSheet(), 0, 1)).toBeNull();
  });

  test("returns 'covered' for a cell whose merge anchor is in a different row", () => {
    expect(mergeAt(mergedSheet(), 3, 0)).toBe("covered");
  });

  test("returns null for an uncovered cell", () => {
    expect(mergeAt(mergedSheet(), 9, 9)).toBeNull();
  });

  test("resolves overlapping merges last-wins", () => {
    const sheet = createSheet("Overlap");
    sheet.merges.push(range(0, 1, 0, 2)); // colSpan 2 at (0,0)
    sheet.merges.push(range(0, 1, 0, 4)); // colSpan 4 at (0,0) — pushed later, wins
    expect(mergeAt(sheet, 0, 0)).toEqual({ colSpan: 4 });
  });
});

describe("render — rowSegments", () => {
  test("emits one spanning segment for a horizontal merge and absorbs covered cols", () => {
    expect(rowSegments(mergedSheet(), 0, 5)).toEqual([
      { col: 0, colSpan: 3 },
      { col: 3, colSpan: 1 },
      { col: 4, colSpan: 1 },
    ]);
  });

  test("emits a covered blank for a cross-row covered cell", () => {
    // Row 3 is covered by the multi-row merge A3:A4 at col 0.
    expect(rowSegments(mergedSheet(), 3, 3)).toEqual([
      { col: 0, covered: true },
      { col: 1, colSpan: 1 },
      { col: 2, colSpan: 1 },
    ]);
  });

  test("clamps a colSpan that would overflow the rendered colCount", () => {
    const sheet = createSheet("Wide");
    sheet.merges.push(range(0, 1, 0, 6)); // colSpan 6, but only 4 cols rendered
    expect(rowSegments(sheet, 0, 4)).toEqual([{ col: 0, colSpan: 4 }]);
  });

  test("emits plain unit segments for a row with no merges", () => {
    expect(rowSegments(createSheet("Plain"), 0, 3)).toEqual([
      { col: 0, colSpan: 1 },
      { col: 1, colSpan: 1 },
      { col: 2, colSpan: 1 },
    ]);
  });
});

describe("render — placeholderAt + placeholdersFor", () => {
  function withPlaceholders(): SheetGrid {
    const sheet = createSheet("Objects");
    sheet.placeholders.push({ kind: "chart", row: 1, col: 0 });
    sheet.placeholders.push({ kind: "image", row: 14, col: 5 });
    return sheet;
  }

  test("returns the kind at an anchor and null elsewhere", () => {
    const sheet = withPlaceholders();
    expect(placeholderAt(sheet, 1, 0)).toEqual({ kind: "chart" });
    expect(placeholderAt(sheet, 14, 5)).toEqual({ kind: "image" });
    expect(placeholderAt(sheet, 0, 0)).toBeNull();
  });

  test("placeholdersFor returns the whole list", () => {
    expect(placeholdersFor(withPlaceholders())).toHaveLength(2);
  });
});
