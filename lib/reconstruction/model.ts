// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Flat character-array document model (plan T4 / Appendix A.2, R3). The document
// is one flat array of elements; deletes are TOMBSTONED (deleteRevision set, the
// element never physically removed) so any earlier state is recoverable by an
// O(N) filter (text.ts). `model.ts` and `apply.ts` agree on the tombstone rule.
//
// The EndOfBody marker is a single reserved sentinel element in the same flat
// array (R12), guarded by isEndOfBody(), so index math stays uniform across body
// and footnote regions exactly as the A.2 flat-array model intends.
//
// This is the mutable working model — fields are intentionally NOT readonly.

import type { OpaqueStructure } from "../decoder/types";
import type { RevisionId } from "../domain/ids";
import { unsafeAsRevisionId } from "../domain/ids";

/** Suggestion lifecycle of an element (R6: a required field, never a boolean). */
export type SuggestionState = "none" | "suggested-insert" | "marked-for-deletion";

interface BaseElement {
  insertRevision: RevisionId;
  // null = live; a RevisionId = the revision that (accepted-)deleted it.
  deleteRevision: RevisionId | null;
  suggestionState: SuggestionState;
}

/** A real text character (one Unicode code point). */
export interface TextChar extends BaseElement {
  kind: "char";
  char: string;
}

/** A non-text structure occupying a position slot but contributing no text. */
export interface OpaqueSlot extends BaseElement {
  kind: "opaque";
  structure: OpaqueStructure;
}

/** The reserved EndOfBody sentinel separating body text from footnote text. */
export interface BodyBoundary extends BaseElement {
  kind: "eob";
}

export type CharElement = TextChar | OpaqueSlot | BodyBoundary;

/** The working document model: a single flat element array. */
export interface DocumentModel {
  chars: CharElement[];
}

// The EndOfBody sentinel pre-exists any real revision; revision 0 is a synthetic
// pre-history id (asRevisionId would reject 0, so the blind cast is used). It is
// never rendered as text and never tombstoned.
const PRE_HISTORY: RevisionId = unsafeAsRevisionId(0);

function createBodyBoundary(): BodyBoundary {
  return {
    kind: "eob",
    insertRevision: PRE_HISTORY,
    deleteRevision: null,
    suggestionState: "none",
  };
}

/** A fresh model: an empty document, just the EndOfBody sentinel. */
export function createModel(): DocumentModel {
  return { chars: [createBodyBoundary()] };
}

/** Type guard for the EndOfBody sentinel. */
export function isEndOfBody(el: CharElement): el is BodyBoundary {
  return el.kind === "eob";
}

/** Deep-clone an element (primitive fields only — a shallow copy suffices). */
export function cloneElement(el: CharElement): CharElement {
  switch (el.kind) {
    case "char":
      return {
        kind: "char",
        char: el.char,
        insertRevision: el.insertRevision,
        deleteRevision: el.deleteRevision,
        suggestionState: el.suggestionState,
      };
    case "opaque":
      return {
        kind: "opaque",
        structure: el.structure,
        insertRevision: el.insertRevision,
        deleteRevision: el.deleteRevision,
        suggestionState: el.suggestionState,
      };
    case "eob":
      return {
        kind: "eob",
        insertRevision: el.insertRevision,
        deleteRevision: el.deleteRevision,
        suggestionState: el.suggestionState,
      };
    default: {
      const _exhaustive: never = el;
      return _exhaustive;
    }
  }
}

/** Deep-clone a model (used by snapshotting). */
export function cloneModel(model: DocumentModel): DocumentModel {
  return { chars: model.chars.map(cloneElement) };
}
