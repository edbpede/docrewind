// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Grid → renderable cells (plan P1/P3). PURE presentation logic that turns a
// reconstructed {@link Cell} into the display text + style flags the
// `GridViewport` paints, with NO DOM dependency so it is unit-testable under Bun.
//
// Display rules (§0): a formula replays as its TEXT; a number is rendered through
// the value-format pattern when one is set and SUPPORTED, otherwise as its raw
// string (the unsupported-pattern fidelity notice was already raised in apply);
// text renders verbatim; an empty cell renders as "".
//
// PURE: no browser / fetch / Worker.

import type { Cell, GridModel, SheetGrid } from "./model";
import { cellKey } from "./model";
import { formatNumber } from "./number-format";

/** A cell ready to paint: its display text + style + alignment hints. */
export interface RenderedCell {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** True for a numeric value → the UI right-aligns + uses tabular-nums. */
  readonly numeric: boolean;
  /** True when the cell holds a formula (rendered as its text). */
  readonly formula: boolean;
}

/** The A1-style column label for a 0-indexed column (0 → "A", 26 → "AA"). */
export function columnLabel(col: number): string {
  let n = col;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Render one reconstructed cell into its display text + style flags. */
export function renderCell(cell: Cell): RenderedCell {
  const bold = cell.style.bold;
  const italic = cell.style.italic;

  if (cell.formula !== null) {
    return { text: cell.formula, bold, italic, numeric: false, formula: true };
  }
  if (typeof cell.value === "number") {
    const formatted =
      cell.numberFormat !== null ? formatNumber(cell.numberFormat, cell.value) : null;
    return {
      text: formatted ?? String(cell.value),
      bold,
      italic,
      numeric: true,
      formula: false,
    };
  }
  if (typeof cell.value === "string") {
    return { text: cell.value, bold, italic, numeric: false, formula: false };
  }
  return { text: "", bold, italic, numeric: false, formula: false };
}

/** Render the cell at (row, col), or `null` when that cell is empty/unset. */
export function renderCellAt(sheet: SheetGrid, row: number, col: number): RenderedCell | null {
  const cell = sheet.cells.get(cellKey(row, col));
  return cell === undefined ? null : renderCell(cell);
}

/** True when the model carries any fidelity notice (drives the §9 indicator). */
export function hasFidelityNotice(model: GridModel): boolean {
  return model.fidelityNotices.length > 0;
}
