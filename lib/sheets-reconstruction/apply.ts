// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sheets grid reconstruction engine (plan P1/P2 / §7). Applies decoded Sheets
// operations to the mutable {@link GridModel}. This is the CLOSED-WORLD core: it
// switches over the `SheetsOperation` union with a `never` exhaustiveness default
// (adding a variant in `sheets-decoder/types.ts` without an arm here is a compile
// error) — independent of the Docs `apply.ts` `never` gate.
//
// Open-world degradation is honest, never silent: a `SheetsUnknownOp`, a
// `modelVersion` mismatch (R9), or an unsupported number-format pattern appends a
// privacy-safe {@link FidelityNotice} that the UI surfaces calmly (§9). It NEVER
// throws.
//
// PURE: no browser / fetch / Worker.

import type { RevisionId } from "../domain/ids";
import type {
  CellFormat,
  Gid,
  SheetsCellMutation,
  SheetsDecodedRevision,
  SheetsDeleteDim,
  SheetsInsertDim,
  SheetsOperation,
} from "../sheets-decoder/types";
import {
  type Cell,
  type CellKey,
  cellKey,
  createCell,
  createSheet,
  type FidelityNotice,
  type GridModel,
  parseCellKey,
  type SheetGrid,
} from "./model";
import { isSupportedNumberFormat } from "./number-format";

// A single mutation never materializes more than this many cells (R7): a
// format-only op over a whole column would otherwise blow up the sparse map.
// Beyond the cap we touch only cells that already exist in the range.
const MAX_CELLS_PER_MUTATION = 65536;

/** Append a fidelity notice, de-duplicated by (kind, detail). */
function pushNotice(model: GridModel, notice: FidelityNotice): void {
  if (model.fidelityNotices.some((n) => n.kind === notice.kind && n.detail === notice.detail)) {
    return;
  }
  model.fidelityNotices.push(notice);
}

/** Get the sheet for `gid`, lazily creating it (the implicit default tab "0"). */
function ensureSheet(model: GridModel, gid: Gid): SheetGrid {
  let sheet = model.sheets.get(gid);
  if (sheet === undefined) {
    sheet = createSheet(`Sheet ${model.order.length + 1}`);
    model.sheets.set(gid, sheet);
    model.order.push(gid);
  }
  return sheet;
}

/** Apply the decoded content change to a single cell. */
function applyContent(cell: Cell, mutation: SheetsCellMutation): void {
  switch (mutation.content.kind) {
    case "number":
      cell.value = mutation.content.value;
      cell.formula = null;
      break;
    case "text":
      cell.value = mutation.content.text;
      cell.formula = null;
      break;
    case "formula":
      // Formula replays as TEXT (no evaluation, no cached value — §0 / P-i).
      cell.formula = mutation.content.formula;
      cell.value = null;
      break;
    case "clear":
      cell.value = null;
      cell.formula = null;
      break;
    case "none":
      break;
  }
}

/** Apply the decoded format change to a single cell (visual style + number format). */
function applyFormat(model: GridModel, cell: Cell, format: CellFormat): void {
  if (format.clearFormat === true) {
    cell.style.bold = false;
    cell.style.italic = false;
    cell.numberFormat = null;
  }
  if (format.bold !== undefined) cell.style.bold = format.bold;
  if (format.italic !== undefined) cell.style.italic = format.italic;
  if (format.numberFormat !== undefined) {
    cell.numberFormat = format.numberFormat;
    if (!isSupportedNumberFormat(format.numberFormat)) {
      // Unsupported pattern: render falls back to the raw value, so signal it.
      pushNotice(model, { kind: "number-format-fallback", detail: "" });
    }
  }
}

/** Write one (row, col) cell, materializing it if needed, and grow the extent. */
function writeCell(
  sheet: SheetGrid,
  row: number,
  col: number,
  mutation: SheetsCellMutation,
  model: GridModel,
): void {
  const key = cellKey(row, col);
  let cell = sheet.cells.get(key);
  if (cell === undefined) {
    cell = createCell();
    sheet.cells.set(key, cell);
  }
  applyContent(cell, mutation);
  applyFormat(model, cell, mutation.format);
  sheet.rowCount = Math.max(sheet.rowCount, row + 1);
  sheet.colCount = Math.max(sheet.colCount, col + 1);
}

