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
      if (si === undefined || ei === undefined) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "ds", si, ei };
    }
    case "mlti": {
      const mts = field(raw, "mts");
      const subs: readonly unknown[] = Array.isArray(mts) ? mts : [];
      return {
        ty: "mlti",
        mts: subs.map((sub) => decodeOperation(sub, revisionId)),
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
      if (si === undefined || ei === undefined) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "dss", si, ei };
    }
    case "msfd": {
      const si = asPositiveInt(field(raw, "si"));
      const ei = asPositiveInt(field(raw, "ei"));
      if (si === undefined || ei === undefined) {
        return unknownOp(raw, ty, revisionId);
      }
      return { ty: "msfd", si, ei };
    }
    case "usfd": {
      const si = asPositiveInt(field(raw, "si"));
      const ei = asPositiveInt(field(raw, "ei"));
      if (si === undefined || ei === undefined) {
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

/** Read a validated RevisionId from an entry, falling back to its 1-based index. */
function readRevisionId(entry: unknown, index: number): RevisionId {
  const raw = field(entry, "revision_id");
  const valid = asPositiveInt(raw);
  if (valid !== undefined) {
    return asRevisionId(valid);
  }
  // Fallback: the 1-based position is a guaranteed positive integer, so the
  // blind cast is safe — no validation is meaningful for a synthetic id.
  return unsafeAsRevisionId(index + 1);
}

/** Read an optional branded id field: validated value, or null when absent. */
function readOptionalUserId(entry: unknown): ReturnType<typeof asUserId> | null {
  const value = field(entry, "user_id");
  return typeof value === "string" && value.trim().length > 0 ? asUserId(value) : null;
}

function readOptionalSessionId(entry: unknown): ReturnType<typeof asSessionId> | null {
  const value = field(entry, "session_id");
  return typeof value === "string" && value.trim().length > 0 ? asSessionId(value) : null;
}

function readOptionalTime(entry: unknown): number | null {
  const value = field(entry, "time");
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Decode one changelog entry (one revision carrying one top-level operation). */
function decodeRevision(entry: unknown, index: number): DecodedRevision {
  const revisionId = readRevisionId(entry, index);
  return {
    revisionId,
    userId: readOptionalUserId(entry),
    sessionId: readOptionalSessionId(entry),
    time: readOptionalTime(entry),
    operations: [decodeOperation(entry, revisionId)],
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
