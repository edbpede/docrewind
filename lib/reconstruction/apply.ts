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

import type { ListMark, ParagraphMarks, TextMarks } from "../decoder/style-allowlist";
import type { ApplyStyle, OpaqueStructure, Operation } from "../decoder/types";
import type { RevisionId } from "../domain/ids";
import type { DecodedRevision } from "../domain/model";
import type { CharElement, DocumentModel, SuggestionState, TextChar } from "./model";
import { createModel, isEndOfBody } from "./model";

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

/**
 * The text marks a freshly-inserted character inherits: those of the live
 * element IMMEDIATELY PRECEDING the insertion point. Google Docs never restates
 * a run's style per keystroke — typed text implicitly carries the adjacent
 * character's formatting, and only an explicit `as` op overrides it. Without
 * this, only the handful of ranges that DID get an explicit `as` op render
 * styled, so a sentence typed under active bold/italic surfaces as scattered
 * fragments (the styled-fragments bug). Returns `undefined` at the document /
 * paragraph start or when the preceding live element is a non-text slot
 * (opaque / EndOfBody), so no style is invented across a structural boundary.
 * The preceding char's marks object is already frozen (immutable-by-replacement
 * in `setTextMarks`), so the reference is shared safely and compares `===` for
 * run coalescing.
 */
function inheritedMarksAt(chars: readonly CharElement[], at: number): TextMarks | undefined {
  for (let i = at - 1; i >= 0; i--) {
    const el = chars[i];
    if (el === undefined || el.deleteRevision !== null) {
      continue;
    }
    return el.kind === "char" && el.char !== "\n" ? el.marks : undefined;
  }
  return undefined;
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
  const inheritedMarks = inheritedMarksAt(model.chars, at);
  // Spread iterates Unicode code points, so multi-byte glyphs stay intact.
  const inserted: TextChar[] = [...s].map((char) => ({
    kind: "char",
    char,
    insertRevision: revisionId,
    deleteRevision: null,
    suggestionState,
    ...(inheritedMarks !== undefined ? { marks: inheritedMarks } : {}),
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
 * Replace block (paragraph) marks over the inclusive live range `si..ei`. The
 * range targets a paragraph-mark `\n` — or, for the document's final paragraph,
 * the EndOfBody sentinel — so unlike markRange this DOES include the EOB. Each
 * `as` op fully restates its paragraph style, so empty marks CLEAR (revert to
 * default). A fresh frozen object is assigned (immutable-by-replacement), so the
 * shallow clone in model.ts is alias-safe.
 */
function setBlockMarks(
  chars: readonly CharElement[],
  si: number,
  ei: number,
  marks: ParagraphMarks,
): void {
  const frozen = Object.keys(marks).length > 0 ? Object.freeze({ ...marks }) : undefined;
  let count = 0;
  for (const el of chars) {
    if (el.deleteRevision !== null) {
      continue;
    }
    count++;
    if (count > ei) {
      break;
    }
    if (count >= si) {
      if (frozen === undefined) {
        delete el.block;
      } else {
        el.block = frozen;
      }
    }
  }
}

/** Replace character marks over the inclusive live range `si..ei` (text chars
 *  only). Empty marks clear. Fresh frozen object per call (immutable-by-replacement). */
function setTextMarks(
  chars: readonly CharElement[],
  si: number,
  ei: number,
  marks: TextMarks,
): void {
  const frozen = Object.keys(marks).length > 0 ? Object.freeze({ ...marks }) : undefined;
  let count = 0;
  for (const el of chars) {
    if (el.deleteRevision !== null) {
      continue;
    }
    count++;
    if (count > ei) {
      break;
    }
    if (count >= si && el.kind === "char") {
      if (frozen === undefined) {
        delete el.marks;
      } else {
        el.marks = frozen;
      }
    }
  }
}

/** Replace list membership over the inclusive live range `si..ei` (the paragraph
 *  mark `\n` / EOB). `undefined` clears membership (removed from a list). */
function setListMark(
  chars: readonly CharElement[],
  si: number,
  ei: number,
  list: ListMark | undefined,
): void {
  let count = 0;
  for (const el of chars) {
    if (el.deleteRevision !== null) {
      continue;
    }
    count++;
    if (count > ei) {
      break;
    }
    if (count >= si) {
      if (list === undefined) {
        delete el.list;
      } else {
        el.list = list;
      }
    }
  }
}

/** Apply an ApplyStyle op: paragraph/list marks ride the `\n`/EOB, text marks the run. */
function applyStyle(model: DocumentModel, op: ApplyStyle): void {
  if (op.scope === "paragraph") {
    setBlockMarks(model.chars, op.si, op.ei, op.paragraph ?? {});
  } else if (op.scope === "text") {
    setTextMarks(model.chars, op.si, op.ei, op.text ?? {});
  } else {
    setListMark(model.chars, op.si, op.ei, op.list);
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
    case "rplc": {
      // Bulk replace: reset to a fresh body (just the EndOfBody sentinel), then
      // re-apply the embedded snapshot ops under this revision. The wire indices
      // of the embedded `is`/`ds`/… ops address the SAME live (deletion-collapsed)
      // document the changelog does, so rebuilding via the normal apply path seeds
      // the pre-existing content with the exact positions every later edit assumes
      // — which is precisely what fixes the "garbled" misalignment. `rplc` resets
      // the model rather than splicing, mirroring the wire op's "replace document"
      // semantics; in practice it is the revision-1 template load.
      model.chars = createModel().chars;
      for (const sub of op.ops) {
        applyOperation(model, sub, revisionId);
      }
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
    case "as": {
      // ApplyStyle (paragraph / text / list scope). Additive: never changes text,
      // character counts, or live/physical indices (formatting is layered on).
      applyStyle(model, op);
      break;
    }
    case "te": {
      // Place an embedded entity as an opaque slot (the inline-image default). The
      // slot occupies one live position, exactly mirroring the wire's `spi` insert.
      insertOpaque(model, op.spi, "image", revisionId);
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
