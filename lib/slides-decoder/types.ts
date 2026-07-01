// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Closed-world Slides (Punch) operation grammar (ground truth: live capture
// 2026-07-01, deck 1_TAfuNLcEi69kqggyCZr9Ir4waEQGTSgl1s5SGEiYZU). Google Slides
// shares the Docs/Sheets `revisions/load` transport (`)]}'`-framed
// `{ chunkedSnapshot, changelog }`) but carries its OWN mutation grammar: small
// stable integer opcodes over a 2-D canvas of shapes bearing text — structurally
// unlike the Docs linear text or the Sheets grid, hence its own core.
//
// This module is TYPES ONLY — the closed discriminated union `SlidesOperation`
// that `slides-reconstruction/apply.ts` switches over with a `never`
// exhaustiveness gate. The runtime OPEN-WORLD decode funnel (every unrecognized
// opcode → `SlidesUnknownOp`, never a throw) lives in `decode.ts`.
//
// PURE: imports only the shared branded id + metadata types; no browser / fetch /
// Worker.

import type { RevisionId } from "../domain/ids";
import type { RevisionMeta } from "../replay-core/meta";

/** Branded page id (a master/layout/slide id, e.g. "p", "g40997f6bf24_2_0"). */
export type PageId = string & { readonly __brand: "SlidesPageId" };
/** Branded shape/element id (e.g. "i0", "n:text", "p1_i2"). */
export type ShapeId = string & { readonly __brand: "SlidesShapeId" };

/** Blind-cast for a page id validated upstream (a non-empty wire string). */
export function unsafeAsPageId(value: string): PageId {
  return value as PageId;
}

/** Blind-cast for a shape id validated upstream (a non-empty wire string). */
export function unsafeAsShapeId(value: string): ShapeId {
  return value as ShapeId;
}

/**
 * The recognized Punch opcodes (live capture 2026-07-01). Structural ops
 * (SET_PAGE_SIZE, CREATE_SHAPE, DEFINE_PAGE, INSERT_TEXT, DELETE_TEXT,
 * DECLARE_PLACEHOLDER) drive reconstruction; the rest are recognized-but-inert in
 * v1 so a normal deck never spuriously trips the fidelity notice. Any opcode still
 * unrecognized degrades to {@link SlidesUnknownOp}.
 */
export const SLIDES_OPCODE = {
  SET_PAGE_SIZE: 1,
  CREATE_SHAPE: 3,
  TXN: 4,
  SET_SHAPE_PROP: 5,
  CREATE_PAGE: 9,
  DEFINE_PAGE: 12,
  PAGE_MEMBERSHIP: 13,
  INSERT_TEXT: 15,
  DELETE_TEXT: 16,
  STYLE_RANGE: 17,
  DECLARE_PLACEHOLDER: 18,
  MARKER: 20,
  LIST_ENTITY: 41,
  DEFAULT_STYLE: 45,
} as const;

/** The Punch `pageType` field of a DEFINE_PAGE op: which page family it declares. */
export type SlidesPageType = "slide" | "layout" | "master";

/**
 * A 2×3 affine transform `[scaleX, shearY, shearX, scaleY, translateX, translateY]`
 * placing a shape on the page. Translate is in the same EMU/25 page unit as the
 * page size; the render layer resolves it against a base shape box (§ render.ts).
 */
export interface Transform {
  readonly scaleX: number;
  readonly shearY: number;
  readonly shearX: number;
  readonly scaleY: number;
  readonly translateX: number;
  readonly translateY: number;
}

/** A theme/master colour scheme captured from a DEFINE_PAGE payload. */
export interface SlidesTheme {
  /** Theme display name (e.g. "Simple Light"), or null when the wire omitted it. */
  readonly name: string | null;
  /** Ordered hex palette; [0] = text/dark, [1] = background (e.g. "#FFFFFF"). */
  readonly palette: readonly string[];
}

/** `4` — a transaction wrapping N sub-ops applied as one revision. */
export interface SlidesTxn {
  readonly op: "txn";
  readonly ops: readonly SlidesOperation[];
}

/** `1` — set the presentation page size (EMU/25 units). */
export interface SlidesSetPageSize {
  readonly op: "page-size";
  readonly width: number;
  readonly height: number;
}

