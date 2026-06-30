// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sheets (Ritz) JSON → typed operations (plan P1 / ground truth:
// `.omc/plans/sheets-ritz-format-findings.md`). The input is ALREADY-PARSED JSON
// handed over by the transport after framing + schema gating; this module never
// strips framing and never imports the protocol layer.
//
// The funnel is OPEN-WORLD: it switches over the numeric opcode and degrades any
// unrecognized opcode (or a known opcode with a malformed payload) to
// `SheetsUnknownOp` — never a throw, never a `never`. The closed-world `never`
// exhaustiveness gate lives in `sheets-reconstruction/apply.ts`.
//
// The 4 changelog tuple-position constants are DUPLICATED here (not shared with
// the Docs decoder) so the two decode grammars stay decoupled — only the shared
// *type* `RevisionMeta` is common, not the per-op reading code.

import type { RevisionId } from "../domain/ids";
import {
  asRevisionId,
  asSessionId,
  asUserId,
  PRE_HISTORY_REVISION,
  unsafeAsRevisionId,
} from "../domain/ids";
import {
  CELL_CONTENT_TAG,
  type CellContent,
  type CellFormat,
  CLEAR_FORMAT_SENTINEL,
  CLEAR_VALUE_SENTINEL,
  type Dimension,
  type Gid,
  SHEETS_OPCODE,
  type SheetsDecodedRevision,
  type SheetsOperation,
  type SheetsRange,
  type SheetsUnknownOp,
  unsafeAsGid,
} from "./types";
import { SHEETS_MODEL_BASELINE } from "./version";

/** Format-block entry id for the bold visual style mask (capture 2026-06-30). */
const BOLD_MASK = 16384;
/** Format-block entry id for the number-format value pattern. */
const NUMBER_FORMAT_PROP = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow to a non-negative integer (0-indexed wire convention), or undefined. */
function asNonNegInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Narrow to a positive integer (counts), or undefined. */
function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Byte length of the skipped payload — a NUMBER only, never its content. */
function byteLengthOf(raw: unknown): number {
  try {
    const serialized = JSON.stringify(raw);
    return typeof serialized === "string" ? serialized.length : 0;
  } catch {
    return 0;
  }
}

function unknownOp(raw: unknown, opCode: string, revisionId: RevisionId): SheetsUnknownOp {
  return {
    op: "unknown",
    opCode: opCode.length > 0 ? opCode : "(missing)",
    byteLength: byteLengthOf(raw),
    revisionId,
  };
}

/** Parse a `[null, gid, rowStart, rowEnd, colStart, colEnd]` range (half-open, 0-indexed). */
function decodeRange(raw: unknown): SheetsRange | null {
  if (!Array.isArray(raw)) return null;
  const gidRaw = raw[1];
  const rowStart = asNonNegInt(raw[2]);
  const rowEnd = asNonNegInt(raw[3]);
  const colStart = asNonNegInt(raw[4]);
  const colEnd = asNonNegInt(raw[5]);
  if (
    typeof gidRaw !== "string" ||
    gidRaw.length === 0 ||
    rowStart === undefined ||
    rowEnd === undefined ||
    colStart === undefined ||
    colEnd === undefined
  ) {
    return null;
  }
  return { gid: unsafeAsGid(gidRaw), rowStart, rowEnd, colStart, colEnd };
}

/** Decode a concrete value object/array (the inner CONTENT of a value-set payload). */
function decodeValue(content: unknown): CellContent {
  if (Array.isArray(content)) {
    // [null, typeTag, text] — string/formula.
    const text = content[2];
    if (typeof text === "string") {
      return text.startsWith("=") ? { kind: "formula", formula: text } : { kind: "text", text };
    }
    return { kind: "none" };
  }
  if (isRecord(content)) {
    const value = content["3"]; // the value field
    if (typeof value === "number") return { kind: "number", value };
    if (typeof value === "string") {
      return value.startsWith("=")
        ? { kind: "formula", formula: value }
        : { kind: "text", text: value };
    }
  }
  return { kind: "none" };
}

/** Decode the CellMutation PAYLOAD (args[2]) into the cell content change. */
function decodeContent(payload: unknown): CellContent {
  if (Array.isArray(payload)) {
    // Value-set wrapper: [null, CELL_CONTENT_TAG, n, CONTENT, ...].
    if (payload[1] !== CELL_CONTENT_TAG) return { kind: "none" };
    return decodeValue(payload[3]);
  }
  if (isRecord(payload)) {
    if (payload["1"] === CLEAR_VALUE_SENTINEL) return { kind: "clear" };
    // CLEAR_FORMAT_SENTINEL and format-only objects leave the value unchanged.
    return { kind: "none" };
  }
  return { kind: "none" };
}