function applyCellMutation(model: GridModel, mutation: SheetsCellMutation): void {
  const sheet = ensureSheet(model, mutation.range.gid);
  const { rowStart, rowEnd, colStart, colEnd } = mutation.range;
  const rows = Math.max(0, rowEnd - rowStart);
  const cols = Math.max(0, colEnd - colStart);
  if (rows === 0 || cols === 0) return;

  if (rows * cols <= MAX_CELLS_PER_MUTATION) {
    for (let row = rowStart; row < rowEnd; row++) {
      for (let col = colStart; col < colEnd; col++) {
        writeCell(sheet, row, col, mutation, model);
      }
    }
    return;
  }
  // Oversized range (e.g. format an entire column): touch only existing cells in
  // range so the sparse map never explodes. (A giant value-set is not a real
  // editing shape; this stays bounded + safe.)
  for (const [key, cell] of sheet.cells) {
    const { row, col } = parseCellKey(key);
    if (row >= rowStart && row < rowEnd && col >= colStart && col < colEnd) {
      applyContent(cell, mutation);
      applyFormat(model, cell, mutation.format);
    }
  }
}

/**
 * Rebuild a sheet's cell map by remapping each cell's (row, col). Rebuilding into
 * a fresh map is COLLISION-SAFE by construction (the shift is injective and
 * deleted cells are dropped) — equivalent to the §7 "far edge inward" re-key.
 */
function remapCells(
  sheet: SheetGrid,
  remap: (row: number, col: number) => { row: number; col: number } | null,
): void {
  const next = new Map<CellKey, Cell>();
  let maxRow = 0;
  let maxCol = 0;
  for (const [key, cell] of sheet.cells) {
    const { row, col } = parseCellKey(key);
    const moved = remap(row, col);
    if (moved === null) continue;
    next.set(cellKey(moved.row, moved.col), cell);
    maxRow = Math.max(maxRow, moved.row + 1);
    maxCol = Math.max(maxCol, moved.col + 1);
  }
  sheet.cells = next;
  sheet.rowCount = maxRow;
  sheet.colCount = maxCol;
}

function applyInsertDim(model: GridModel, op: SheetsInsertDim): void {
  const sheet = ensureSheet(model, op.gid);
  if (op.dim === "row") {
    remapCells(sheet, (row, col) => ({ row: row >= op.index ? row + op.count : row, col }));
  } else {
    remapCells(sheet, (row, col) => ({ row, col: col >= op.index ? col + op.count : col }));
  }
}

function applyDeleteDim(model: GridModel, op: SheetsDeleteDim): void {
  const sheet = ensureSheet(model, op.gid);
  const end = op.index + op.count;
  if (op.dim === "row") {
    remapCells(sheet, (row, col) => {
      if (row >= op.index && row < end) return null;
      return { row: row >= end ? row - op.count : row, col };
    });
  } else {
    remapCells(sheet, (row, col) => {
      if (col >= op.index && col < end) return null;
      return { row, col: col >= end ? col - op.count : col };
    });
  }
}

/**
 * Apply one decoded Sheets operation to the model. Closed-world: the `default`
 * arm is a `never` exhaustiveness gate.
 */
export function applySheetsOperation(
  model: GridModel,
  op: SheetsOperation,
  revisionId: RevisionId,
): void {
  switch (op.op) {
    case "txn":
      for (const sub of op.ops) {
        applySheetsOperation(model, sub, revisionId);
      }
      return;
    case "cell":
      applyCellMutation(model, op);
      return;
    case "add-sheet": {
      let sheet = model.sheets.get(op.gid);
      if (sheet === undefined) {
        sheet = createSheet(op.name.length > 0 ? op.name : `Sheet ${model.order.length + 1}`);
        model.sheets.set(op.gid, sheet);
        const at = Math.min(Math.max(0, op.index), model.order.length);
        model.order.splice(at, 0, op.gid);
      } else if (op.name.length > 0) {
        sheet.name = op.name;
      }
      return;
    }
    case "rename-sheet": {
      const sheet = ensureSheet(model, op.gid);
      sheet.name = op.name;
      return;
    }
    case "insert-dim":
      applyInsertDim(model, op);
      return;
    case "delete-dim":
      applyDeleteDim(model, op);
      return;
    case "cell-style-adjust":
    case "settings":
    case "marker":
      // Recognized but inert in v1 — no value change, no notice.
      return;
    case "unknown":
      pushNotice(model, { kind: "unknown-op", detail: op.opCode });
      return;
    default: {
      // Closed-world exhaustiveness gate: a new SheetsOperation variant without an
      // arm above is a compile error here (the runtime throw is unreachable —
      // decode already degrades every unrecognized opcode to SheetsUnknownOp).
      const _exhaustive: never = op;
      throw new Error(`applySheetsOperation: unhandled ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Apply every operation in one decoded revision, raising R9 on a version mismatch. */
export function applySheetsRevision(model: GridModel, revision: SheetsDecodedRevision): void {
  if (revision.modelVersionMismatch) {
    pushNotice(model, {
      kind: "model-version-mismatch",
      detail: String(revision.modelVersion),
    });
  }
  for (const op of revision.operations) {
    applySheetsOperation(model, op, revision.revisionId);
  }
}
