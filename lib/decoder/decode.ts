// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Operation grammar ported from the MIT-licensed `harvard-vpal/gdocrevisions`
// (https://github.com/harvard-vpal/gdocrevisions, last release 2018) and
// corroborated by the 2014 Google Docs teardown — see PRD Appendix A.2.
//
//   Copyright (c) 2018 Harvard VPAL — MIT License (operation vocabulary).
//   The decode rules below derive from that work and are reproduced under the
//   MIT terms alongside DocRewind's AGPL-3.0-or-later license, per PRD §11.6.
//
// JSON -> typed Operations (plan T3 / R1, R2, R5). The input is ALREADY-PARSED
// JSON handed over by the protocol layer after schema detection; this module
// never strips/parses framing and never imports the protocol module. The funnel
// switches over the RAW wire `ty: string` with `default -> UnknownOp` and NO
// `never` — an unrecognized wire op is expected and handled, not a type error.
// The closed-world `never` exhaustiveness gate lives in reconstruction/apply.ts.

import type { RevisionId } from "../domain/ids";
import { asRevisionId, asSessionId, asUserId, unsafeAsRevisionId } from "../domain/ids";
import type { DecodedRevision } from "../domain/model";
import type { OpaqueStructure, Operation, UnknownOp } from "./types";

const OPAQUE_STRUCTURES: ReadonlySet<string> = new Set<OpaqueStructure>([
  "image",
  "table",
  "footnote",
  "equation",
  "drawing",
  "list-format",
  "comment-ref",
]);

/** Safe property read: returns `undefined` for non-records and missing keys. */
function field(raw: unknown, key: string): unknown {
  return isRecord(raw) ? raw[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow to a string, or `undefined` if the value is not a string. */
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Narrow to a positive integer (1-indexed wire convention), or `undefined`. */
function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Byte length of the skipped payload — a NUMBER only, never its content (R5). */
function byteLengthOf(raw: unknown): number {
  try {
    const serialized = JSON.stringify(raw);
    return typeof serialized === "string" ? serialized.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Construct a privacy-safe UnknownOp carrying ONLY the wire op-code and the
 * byte length of the skipped payload — never any verbatim text (R5, §13.7).
 */
function unknownOp(raw: unknown, opCode: string, revisionId: RevisionId): UnknownOp {
  return {
    ty: "unknown",
    opCode: opCode.length > 0 ? opCode : "(missing)",
    byteLength: byteLengthOf(raw),
    revisionId,
  };
}

/**
 * The open-world funnel: switch over the raw wire `ty`. Known literals build
 * their typed variant; a known op with malformed fields and any unrecognized
 * `ty` degrade to UnknownOp. There is intentionally NO `never` here.
 */
function decodeOperation(raw: unknown, revisionId: RevisionId): Operation {
  const ty = asString(field(raw, "ty")) ?? "";
  switch (ty) {
    case "is": {
      const s = asString(field(raw, "s"));
      const ibi = asPositiveInt(field(raw, "ibi"));
      if (s === undefined || ibi === undefined) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "is", s, ibi };
    }
    case "ds": {
      const si = asPositiveInt(field(raw, "si"));
      const ei = asPositiveInt(field(raw, "ei"));
      if (si === undefined || ei === undefined || si > ei) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "ds", si, ei };
    }
    case "mlti": {
      const mts = field(raw, "mts");
      if (!Array.isArray(mts)) {
        return unknownOp(raw, ty, revisionId);
      }
      return {
        ty: "mlti",
        mts: mts.map((sub) => decodeOperation(sub, revisionId)),
      };
    }
    case "iss": {
      const s = asString(field(raw, "s"));
      const ibi = asPositiveInt(field(raw, "ibi"));
      if (s === undefined || ibi === undefined) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "iss", s, ibi };
    }
    case "dss": {
      const si = asPositiveInt(field(raw, "si"));
      const ei = asPositiveInt(field(raw, "ei"));
      if (si === undefined || ei === undefined || si > ei) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "dss", si, ei };
    }
    case "msfd": {
      const si = asPositiveInt(field(raw, "si"));
      const ei = asPositiveInt(field(raw, "ei"));
      if (si === undefined || ei === undefined || si > ei) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "msfd", si, ei };
    }
    case "usfd": {
      const si = asPositiveInt(field(raw, "si"));
      const ei = asPositiveInt(field(raw, "ei"));
      if (si === undefined || ei === undefined || si > ei) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "usfd", si, ei };
    }
    case "opaque": {
      const structureRaw = asString(field(raw, "structure"));
      const position = asPositiveInt(field(raw, "position"));
      if (
        structureRaw === undefined ||
        !OPAQUE_STRUCTURES.has(structureRaw) ||
        position === undefined
      ) {
        return unknownOp(raw, ty, revisionId);
      }
      return {
        ty: "opaque",
        structure: structureRaw as OpaqueStructure,
        position,
        revisionId,
      };
    }
    default:
      // Open-world: an unrecognized wire `ty` is expected — isolate + continue.
      return unknownOp(raw, ty, revisionId);
  }
}

