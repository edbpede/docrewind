// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Operation grammar ported from the MIT-licensed `harvard-vpal/gdocrevisions`
// (https://github.com/harvard-vpal/gdocrevisions, last release 2018) and
// corroborated by the 2014 Google Docs teardown — see PRD Appendix A.2.
//
//   Copyright (c) 2018 Harvard VPAL — MIT License (operation vocabulary).
//   Portions of the `ty`-discriminated grammar below derive from that work and
//   are reproduced under the MIT terms alongside DocRewind's AGPL-3.0-or-later
//   license, per PRD §11.6.
//
// This module is TYPES ONLY (the closed-world `Operation` union). The runtime
// open-world decode funnel lives in `decode.ts`. Both the domain model and the
// reconstruction engine depend on these shapes, so the types land first.

import type { RevisionId } from "../domain/ids";
import type { ListMark, ParagraphMarks, TextMarks } from "./style-allowlist";

/** Non-text structures that ride outside the plain character stream (A.8). */
export type OpaqueStructure =
  | "image"
  | "table"
  | "footnote"
  | "equation"
  | "drawing"
  | "list-format"
  | "comment-ref";

/** `is` — InsertString: splice `s` at `ibi - 1` (1-indexed insert-begin-index). */
export interface InsertString {
  readonly ty: "is";
  readonly s: string;
  readonly ibi: number;
}

/** `ds` — DeleteString: remove the inclusive 1-indexed `si..ei` range. */
export interface DeleteString {
  readonly ty: "ds";
  readonly si: number;
  readonly ei: number;
}

/** `mlti` — MultiOperation: compound op; recurse depth-first over `mts`. */
export interface MultiOperation {
  readonly ty: "mlti";
  readonly mts: readonly Operation[];
}

/** `iss` — InsertStringSuggestion: suggestion form of insert. */
export interface InsertStringSuggestion {
  readonly ty: "iss";
  readonly s: string;
  readonly ibi: number;
}

/** `dss` — DeleteStringSuggestion: suggestion delete over the inclusive range. */
export interface DeleteStringSuggestion {
  readonly ty: "dss";
  readonly si: number;
  readonly ei: number;
}

/** `msfd` — MarkStringForDeletion: mark the inclusive range as suggested-delete. */
export interface MarkStringForDeletion {
  readonly ty: "msfd";
  readonly si: number;
  readonly ei: number;
}

/** `usfd` — UnmarkStringForDeletion: clear a suggested-delete mark on the range. */
export interface UnmarkStringForDeletion {
  readonly ty: "usfd";
  readonly si: number;
  readonly ei: number;
}

/**
 * `rplc` — ReplaceWithSnapshot. A bulk "replace the whole document with this
 * snapshot" op. LIVE-CONFIRMED 2026-06-19 as the revision-1 op of a Google
 * Classroom assignment copy: `{ ty:"rplc", snapshot:[[ <ops> ]] }`, where the
 * embedded snapshot is the SAME op-chunk vocabulary as the changelog (`is`/`as`/
 * `mlti`/entity ops…) and carries the template's PRE-EXISTING content. Dropping
 * it (the old open-world `UnknownOp` path) lost that base content, so every later
 * edit's 1-indexed position landed in the wrong place — the reported "garbled"
 * playback. Apply semantics: reset the document, then apply `ops` under this
 * revision (Appendix A.2 — see reconstruction/apply.ts).
 */
export interface ReplaceWithSnapshot {
  readonly ty: "rplc";
  readonly ops: readonly Operation[];
}

/**
 * A recognized non-text structure. Preserves position + timing so replay keeps
 * a labeled slot, but carries no decoded content (A.8, §15.3) — never aborts.
 */
export interface OpaquePlaceholder {
  readonly ty: "opaque";
  readonly structure: OpaqueStructure;
  readonly position: number;
  readonly revisionId: RevisionId;
}

/**
 * `as` / `astss` — ApplyStyle. Sets paragraph- or character-scope formatting over
 * the inclusive 1-indexed live range `si..ei`. The opaque wire style map `sm` is
 * NOT carried here: decode.ts runs it through the closed-output style allowlist
 * (R5), so this variant holds ONLY the extracted, privacy-safe marks. Paragraph
 * style sits on the paragraph-mark `\n` (si==ei); text style spans a run. `astss`
 * is the suggestion form (`suggested: true`) and applies identically in replay.
 */
export interface ApplyStyle {
  readonly ty: "as";
  readonly scope: "paragraph" | "text" | "list";
  readonly si: number;
  readonly ei: number;
  readonly suggested: boolean;
  readonly paragraph?: ParagraphMarks;
  readonly text?: TextMarks;
  readonly list?: ListMark;
}

/**
 * `te` — PlaceEntity. Inserts an embedded object (image / drawing / …) into the
 * character stream at the 1-indexed live position `spi`. The defining `ae` op
 * (entity property map) is not modeled structurally yet, so the slot renders as a
 * labeled placeholder (the inline image default) — no pixels, per host-permission.
 */
export interface PlaceEntity {
  readonly ty: "te";
  readonly spi: number;
}

/**
 * An unrecognized wire operation. Privacy-safe by construction (R5, §13.7):
 * carries ONLY the unrecognized wire op-code and the byte length of the skipped
 * payload — never any verbatim text. Lets decoding continue past unknown ops.
 */
export interface UnknownOp {
  readonly ty: "unknown";
  readonly opCode: string;
  readonly byteLength: number;
  readonly revisionId: RevisionId;
}

/**
 * Closed-world discriminated union of every operation the core understands.
 * `apply.ts` switches over this with a `never` exhaustiveness default — adding
 * a variant here without a matching apply arm is a compile error.
 */
export type Operation =
  | InsertString
  | DeleteString
  | MultiOperation
  | InsertStringSuggestion
  | DeleteStringSuggestion
  | MarkStringForDeletion
  | UnmarkStringForDeletion
  | ReplaceWithSnapshot
  | OpaquePlaceholder
  | ApplyStyle
  | PlaceEntity
  | UnknownOp;