/** Decode the visual + value-format from the PAYLOAD + FORMATBLOCK (args[2]/args[3]). */
function decodeFormat(payload: unknown, formatblock: unknown): CellFormat {
  const out: {
    bold?: boolean;
    italic?: boolean;
    numberFormat?: string;
    clearFormat?: boolean;
  } = {};
  if (isRecord(payload) && payload["1"] === CLEAR_FORMAT_SENTINEL) {
    out.clearFormat = true;
  }
  if (isRecord(formatblock) && Array.isArray(formatblock["2"])) {
    for (const entry of formatblock["2"]) {
      if (!isRecord(entry)) continue;
      const prop = entry["2"];
      if (prop === BOLD_MASK) {
        const on = entry["17"];
        out.bold = on === 1 || on === true;
      } else if (prop === NUMBER_FORMAT_PROP) {
        const spec = entry["3"]; // [null, 4, pattern]
        if (Array.isArray(spec) && typeof spec[2] === "string") {
          out.numberFormat = spec[2];
        }
      }
      // Other masks (italic/color/…) are not captured yet → dropped silently.
    }
  }
  return out;
}

/** Read a sheet name out of a `{"1":[[null,0,0,"<name>"]]}` props block. */
function readSheetName(props: unknown): string | null {
  if (!isRecord(props)) return null;
  const list = props["1"];
  if (!Array.isArray(list)) return null;
  const first = list[0];
  if (!Array.isArray(first)) return null;
  const name = first[3];
  return typeof name === "string" ? name : null;
}

function decodeCell(args: unknown, raw: unknown, revisionId: RevisionId): SheetsOperation {
  if (!Array.isArray(args)) return unknownOp(raw, String(SHEETS_OPCODE.CELL_MUTATION), revisionId);
  const range = decodeRange(args[1]);
  if (range === null) return unknownOp(raw, String(SHEETS_OPCODE.CELL_MUTATION), revisionId);
  return {
    op: "cell",
    range,
    content: decodeContent(args[2]),
    format: decodeFormat(args[2], args[3]),
  };
}

function decodeAddSheet(args: unknown, raw: unknown, revisionId: RevisionId): SheetsOperation {
  if (!Array.isArray(args)) return unknownOp(raw, String(SHEETS_OPCODE.ADD_SHEET), revisionId);
  const index = asNonNegInt(args[1]);
  const gidRaw = args[3];
  if (index === undefined || typeof gidRaw !== "string" || gidRaw.length === 0) {
    return unknownOp(raw, String(SHEETS_OPCODE.ADD_SHEET), revisionId);
  }
  return { op: "add-sheet", gid: unsafeAsGid(gidRaw), index, name: readSheetName(args[4]) ?? "" };
}

function decodeRename(args: unknown, raw: unknown, revisionId: RevisionId): SheetsOperation {
  if (!Array.isArray(args)) return unknownOp(raw, String(SHEETS_OPCODE.RENAME_SHEET), revisionId);
  const gidRaw = args[1];
  const name = readSheetName(args[2]);
  if (typeof gidRaw !== "string" || gidRaw.length === 0 || name === null) {
    return unknownOp(raw, String(SHEETS_OPCODE.RENAME_SHEET), revisionId);
  }
  return { op: "rename-sheet", gid: unsafeAsGid(gidRaw), name };
}

function decodeDim(
  args: unknown,
  kind: "insert-dim" | "delete-dim",
  opcode: number,
  raw: unknown,
  revisionId: RevisionId,
): SheetsOperation {
  if (!Array.isArray(args)) return unknownOp(raw, String(opcode), revisionId);
  const gidRaw = args[1];
  const index = asNonNegInt(args[2]);
  const count = asPositiveInt(args[3]);
  const dimRaw = args[4];
  if (
    typeof gidRaw !== "string" ||
    gidRaw.length === 0 ||
    index === undefined ||
    count === undefined ||
    (dimRaw !== 0 && dimRaw !== 1)
  ) {
    return unknownOp(raw, String(opcode), revisionId);
  }
  const dim: Dimension = dimRaw === 1 ? "col" : "row";
  return { op: kind, gid: unsafeAsGid(gidRaw), index, count, dim };
}

/** Decode a merge op: the merged range lives at `args["1"]` (decodeRange layout). */
function decodeMerge(args: unknown, raw: unknown, revisionId: RevisionId): SheetsOperation {
  if (!isRecord(args)) return unknownOp(raw, String(SHEETS_OPCODE.MERGE), revisionId);
  const range = decodeRange(args["1"]);
  if (range === null) return unknownOp(raw, String(SHEETS_OPCODE.MERGE), revisionId);
  return { op: "merge", range };
}

/**
 * Parse an opaque-object anchor `[null, _, gid, [null, row, col], …]` into a
 * point. The gid is at index 2 and the cell address is the nested array at index
 * 3 (row at `cell[1]`, col at `cell[2]`).
 */