/** Validate a RevisionId from a raw value, falling back to the 1-based position. */
function asRevisionIdOr(raw: unknown, index: number): RevisionId {
  const valid = asPositiveInt(raw);
  if (valid !== undefined) {
    return asRevisionId(valid);
  }
  // Fallback: the 1-based position is a guaranteed positive integer, so the
  // blind cast is safe — no validation is meaningful for a synthetic id.
  return unsafeAsRevisionId(index + 1);
}

/** Validate an optional branded id from a raw value, or null when absent/blank. */
function asOptionalUserId(raw: unknown): ReturnType<typeof asUserId> | null {
  return typeof raw === "string" && raw.trim().length > 0 ? asUserId(raw) : null;
}

function asOptionalSessionId(raw: unknown): ReturnType<typeof asSessionId> | null {
  return typeof raw === "string" && raw.trim().length > 0 ? asSessionId(raw) : null;
}

function asOptionalTime(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * One changelog entry's operation plus its attribution/timing metadata, lifted
 * out of whichever of the two accepted wire shapes the entry uses.
 */
interface EntryEnvelope {
  readonly op: unknown;
  readonly revisionId: unknown;
  readonly userId: unknown;
  readonly sessionId: unknown;
  readonly time: unknown;
}

// Positional layout of a LIVE changelog tuple. CORRECTED 2026-06-17 against a
// multi-session live capture: the stable per-AUTHOR id sits at position [2]
// (a constant ~20-digit obfuscated Gaia id, unchanged across every revision of a
// single-author doc), while position [4] holds a per-editing-SESSION token (a
// 16-hex value that rotates each session, `null` on system/setup revisions). The
// §24 single-session capture could not distinguish them — both were one constant
// value — so the original `[op, time, sessionId, revisionId, userId, …]` reading
// transposed the two, making one author surface as many "users" (one per session).
// True layout: `[ op, time(ms), userId, revisionId, sessionId, seq, … ]`.
// See PRD Appendix A.2.
const TUPLE_TIME = 1;
const TUPLE_USER_ID = 2;
const TUPLE_REVISION_ID = 3;
const TUPLE_SESSION_ID = 4;

/**
 * Normalize a changelog entry to its {@link EntryEnvelope}. TWO shapes are
 * accepted so the decoder is faithful to the live wire format AND to the
 * synthetic fixture corpus:
 *   • Live (2026): a positional TUPLE `[op, time, userId, revisionId, sessionId, …]`.
 *   • Synthetic fixtures: a flat OBJECT carrying the op fields alongside
 *     `revision_id`/`user_id`/`session_id`/`time` siblings.
 * Any other shape yields an envelope whose `op` degrades to UnknownOp downstream
 * — the open-world contract is preserved, never a throw.
 */
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
  // Object entry: the op fields and its metadata coexist on the same record.
  return {
    op: entry,
    revisionId: field(entry, "revision_id"),
    userId: field(entry, "user_id"),
    sessionId: field(entry, "session_id"),
    time: field(entry, "time"),
  };
}

/** Decode one changelog entry (one revision carrying one top-level operation). */
function decodeRevision(entry: unknown, index: number): DecodedRevision {
  const env = normalizeEntry(entry);
  const revisionId = asRevisionIdOr(env.revisionId, index);
  return {
    revisionId,
    userId: asOptionalUserId(env.userId),
    sessionId: asOptionalSessionId(env.sessionId),
    time: asOptionalTime(env.time),
    operations: [decodeOperation(env.op, revisionId)],
  };
}

function readChangelog(parsed: unknown): readonly unknown[] {
  if (isRecord(parsed) && Array.isArray(parsed.changelog)) {
    return parsed.changelog;
  }
  // Tolerate a bare top-level array as well; anything else yields no revisions.
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Decode an already-parsed changelog payload into typed revisions. Pure: takes
 * JSON (never a string/bytes), never throws on unknown ops, and never imports
 * the protocol layer (R1). Malformed or unrecognized entries degrade to
 * UnknownOp rather than aborting the decode.
 */
export function decodeOperations(parsed: unknown): DecodedRevision[] {
  return readChangelog(parsed).map((entry, index) => decodeRevision(entry, index));
}
