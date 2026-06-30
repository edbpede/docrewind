// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sheets grid working model (plan P1 / §7). A spreadsheet is `tabs × sparse 2-D
// cells` — structurally incompatible with the Docs linear-text `CharElement[]`
// (which is exactly why Sheets gets its own core rather than a polymorphic
// union). The model is `order: Gid[]` + `Map<Gid, SheetGrid>`, each grid a
// SPARSE `Map<CellKey, Cell>` (only written cells are stored), so a 10k-row
// sheet costs only the cells that were actually touched.
//
// This is the mutable working model — fields are intentionally NOT readonly.
// PURE: no browser / fetch / Worker.

import type { CellFormat, Gid, SheetsRange } from "../sheets-decoder/types";

/**
 * A `row:col` cell address (0-indexed), branded so a raw string can't be passed
 * where a key is expected. Built only via {@link cellKey}.
 */
export type CellKey = string & { readonly __brand: "CellKey" };

/** Build the canonical sparse-map key for a 0-indexed (row, col) cell. */
export function cellKey(row: number, col: number): CellKey {
  return `${row}:${col}` as CellKey;
}

/** Parse a {@link CellKey} back into its 0-indexed (row, col) pair. */
export function parseCellKey(key: CellKey): { row: number; col: number } {
  const sep = key.indexOf(":");
  return {
    row: Number.parseInt(key.slice(0, sep), 10),
    col: Number.parseInt(key.slice(sep + 1), 10),
  };
}

/** The visual (CSS-able) style of a cell — bold/italic. */
export interface CellStyle {
  bold: boolean;
  italic: boolean;
}

/**
 * One reconstructed cell. `value` is the stored value (number or text); `formula`
 * is the formula TEXT when the cell holds a formula (replayed as text, no
 * evaluation — §0); `numberFormat` is the Google value-format pattern (rendered
 * by `number-format.ts`); `style` is the visual style.
 */
export interface Cell {
  value: number | string | null;
  formula: string | null;
  numberFormat: string | null;
  style: CellStyle;
}

/**
 * A non-cell object anchored at a single top-left cell (a chart or image). Only
 * the anchor POINT + `kind` are modeled — never image bytes — so the grid renders
 * a labeled placeholder box (§4) and stays content-free + network-free.
 */
export interface Placeholder {
  kind: "chart" | "image";
  row: number;
  col: number;
}

/** One sheet (tab): its display name + a sparse cell map + extent bounds. */
export interface SheetGrid {
  name: string;
  cells: Map<CellKey, Cell>;
  /** Largest 0-indexed row/col touched + 1 — the rendered extent bound. */
  rowCount: number;
  colCount: number;
  /** Merged cell ranges (Option B: value at the anchor, covered cells blank). */
  merges: SheetsRange[];
  /** Embedded chart/image objects, each anchored at one cell. */
  placeholders: Placeholder[];
}

/**
 * Privacy-safe fidelity notice: appended whenever an op degrades to
 * `SheetsUnknownOp`, a `modelVersion` mismatch is detected (R9), or a
 * number-format pattern falls back to its raw value. `detail` is a content-free
 * code (an opcode, a version pair, or "") — never cell content.
 */
export interface FidelityNotice {
  readonly kind:
    | "unknown-op"
    | "model-version-mismatch"
    | "number-format-fallback"
    | "conditional-format-dropped";
  readonly detail: string;
}

/** The full multi-sheet working model. */
export interface GridModel {
  order: Gid[];
  sheets: Map<Gid, SheetGrid>;
  fidelityNotices: FidelityNotice[];
}

/** A fresh, empty grid model — no sheets, no notices. */
export function createModel(): GridModel {
  return { order: [], sheets: new Map(), fidelityNotices: [] };
}

/** A fresh empty cell carrying default (no) value/format. */
export function createCell(): Cell {
  return { value: null, formula: null, numberFormat: null, style: { bold: false, italic: false } };
}

/** Create a fresh empty sheet with the given display name. */
export function createSheet(name: string): SheetGrid {
  return { name, cells: new Map(), rowCount: 0, colCount: 0, merges: [], placeholders: [] };
}

/**
 * Re-fold a sheet's extent (`rowCount`/`colCount`) over its cells AND merges AND
 * placeholders. Called after any extent-affecting mutation (a merge/placeholder
 * push, or a structure shift) so a merge/placeholder reaching beyond the cell
 * bounds is still rendered — `remapCells` resets the extent from cells only.
 */
export function recomputeExtent(sheet: SheetGrid): void {
  let maxRow = 0;
  let maxCol = 0;
  for (const key of sheet.cells.keys()) {
    const { row, col } = parseCellKey(key);
    maxRow = Math.max(maxRow, row + 1);
    maxCol = Math.max(maxCol, col + 1);
  }
  for (const range of sheet.merges) {
    maxRow = Math.max(maxRow, range.rowEnd);
    maxCol = Math.max(maxCol, range.colEnd);
  }
  for (const placeholder of sheet.placeholders) {
    maxRow = Math.max(maxRow, placeholder.row + 1);
    maxCol = Math.max(maxCol, placeholder.col + 1);
  }
  sheet.rowCount = maxRow;
  sheet.colCount = maxCol;
}

function cloneCell(cell: Cell): Cell {
  return {
    value: cell.value,
    formula: cell.formula,
    numberFormat: cell.numberFormat,
    style: { bold: cell.style.bold, italic: cell.style.italic },
  };
}

function cloneSheet(sheet: SheetGrid): SheetGrid {
  const cells = new Map<CellKey, Cell>();
  for (const [key, cell] of sheet.cells) {
    cells.set(key, cloneCell(cell));
  }
  return {
    name: sheet.name,
    cells,
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
    merges: sheet.merges.map((r) => ({ ...r })),
    placeholders: sheet.placeholders.map((p) => ({ ...p })),
  };
}

/** Deep-clone the model (used by snapshotting — the spine never mutates a snapshot). */
export function cloneModel(model: GridModel): GridModel {
  const sheets = new Map<Gid, SheetGrid>();
  for (const [gid, sheet] of model.sheets) {
    sheets.set(gid, cloneSheet(sheet));
  }
  return {
    order: [...model.order],
    sheets,
    fidelityNotices: model.fidelityNotices.map((n) => ({ kind: n.kind, detail: n.detail })),
  };
}

/** Re-export the decoder's `CellFormat` so consumers have one import surface. */
export type { CellFormat };