/** `3` — create a shape/element on `parentId` with a raw `shapeType` + transform. */
export interface SlidesCreateShape {
  readonly op: "create-shape";
  readonly shapeId: ShapeId;
  readonly parentId: PageId;
  /** Raw Punch type code: 108 = text box, 158 = slide/notes background, 6 = image. */
  readonly shapeType: number;
  readonly transform: Transform | null;
}

/** `5` — set a shape property (autofit/geometry). Recognized + inert in v1. */
export interface SlidesSetShapeProp {
  readonly op: "shape-prop";
}

/** `9` — create a page. The page id/type/order arrive via DEFINE_PAGE; inert here. */
export interface SlidesCreatePage {
  readonly op: "create-page";
}

/** `12` — declare a page (master/layout/slide) + optional theme palette. */
export interface SlidesDefinePage {
  readonly op: "define-page";
  readonly pageId: PageId;
  readonly pageType: SlidesPageType;
  readonly theme: SlidesTheme | null;
}

/** `13` — page membership/ordering hint. Recognized + inert in v1. */
export interface SlidesPageMembership {
  readonly op: "page-membership";
}

/** `15` — insert `text` into `shapeId` at UTF-16 `offset`. */
export interface SlidesInsertText {
  readonly op: "insert-text";
  readonly shapeId: ShapeId;
  readonly offset: number;
  readonly text: string;
}

/** `16` — delete the half-open UTF-16 range `[start, end)` from `shapeId`. */
export interface SlidesDeleteText {
  readonly op: "delete-text";
  readonly shapeId: ShapeId;
  readonly start: number;
  readonly end: number;
}

/**
 * `17` — a text style range. Recognized + INERT in v1: the render layer derives
 * typography (title vs body, size, alignment) from geometry + placeholder role +
 * theme rather than parsing the (theme-dependent) style spec, so an unparsed span
 * is a low-stakes cosmetic gap, not a dropped edit (mirrors the Sheets precedent
 * of silently dropping unrecognized format masks).
 */
export interface SlidesTextStyle {
  readonly op: "text-style";
}

/** `18` — bind a page to a layout family (`"TITLE"`, `"TITLE_AND_BODY"`, …). */
export interface SlidesDeclarePlaceholder {
  readonly op: "declare-placeholder";
  readonly pageId: PageId;
  /** The layout family name, or null when none was found in the payload. */
  readonly layoutType: string | null;
}

/** `20` — a no-op marker. Recognized + inert. */
export interface SlidesMarker {
  readonly op: "marker";
}

/** `41` — a paragraph list entity (bullets). Recognized + inert in v1. */
export interface SlidesListEntity {
  readonly op: "list-entity";
}

/** `45` — a default text style block. Recognized + inert. */
export interface SlidesDefaultStyle {
  readonly op: "default-style";
}

/**
 * An unrecognized wire opcode. Privacy-safe by construction (mirrors the Docs /
 * Sheets `UnknownOp`): carries ONLY the opcode and the byte length of the skipped
 * payload — never verbatim content. Lets decoding continue and drives the fidelity
 * notice.
 */
export interface SlidesUnknownOp {
  readonly op: "unknown";
  readonly opCode: string;
  readonly byteLength: number;
  readonly revisionId: RevisionId;
}

/**
 * Closed-world discriminated union of every Slides operation the core understands.
 * `slides-reconstruction/apply.ts` switches over this with a `never`
 * exhaustiveness default — adding a variant here without a matching apply arm is a
 * compile error.
 */
export type SlidesOperation =
  | SlidesTxn
  | SlidesSetPageSize
  | SlidesCreateShape
  | SlidesSetShapeProp
  | SlidesCreatePage
  | SlidesDefinePage
  | SlidesPageMembership
  | SlidesInsertText
  | SlidesDeleteText
  | SlidesTextStyle
  | SlidesDeclarePlaceholder
  | SlidesMarker
  | SlidesListEntity
  | SlidesDefaultStyle
  | SlidesUnknownOp;

/**
 * One decoded Slides revision: kind-agnostic metadata ({@link RevisionMeta}) plus
 * the typed ops and the runtime `modelVersion`. `modelVersionMismatch` is true when
 * the payload's modelVersion differs from `SLIDES_MODEL_BASELINE`; because the wire
 * carries no modelVersion today it is always false (see `version.ts`).
 */
export interface SlidesDecodedRevision extends RevisionMeta {
  readonly operations: readonly SlidesOperation[];
  readonly modelVersion: number;
  readonly modelVersionMismatch: boolean;
}