function decodeAnchor(raw: unknown): { gid: Gid; row: number; col: number } | null {
  if (!Array.isArray(raw)) return null;
  const gidRaw = raw[2];
  const cell = raw[3];
  if (typeof gidRaw !== "string" || gidRaw.length === 0 || !Array.isArray(cell)) {
    return null;
  }
  const row = asNonNegInt(cell[1]);
  const col = asNonNegInt(cell[2]);
  if (row === undefined || col === undefined) return null;
  return { gid: unsafeAsGid(gidRaw), row, col };
}

/**
 * Decode a chart/image object. The inner spec at `inner[2]` discriminates the
 * KIND by SHAPE (per findings): an object with `"1" === 3` is a chart, an array
 * with `[1] === 2` is an image. Anything else (or a bad anchor) → unknownOp; the
 * decoder never guesses.
 */
function decodeOpaque(args: unknown, raw: unknown, revisionId: RevisionId): SheetsOperation {
  const opcode = String(SHEETS_OPCODE.OPAQUE_OBJECT);
  if (!isRecord(args)) return unknownOp(raw, opcode, revisionId);
  const inner = args["1"];
  if (!Array.isArray(inner)) return unknownOp(raw, opcode, revisionId);
  const spec = inner[2];
  let kind: "chart" | "image";
  if (isRecord(spec) && spec["1"] === 3) {
    kind = "chart";
  } else if (Array.isArray(spec) && spec[1] === 2) {
    kind = "image";
  } else {
    return unknownOp(raw, opcode, revisionId);
  }
  const anchor = decodeAnchor(inner[3]);
  if (anchor === null) return unknownOp(raw, opcode, revisionId);
  return { op: "opaque", kind, gid: anchor.gid, row: anchor.row, col: anchor.col };
}

/** Decode a sheet reorder op: `[null, from, to]` → two non-negative indices. */
function decodeReorder(args: unknown, raw: unknown, revisionId: RevisionId): SheetsOperation {
  if (!Array.isArray(args)) return unknownOp(raw, String(SHEETS_OPCODE.REORDER_SHEET), revisionId);
  const from = asNonNegInt(args[1]);
  const to = asNonNegInt(args[2]);
  if (from === undefined || to === undefined) {
    return unknownOp(raw, String(SHEETS_OPCODE.REORDER_SHEET), revisionId);
  }
  return { op: "reorder-sheet", from, to };
}

/** Decode one Sheets op array `[opcode, args]` into a typed {@link SheetsOperation}. */
function decodeOp(raw: unknown, revisionId: RevisionId): SheetsOperation {
  if (!Array.isArray(raw)) return unknownOp(raw, "(non-array)", revisionId);
  const opcode = raw[0];
  if (typeof opcode !== "number") return unknownOp(raw, "(non-numeric)", revisionId);
  const args = raw[1];
  switch (opcode) {
    case SHEETS_OPCODE.TXN: {
      if (!Array.isArray(args)) return unknownOp(raw, String(opcode), revisionId);
      return { op: "txn", ops: args.map((sub) => decodeOp(sub, revisionId)) };
    }
    case SHEETS_OPCODE.CELL_MUTATION:
      return decodeCell(args, raw, revisionId);
    case SHEETS_OPCODE.ADD_SHEET:
      return decodeAddSheet(args, raw, revisionId);
    case SHEETS_OPCODE.RENAME_SHEET:
      return decodeRename(args, raw, revisionId);
    case SHEETS_OPCODE.INSERT_DIM:
      return decodeDim(args, "insert-dim", opcode, raw, revisionId);
    case SHEETS_OPCODE.DELETE_DIM:
      return decodeDim(args, "delete-dim", opcode, raw, revisionId);
    case SHEETS_OPCODE.CELL_STYLE_ADJUST:
      return { op: "cell-style-adjust" };
    case SHEETS_OPCODE.SETTINGS:
      return { op: "settings" };
    case SHEETS_OPCODE.MARKER_SNAPSHOT:
    case SHEETS_OPCODE.MARKER_METADATA:
      return { op: "marker" };
    case SHEETS_OPCODE.MERGE:
      return decodeMerge(args, raw, revisionId);
    case SHEETS_OPCODE.OPAQUE_OBJECT:
      return decodeOpaque(args, raw, revisionId);
    case SHEETS_OPCODE.COND_FORMAT:
      return { op: "cond-format" };
    case SHEETS_OPCODE.CHART_DATASOURCE:
      return { op: "chart-datasource" };
    case SHEETS_OPCODE.REORDER_SHEET:
      return decodeReorder(args, raw, revisionId);
    default:
      return unknownOp(raw, String(opcode), revisionId);
  }
}

