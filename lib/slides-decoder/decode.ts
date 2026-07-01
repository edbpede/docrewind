// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides (Punch) JSON → typed operations (ground truth: live capture 2026-07-01).
// The input is ALREADY-PARSED JSON handed over by the transport after framing +
// schema gating; this module never strips framing and never imports the protocol
// layer.
//
// The funnel is OPEN-WORLD: it switches over the small integer opcode and degrades
// any unrecognized opcode (or a known opcode with a malformed payload) to
// `SlidesUnknownOp` — never a throw, never a `never`. The closed-world `never`
// exhaustiveness gate lives in `slides-reconstruction/apply.ts`.
//
// The 4 changelog tuple-position constants are DUPLICATED here (not shared with
// the Docs/Sheets decoders) so the decode grammars stay decoupled — only the
// shared *type* `RevisionMeta` is common, not the per-op reading code.

import type { RevisionId } from "../domain/ids";
import {
  asRevisionId,
  asSessionId,
  asUserId,
  PRE_HISTORY_REVISION,
  unsafeAsRevisionId,
} from "../domain/ids";
import {
  type PageId,
  SLIDES_OPCODE,
  type SlidesDecodedRevision,
  type SlidesOperation,
  type SlidesPageType,
  type SlidesTheme,
  type SlidesUnknownOp,
  type Transform,
  unsafeAsPageId,
  unsafeAsShapeId,
} from "./types";
import { SLIDES_MODEL_BASELINE } from "./version";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow to a non-negative integer (0-indexed wire convention), or undefined. */
function asNonNegInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Narrow to any finite number (transform coordinates are fractional), or undefined. */
function asFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Non-empty string, or undefined. */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function unknownOp(raw: unknown, opCode: string, revisionId: RevisionId): SlidesUnknownOp {
  return {
    op: "unknown",
    opCode: opCode.length > 0 ? opCode : "(missing)",
    byteLength: byteLengthOf(raw),
    revisionId,
  };
}

/** Parse a `[scaleX, shearY, shearX, scaleY, translateX, translateY]` matrix. */
function decodeTransform(raw: unknown): Transform | null {
  if (!Array.isArray(raw) || raw.length < 6) return null;
  const scaleX = asFinite(raw[0]);
  const shearY = asFinite(raw[1]);
  const shearX = asFinite(raw[2]);
  const scaleY = asFinite(raw[3]);
  const translateX = asFinite(raw[4]);
  const translateY = asFinite(raw[5]);
  if (
    scaleX === undefined ||
    shearY === undefined ||
    shearX === undefined ||
    scaleY === undefined ||
    translateX === undefined ||
    translateY === undefined
  ) {
    return null;
  }
  return { scaleX, shearY, shearX, scaleY, translateX, translateY };
}

/** Map the wire `pageType` (0/1/2) to a {@link SlidesPageType}, or null. */
function pageTypeOf(raw: unknown): SlidesPageType | null {
  switch (raw) {
    case 0:
      return "slide";
    case 1:
      return "layout";
    case 2:
      return "master";
    default:
      return null;
  }
}

/**
 * Extract a theme palette from a DEFINE_PAGE payload (`args[4]`). A themed page
 * carries `[…, [name, [hexColor, …]], …]`; a plain master/layout page carries `[]`.
 * Returns the first `[name, palette]` pair whose palette is all strings, else null.
 */
function decodeTheme(raw: unknown): SlidesTheme | null {
  if (!Array.isArray(raw)) return null;
  for (const entry of raw) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === "string" &&
      Array.isArray(entry[1]) &&
      entry[1].length > 0 &&
      entry[1].every((c) => typeof c === "string")
    ) {
      return { name: entry[0], palette: entry[1] as string[] };
    }
  }
  return null;
}

/** Find the layout family name in a DECLARE_PLACEHOLDER props block (last string). */
function layoutTypeOf(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  let found: string | null = null;
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) found = entry;
  }
  return found;
}

