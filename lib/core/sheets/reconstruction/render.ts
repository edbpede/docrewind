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

import type { SheetsRange } from "@/lib/core/sheets/decoder/types";
import type { Cell, GridModel, Placeholder, SheetGrid } from "./model";
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

/**
 * A merge lookup at one cell (Option B — horizontal `colSpan` only, never a
 * `rowSpan`): the merge ANCHOR carries its `colSpan`; a covered cell whose anchor
 * is in a DIFFERENT row reads as `"covered"` (the viewport draws a blank `<td>`);
 * a covered cell in the anchor's OWN row is absorbed by the anchor's `colSpan`
 * (the segment walk advances past it, never asking) so it reads as `null`; an
 * uncovered cell is `null`.
 */
export type MergeAt = { readonly colSpan: number } | "covered" | null;

/** One horizontal render segment in a row: a (possibly merged) cell or a cross-row blank. */
export type RowSegment =
  | { readonly col: number; readonly colSpan: number }
  | { readonly col: number; readonly covered: true };

/** Resolve the merge state at (row, col); last-wins when ranges overlap. */
export function mergeAt(sheet: SheetGrid, row: number, col: number): MergeAt {
  let covering: SheetsRange | null = null;
  for (const range of sheet.merges) {
    if (
      row >= range.rowStart &&
      row < range.rowEnd &&
      col >= range.colStart &&
      col < range.colEnd
    ) {
      covering = range; // last-wins on overlap
    }
  }
  if (covering === null) return null;
  if (covering.rowStart === row && covering.colStart === col) {
    return { colSpan: covering.colEnd - covering.colStart };
  }
  return covering.rowStart === row ? null : "covered";
}

/**
 * The pure, Bun-gated segment list the viewport iterates for one row — the SINGLE
 * authority for merged-row layout, consuming {@link mergeAt} internally. Anchor
 * cols emit `{col, colSpan}` and absorb the next `colSpan-1` cols; cross-row
 * covered cols emit `{col, covered}`; normal cols emit `{col, colSpan: 1}`. A
 * `colSpan` is clamped to the rendered `colCount` so a wide merge never overflows.
 */
export function rowSegments(sheet: SheetGrid, row: number, colCount: number): RowSegment[] {
  const segments: RowSegment[] = [];
  let col = 0;
  while (col < colCount) {
    const merge = mergeAt(sheet, row, col);
    if (merge !== null && merge !== "covered") {
      const colSpan = Math.min(merge.colSpan, colCount - col);
      segments.push({ col, colSpan });
      col += colSpan;
      continue;
    }
    segments.push(merge === "covered" ? { col, covered: true } : { col, colSpan: 1 });
    col += 1;
  }
  return segments;
}

/** The placeholder anchored at (row, col), or `null`; last-wins when several coincide. */
export function placeholderAt(
  sheet: SheetGrid,
  row: number,
  col: number,
): { readonly kind: "chart" | "image" } | null {
  let found: Placeholder | null = null;
  for (const placeholder of sheet.placeholders) {
    if (placeholder.row === row && placeholder.col === col) found = placeholder; // last-wins
  }
  return found === null ? null : { kind: found.kind };
}

/** Every placeholder on the sheet (whole-list accessor for tests + diagnostics). */
export function placeholdersFor(sheet: SheetGrid): readonly Placeholder[] {
  return sheet.placeholders;
}

/** True when the model carries any fidelity notice (drives the §9 indicator). */
export function hasFidelityNotice(model: GridModel): boolean {
  return model.fidelityNotices.length > 0;
}
