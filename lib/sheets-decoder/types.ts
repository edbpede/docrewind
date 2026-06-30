// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Closed-world Sheets (Ritz) operation grammar (plan P1 / ground truth:
// `.omc/plans/sheets-ritz-format-findings.md`, live capture 2026-06-30).
//
// Unlike the Docs `ty`-discriminated string ops, Sheets ops are numeric-opcode
// arrays `[opcode, [args]]` whose opcode is a large obfuscated integer tied to
// `modelVersion` (99 in the capture). This module is TYPES ONLY — the closed
// discriminated union `SheetsOperation` that `sheets-reconstruction/apply.ts`
// switches over with a `never` exhaustiveness gate. The runtime open-world
// decode funnel (every unrecognized opcode → `SheetsUnknownOp`, never a throw)
// lives in `decode.ts`.
//
// PURE: imports only the shared branded id + metadata types; no browser / fetch
// / Worker.

import type { RevisionId } from "../domain/ids";
import type { RevisionMeta } from "../replay-core/meta";

/** Branded spreadsheet/tab id (the wire `gid` string, e.g. "0", "849076485"). */
export type Gid = string & { readonly __brand: "Gid" };

/** Validate + brand a gid. Throws on empty. */
export function asGid(value: string): Gid {
  if (value.length === 0) {
    throw new TypeError("asGid: expected a non-empty string");
  }
  return value as Gid;
}

/** Blind-cast for a gid already validated upstream (e.g. inside reconstruction). */
export function unsafeAsGid(value: string): Gid {
  return value as Gid;
}

/**
 * The recognized Ritz opcodes (live capture 2026-06-30). Snapshot/metadata
 * markers (`25104121`, `149980211`) are recognized-but-inert so a normal sheet
 * never spuriously trips the fidelity notice; merges / conditional formatting /
 * charts / images are NOT captured yet and degrade to {@link SheetsUnknownOp}.
 */
export const SHEETS_OPCODE = {
  TXN: 4444216,
  CELL_MUTATION: 21299578,
  ADD_SHEET: 21350203,
  RENAME_SHEET: 26812461,
  INSERT_DIM: 24502104,
  DELETE_DIM: 25037233,
  CELL_STYLE_ADJUST: 25813757,
  SETTINGS: 28950036,
  MARKER_SNAPSHOT: 25104121,
  MARKER_METADATA: 149980211,
} as const;

/** Constant sub-tag for "set cell content" inside a CellMutation payload. */
export const CELL_CONTENT_TAG = 132274236;
/** Constant value of content field "1" signalling "clear the cell's format". */
export const CLEAR_FORMAT_SENTINEL = 132274237;
/** Content field "1" value signalling "clear the cell's value". */
export const CLEAR_VALUE_SENTINEL = 2;

/** A grid dimension: a row axis or a column axis. */
export type Dimension = "row" | "col";

/**
 * A cell range: half-open, 0-indexed on both axes, scoped to a tab `gid`. A2 in
 * the worked examples is `{ gid:"0", rowStart:1, rowEnd:2, colStart:0, colEnd:1 }`.
 */
export interface SheetsRange {
  readonly gid: Gid;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
}

/**
 * The decoded content a CellMutation writes. `formula` replays as TEXT (no
 * evaluation — §0); `none` means the mutation changed only formatting; `clear`
 * empties the cell value.
 */
export type CellContent =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "formula"; readonly formula: string }
  | { readonly kind: "clear" }
  | { readonly kind: "none" };

/**
 * The decoded visual + value-format a CellMutation carries. VISUAL style
 * (`bold`/`italic`) → real CSS; the VALUE-format `numberFormat` is a Google
 * pattern string interpreted by `sheets-reconstruction/number-format.ts`.
 * `clearFormat` resets the cell's formatting to default. Unrecognized format
 * masks are dropped silently (lower-stakes than an unknown op).
 */
export interface CellFormat {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly numberFormat?: string;
  readonly clearFormat?: boolean;
}

/** `4444216` — a transaction wrapping N sub-ops applied as one revision. */
export interface SheetsTxnWrapper {
  readonly op: "txn";
  readonly ops: readonly SheetsOperation[];
}

/** `21299578` — the workhorse: set/clear a cell's value and/or format over a range. */
export interface SheetsCellMutation {
  readonly op: "cell";
  readonly range: SheetsRange;
  readonly content: CellContent;
  readonly format: CellFormat;
}

/** `21350203` — define a new sheet (tab) at `index` with a stable `gid` + name. */
export interface SheetsAddSheet {
  readonly op: "add-sheet";
  readonly gid: Gid;
  readonly index: number;
  readonly name: string;
}

/** `26812461` — rename the sheet identified by `gid`. */
export interface SheetsRenameSheet {
  readonly op: "rename-sheet";
  readonly gid: Gid;
  readonly name: string;
}

/** `24502104` — insert `count` rows/cols at `index` in sheet `gid`. */
export interface SheetsInsertDim {
  readonly op: "insert-dim";
  readonly gid: Gid;
  readonly index: number;
  readonly count: number;
  readonly dim: Dimension;
}

/** `25037233` — delete `count` rows/cols at `index` in sheet `gid`. */
export interface SheetsDeleteDim {
  readonly op: "delete-dim";
  readonly gid: Gid;
  readonly index: number;
  readonly count: number;
  readonly dim: Dimension;
}

/**
 * `25813757` — the style companion emitted alongside a structural insert. v1
 * recognizes it as inert (the inserted row/col already defaults to no styling),
 * so it neither changes values nor raises a fidelity notice.
 */
export interface SheetsCellStyleAdjust {
  readonly op: "cell-style-adjust";
}

/** `28950036` — spreadsheet settings (locale/timezone/default format). Inert in v1. */
export interface SheetsSettings {
  readonly op: "settings";
}

/** `25104121` / `149980211` — snapshot/metadata markers. Recognized + inert. */
export interface SheetsMarker {
  readonly op: "marker";
}

/**
 * An unrecognized wire opcode. Privacy-safe by construction (mirrors the Docs
 * `UnknownOp`): carries ONLY the opcode and the byte length of the skipped
 * payload — never verbatim content. Lets decoding continue and drives the
 * fidelity notice.
 */
export interface SheetsUnknownOp {
  readonly op: "unknown";
  readonly opCode: string;
  readonly byteLength: number;
  readonly revisionId: RevisionId;
}

/**
 * Closed-world discriminated union of every Sheets operation the core
 * understands. `sheets-reconstruction/apply.ts` switches over this with a
 * `never` exhaustiveness default — adding a variant here without a matching
 * apply arm is a compile error.
 */
export type SheetsOperation =
  | SheetsTxnWrapper
  | SheetsCellMutation
  | SheetsAddSheet
  | SheetsRenameSheet
  | SheetsInsertDim
  | SheetsDeleteDim
  | SheetsCellStyleAdjust
  | SheetsSettings
  | SheetsMarker
  | SheetsUnknownOp;

/**
 * One decoded Sheets revision: kind-agnostic metadata ({@link RevisionMeta})
 * plus the typed ops and the runtime `modelVersion`. `modelVersionMismatch` is
 * true when the payload's modelVersion differs from
 * `SHEETS_MODEL_BASELINE` (R9) — the reconstruction core then raises a soft
 * fidelity signal.
 */
export interface SheetsDecodedRevision extends RevisionMeta {
  readonly operations: readonly SheetsOperation[];
  readonly modelVersion: number;
  readonly modelVersionMismatch: boolean;
}