function decodePageSize(raw: unknown[], full: unknown, revisionId: RevisionId): SlidesOperation {
  const size = raw[1];
  if (!Array.isArray(size)) return unknownOp(full, String(SLIDES_OPCODE.SET_PAGE_SIZE), revisionId);
  const width = asFinite(size[0]);
  const height = asFinite(size[1]);
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return unknownOp(full, String(SLIDES_OPCODE.SET_PAGE_SIZE), revisionId);
  }
  return { op: "page-size", width, height };
}

function decodeCreateShape(raw: unknown[], full: unknown, revisionId: RevisionId): SlidesOperation {
  const shapeId = asNonEmptyString(raw[1]);
  const shapeType = asFinite(raw[2]);
  const parentId = asNonEmptyString(raw[5]);
  if (shapeId === undefined || shapeType === undefined || parentId === undefined) {
    return unknownOp(full, String(SLIDES_OPCODE.CREATE_SHAPE), revisionId);
  }
  return {
    op: "create-shape",
    shapeId: unsafeAsShapeId(shapeId),
    parentId: unsafeAsPageId(parentId),
    shapeType,
    transform: decodeTransform(raw[3]),
  };
}

function decodeDefinePage(raw: unknown[], full: unknown, revisionId: RevisionId): SlidesOperation {
  const pageId = asNonEmptyString(raw[1]);
  const pageType = pageTypeOf(raw[3]);
  if (pageId === undefined || pageType === null) {
    return unknownOp(full, String(SLIDES_OPCODE.DEFINE_PAGE), revisionId);
  }
  return {
    op: "define-page",
    pageId: unsafeAsPageId(pageId),
    pageType,
    theme: decodeTheme(raw[4]),
  };
}

function decodeInsertText(raw: unknown[], full: unknown, revisionId: RevisionId): SlidesOperation {
  const shapeId = asNonEmptyString(raw[1]);
  const offset = asNonNegInt(raw[3]);
  const text = raw[4];
  if (shapeId === undefined || offset === undefined || typeof text !== "string") {
    return unknownOp(full, String(SLIDES_OPCODE.INSERT_TEXT), revisionId);
  }
  return { op: "insert-text", shapeId: unsafeAsShapeId(shapeId), offset, text };
}

function decodeDeleteText(raw: unknown[], full: unknown, revisionId: RevisionId): SlidesOperation {
  const shapeId = asNonEmptyString(raw[1]);
  const start = asNonNegInt(raw[3]);
  const end = asNonNegInt(raw[4]);
  if (shapeId === undefined || start === undefined || end === undefined || end < start) {
    return unknownOp(full, String(SLIDES_OPCODE.DELETE_TEXT), revisionId);
  }
  return { op: "delete-text", shapeId: unsafeAsShapeId(shapeId), start, end };
}

function decodeDeclarePlaceholder(
  raw: unknown[],
  full: unknown,
  revisionId: RevisionId,
): SlidesOperation {
  const target = raw[1];
  const pageId = Array.isArray(target) ? asNonEmptyString(target[0]) : asNonEmptyString(target);
  if (pageId === undefined) {
    return unknownOp(full, String(SLIDES_OPCODE.DECLARE_PLACEHOLDER), revisionId);
  }
  return {
    op: "declare-placeholder",
    pageId: unsafeAsPageId(pageId),
    layoutType: layoutTypeOf(raw[3]),
  };
}