// Positional layout of a LIVE changelog tuple — IDENTICAL to Docs (findings §
// "Changelog tuple"): `[ op, time(ms), userId, revisionId, sessionId, seq, … ]`.
// Duplicated (not shared) so the decode grammars stay decoupled.
const TUPLE_TIME = 1;
const TUPLE_USER_ID = 2;
const TUPLE_REVISION_ID = 3;
const TUPLE_SESSION_ID = 4;

interface EntryEnvelope {
  readonly op: unknown;
  readonly revisionId: unknown;
  readonly userId: unknown;
  readonly sessionId: unknown;
  readonly time: unknown;
}

function normalizeEntry(entry: unknown): EntryEnvelope {
  if (Array.isArray(entry)) {
    return {
      op: entry[0],
      revisionId: entry[TUPLE_REVISION_ID],
      userId: entry[TUPLE_USER_ID],
      sessionId: entry[TUPLE_SESSION_ID],
      time: entry[TUPLE_TIME],
    };
  }
  // Object entry (synthetic fixtures): op + metadata coexist on the record.
  return {
    op: isRecord(entry) ? entry.op : entry,
    revisionId: isRecord(entry) ? entry.revision_id : undefined,
    userId: isRecord(entry) ? entry.user_id : undefined,
    sessionId: isRecord(entry) ? entry.session_id : undefined,
    time: isRecord(entry) ? entry.time : undefined,
  };
}

function asRevisionIdOr(raw: unknown, index: number): RevisionId {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return asRevisionId(raw);
  }
  return unsafeAsRevisionId(index + 1);
}

function asOptionalUserId(raw: unknown): ReturnType<typeof asUserId> | null {
  return typeof raw === "string" && raw.trim().length > 0 ? asUserId(raw) : null;
}

function asOptionalSessionId(raw: unknown): ReturnType<typeof asSessionId> | null {
  return typeof raw === "string" && raw.trim().length > 0 ? asSessionId(raw) : null;
}

function asOptionalTime(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readChangelog(parsed: unknown): readonly unknown[] {
  if (isRecord(parsed) && Array.isArray(parsed.changelog)) {
    return parsed.changelog;
  }
  return Array.isArray(parsed) ? parsed : [];
}

/** Read the runtime `modelVersion` off the envelope, defaulting to the baseline. */
function readModelVersion(parsed: unknown): number {
  const raw = isRecord(parsed) ? parsed.modelVersion : undefined;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : SHEETS_MODEL_BASELINE;
}

function decodeRevision(
  entry: unknown,
  index: number,
  modelVersion: number,
): SheetsDecodedRevision {
  const env = normalizeEntry(entry);
  const revisionId = asRevisionIdOr(env.revisionId, index);
  return {
    revisionId,
    userId: asOptionalUserId(env.userId),
    sessionId: asOptionalSessionId(env.sessionId),
    time: asOptionalTime(env.time),
    operations: [decodeOp(env.op, revisionId)],
    modelVersion,
    modelVersionMismatch: modelVersion !== SHEETS_MODEL_BASELINE,
  };
}

/**
 * Decode an already-parsed Sheets `revisions/load` payload into typed revisions.
 * Pure: takes JSON (never a string/bytes), never throws on unknown ops, never
 * imports the protocol layer. Malformed/unrecognized ops degrade to
 * `SheetsUnknownOp`.
 */
export function decodeSheetsOperations(parsed: unknown): SheetsDecodedRevision[] {
  const modelVersion = readModelVersion(parsed);
  return readChangelog(parsed).map((entry, index) => decodeRevision(entry, index, modelVersion));
}

/** Flatten + decode a base/snapshot op list under the pre-history revision id. */
function decodeSnapshotOps(
  snapshot: readonly unknown[],
  revisionId: RevisionId,
): SheetsOperation[] {
  const ops: SheetsOperation[] = [];
  for (const item of snapshot) {
    if (Array.isArray(item) && typeof item[0] === "number") {
      // A bare op array `[opcode, args]`.
      ops.push(decodeOp(item, revisionId));
    } else if (Array.isArray(item)) {
      // A chunk: a sub-array of op arrays.
      for (const sub of item) {
        ops.push(decodeOp(sub, revisionId));
      }
    }
  }
  return ops;
}

/**
 * Decode the `chunkedSnapshot` base content (CAPTURE P-iii). The snapshot is the
 * grid state BEFORE the payload's first changelog revision; for a window
 * starting at revision 1 it is empty. Returned ops are tagged with the
 * pre-history revision id so the seeded content renders as accepted base state,
 * unattributed to any fetched author. Pure: never throws.
 */
export function decodeSheetsSnapshot(parsed: unknown): SheetsOperation[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.chunkedSnapshot)) {
    return [];
  }
  return decodeSnapshotOps(parsed.chunkedSnapshot, PRE_HISTORY_REVISION);
}
