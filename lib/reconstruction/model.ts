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

import type { ListMark, ParagraphMarks, TextMarks } from "../decoder/style-allowlist";
import type { OpaqueStructure } from "../decoder/types";
import type { RevisionId } from "../domain/ids";
import { PRE_HISTORY_REVISION } from "../domain/ids";

/** Suggestion lifecycle of an element (R6: a required field, never a boolean). */
export type SuggestionState = "none" | "suggested-insert" | "marked-for-deletion";

interface BaseElement {
  insertRevision: RevisionId;
  // null = live; a RevisionId = the revision that (accepted-)deleted it.
  deleteRevision: RevisionId | null;
  suggestionState: SuggestionState;
  // Additive formatting (plan Phase 2/3). `block` rides on a paragraph-mark `\n`
  // (and the EndOfBody sentinel for the final paragraph) — heading / alignment /
  // spacing for the paragraph it terminates. `marks` rides on a text char — its
  // bold / italic / font etc. Both are INTERNED, IMMUTABLE-BY-REPLACEMENT frozen
  // objects (apply.ts assigns a fresh object, never mutates in place), so a shallow
  // clone shares the reference safely. Time-travels for free with the element.
  block?: ParagraphMarks;
  marks?: TextMarks;
  // List membership for the paragraph this `\n`/EOB terminates (Phase 4).
  list?: ListMark;
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

// The EndOfBody sentinel pre-exists any real revision; it carries the synthetic
// pre-history id (0). The same id marks base/template content seeded from a
// `chunkedSnapshot` (content that predates the fetched changelog window): it
// renders as accepted text and is never attributed to a real author (no caret,
// no highlight), since no fetched revision created it.
export const BASE_REVISION: RevisionId = PRE_HISTORY_REVISION;

function createBodyBoundary(): BodyBoundary {
  return {
    kind: "eob",
    insertRevision: BASE_REVISION,
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

/**
 * Copy the BaseElement fields shared by every kind, INCLUDING the optional
 * formatting (`block`/`marks`). These are interned, immutable-by-replacement
 * objects, so sharing the reference across the clone is alias-safe (apply.ts never
 * mutates a marks object in place). Optional fields are added only when present,
 * keeping the clone exactOptionalPropertyTypes-clean.
 */
function cloneBase(el: CharElement): BaseElement {
  const base: BaseElement = {
    insertRevision: el.insertRevision,
    deleteRevision: el.deleteRevision,
    suggestionState: el.suggestionState,
  };
  if (el.block !== undefined) base.block = el.block;
  if (el.marks !== undefined) base.marks = el.marks;
  if (el.list !== undefined) base.list = el.list;
  return base;
}

/** Clone an element (shallow — primitive fields plus interned formatting refs). */
function cloneElement(el: CharElement): CharElement {
  switch (el.kind) {
    case "char":
      return { kind: "char", char: el.char, ...cloneBase(el) };
    case "opaque":
      return { kind: "opaque", structure: el.structure, ...cloneBase(el) };
    case "eob":
      return { kind: "eob", ...cloneBase(el) };
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