/** Decode one Slides op array `[opcode, …]` into a typed {@link SlidesOperation}. */
function decodeOp(raw: unknown, revisionId: RevisionId): SlidesOperation {
  if (!Array.isArray(raw)) return unknownOp(raw, "(non-array)", revisionId);
  const opcode = raw[0];
  if (typeof opcode !== "number") return unknownOp(raw, "(non-numeric)", revisionId);
  switch (opcode) {
    case SLIDES_OPCODE.TXN: {
      const subs = raw[1];
      if (!Array.isArray(subs)) return unknownOp(raw, String(opcode), revisionId);
      return { op: "txn", ops: subs.map((sub) => decodeOp(sub, revisionId)) };
    }
    case SLIDES_OPCODE.SET_PAGE_SIZE:
      return decodePageSize(raw, raw, revisionId);
    case SLIDES_OPCODE.CREATE_SHAPE:
      return decodeCreateShape(raw, raw, revisionId);
    case SLIDES_OPCODE.DEFINE_PAGE:
      return decodeDefinePage(raw, raw, revisionId);
    case SLIDES_OPCODE.INSERT_TEXT:
      return decodeInsertText(raw, raw, revisionId);
    case SLIDES_OPCODE.DELETE_TEXT:
      return decodeDeleteText(raw, raw, revisionId);
    case SLIDES_OPCODE.DECLARE_PLACEHOLDER:
      return decodeDeclarePlaceholder(raw, raw, revisionId);
    case SLIDES_OPCODE.SET_SHAPE_PROP:
      return { op: "shape-prop" };
    case SLIDES_OPCODE.CREATE_PAGE:
      return { op: "create-page" };
    case SLIDES_OPCODE.PAGE_MEMBERSHIP:
      return { op: "page-membership" };
    case SLIDES_OPCODE.STYLE_RANGE:
      return { op: "text-style" };
    case SLIDES_OPCODE.MARKER:
      return { op: "marker" };
    case SLIDES_OPCODE.LIST_ENTITY:
      return { op: "list-entity" };
    case SLIDES_OPCODE.DEFAULT_STYLE:
      return { op: "default-style" };
    default:
      return unknownOp(raw, String(opcode), revisionId);
  }
}

// Positional layout of a LIVE changelog tuple — IDENTICAL to Docs/Sheets:
// `[ op, time(ms), userId, revisionId, sessionId, … ]`. Duplicated (not shared) so
// the decode grammars stay decoupled.
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
  return typeof raw === "number" && Number.isFinite(raw) ? raw : SLIDES_MODEL_BASELINE;
}

function decodeRevision(
  entry: unknown,
  index: number,
  modelVersion: number,
): SlidesDecodedRevision {
  const env = normalizeEntry(entry);
  const revisionId = asRevisionIdOr(env.revisionId, index);
  return {
    revisionId,
    userId: asOptionalUserId(env.userId),
    sessionId: asOptionalSessionId(env.sessionId),
    time: asOptionalTime(env.time),
    operations: [decodeOp(env.op, revisionId)],
    modelVersion,
    modelVersionMismatch: modelVersion !== SLIDES_MODEL_BASELINE,
  };
}

/**
 * Decode an already-parsed Slides `revisions/load` payload into typed revisions.
 * Pure: takes JSON (never a string/bytes), never throws on unknown ops, never
 * imports the protocol layer. Malformed/unrecognized ops degrade to
 * `SlidesUnknownOp`.
 */
export function decodeSlidesOperations(parsed: unknown): SlidesDecodedRevision[] {
  const modelVersion = readModelVersion(parsed);
  return readChangelog(parsed).map((entry, index) => decodeRevision(entry, index, modelVersion));
}

/** Flatten + decode a base/snapshot op list under the pre-history revision id. */
function decodeSnapshotOps(
  snapshot: readonly unknown[],
  revisionId: RevisionId,
): SlidesOperation[] {
  const ops: SlidesOperation[] = [];
  for (const item of snapshot) {
    if (Array.isArray(item) && typeof item[0] === "number") {
      // A bare op array `[opcode, …]`.
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
 * Decode the `chunkedSnapshot` base content. The snapshot is the presentation
 * state BEFORE the payload's first changelog revision; for a window starting at
 * revision 1 it declares the initial slide/master/layout pages (e.g. the first
 * slide "p"). Returned ops are tagged with the pre-history revision id so the
 * seeded content renders as accepted base state, unattributed to any fetched
 * author. Pure: never throws.
 */
export function decodeSlidesSnapshot(parsed: unknown): SlidesOperation[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.chunkedSnapshot)) {
    return [];
  }
  return decodeSnapshotOps(parsed.chunkedSnapshot, PRE_HISTORY_REVISION);
}

// Re-export the shared page-id brand helper so reconstruction has one import
// surface for the ids the decoder produced (matches the Sheets `unsafeAsGid`
// re-export pattern via model.ts).
export type { PageId };
