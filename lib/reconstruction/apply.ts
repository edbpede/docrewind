// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Apply semantics (plan T4 / Appendix A.2, R2, R3). This is the CLOSED-WORLD
// exhaustiveness gate: the switch over the typed `Operation` union ends in a
// `never` default, so deleting a variant from the union AND its arm here is a
// `tsc` error. `UnknownOp` and `OpaquePlaceholder` are explicit arms that never
// mutate text content.
//
// Wire indices (`ibi`, `si`, `ei`) address the LIVE (deletion-collapsed)
// document, per the real A.2 grammar: an accepted-deleted element no longer
// occupies a position. We retain tombstones physically (for time-travel) and
// map each live position to its physical array index on the fly. Suggested
// inserts and suggestion-marked-for-deletion elements remain live (visible), so
// they still occupy positions.

import type { OpaqueStructure, Operation } from "../decoder/types";
import type { RevisionId } from "../domain/ids";
import type { DecodedRevision } from "../domain/model";
import type { CharElement, DocumentModel, SuggestionState, TextChar } from "./model";
import { isEndOfBody } from "./model";

/** Physical index of the `livePos`-th (1-indexed) live element, or end-of-array. */
function physicalIndexOfLivePosition(chars: readonly CharElement[], livePos: number): number {
  let count = 0;
  for (let i = 0; i < chars.length; i++) {
    const el = chars[i];
    if (el === undefined || el.deleteRevision !== null) {
      continue;
    }
    count++;
    if (count === livePos) {
      return i;
    }
  }
  return chars.length;
}

/** Splice freshly-inserted characters before the `ibi`-th live position. */
function insertChars(
  model: DocumentModel,
  ibi: number,
  s: string,
  revisionId: RevisionId,
  suggestionState: SuggestionState,
): void {
  const at = physicalIndexOfLivePosition(model.chars, ibi);
  // Spread iterates Unicode code points, so multi-byte glyphs stay intact.
  const inserted: TextChar[] = [...s].map((char) => ({
    kind: "char",
    char,
    insertRevision: revisionId,
    deleteRevision: null,
    suggestionState,
  }));
  model.chars.splice(at, 0, ...inserted);
}

/** Insert an opaque structure slot before the `position`-th live position. */
function insertOpaque(
  model: DocumentModel,
  position: number,
  structure: OpaqueStructure,
  revisionId: RevisionId,
): void {
  const at = physicalIndexOfLivePosition(model.chars, position);
  model.chars.splice(at, 0, {
    kind: "opaque",
    structure,
    insertRevision: revisionId,
    deleteRevision: null,
    suggestionState: "none",
  });
}

/** Tombstone the inclusive live range `si..ei` (set deleteRevision; never pop). */
function tombstoneRange(
  chars: readonly CharElement[],
  si: number,
  ei: number,
  revisionId: RevisionId,
): void {
  let count = 0;
  for (const el of chars) {
    if (el.deleteRevision !== null) {
      continue; // already deleted: not a live position
    }
    count++;
    if (count > ei) {
      break; // live positions only grow from here; nothing left in [si, ei]
    }
    if (count >= si && !isEndOfBody(el)) {
      el.deleteRevision = revisionId;
    }
  }
}

/** Set the suggestion state over the inclusive live range `si..ei` (text only). */
function markRange(
  chars: readonly CharElement[],
  si: number,
  ei: number,
  state: SuggestionState,
): void {
  let count = 0;
  for (const el of chars) {
    if (el.deleteRevision !== null) {
      continue;
    }
    count++;
    if (count > ei) {
      break; // live positions only grow from here; nothing left in [si, ei]
    }
    if (count >= si && el.kind === "char") {
      el.suggestionState = state;
    }
  }
}

/**
 * Apply one operation to the model. Closed-world: the `never` default makes a
 * missing arm a compile error (R2). `mlti` recurses depth-first; `unknown` and
 * `opaque` never mutate text content.
 */
export function applyOperation(model: DocumentModel, op: Operation, revisionId: RevisionId): void {
  switch (op.ty) {
    case "is": {
      insertChars(model, op.ibi, op.s, revisionId, "none");
      break;
    }
    case "iss": {
      insertChars(model, op.ibi, op.s, revisionId, "suggested-insert");
      break;
    }
    case "ds": {
      tombstoneRange(model.chars, op.si, op.ei, revisionId);
      break;
    }
    case "dss": {
      // Suggestion delete: mark, do NOT hard-pop and do NOT set deleteRevision.
      markRange(model.chars, op.si, op.ei, "marked-for-deletion");
      break;
    }
    case "msfd": {
      // Mark for deletion (suggestion): set the mark, never deleteRevision (R3).
      markRange(model.chars, op.si, op.ei, "marked-for-deletion");
      break;
    }
    case "usfd": {
      markRange(model.chars, op.si, op.ei, "none");
      break;
    }
    case "mlti": {
      for (const sub of op.mts) {
        applyOperation(model, sub, revisionId);
      }
      break;
    }
    case "opaque": {
      insertOpaque(model, op.position, op.structure, revisionId);
      break;
    }
    case "unknown": {
      // Recorded for diagnostics elsewhere; never mutates reconstructed text.
      break;
    }
    default: {
      const _exhaustive: never = op;
      throw new Error(`apply: unhandled operation ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Apply every operation of a decoded revision under that revision's id. */
export function applyRevision(model: DocumentModel, revision: DecodedRevision): void {
  for (const op of revision.operations) {
    applyOperation(model, op, revision.revisionId);
  }
}
