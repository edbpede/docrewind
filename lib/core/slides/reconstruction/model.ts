// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides presentation working model. A presentation is `pages × shapes`, each
// shape a positioned box that may bear text — structurally unlike the Docs linear
// text or the Sheets grid (which is exactly why Slides gets its own core). Only the
// user-visible SLIDE pages (Punch `pageType` 0) are rendered; layout/master pages
// are template scaffolding kept for completeness but never drawn.
//
// This is the mutable working model — fields are intentionally NOT readonly.
// PURE: no browser / fetch / Worker.

import type {
  PageId,
  ShapeId,
  SlidesPageType,
  SlidesTheme,
  Transform,
} from "@/lib/core/slides/decoder/types";

/** One reconstructed shape: its owning page, raw type code, transform + text buffer. */
export interface ShapeModel {
  id: ShapeId;
  /** The page this shape belongs to (the CREATE_SHAPE `parentId`). */
  pageId: PageId;
  /** Raw Punch type code (108 = text box, 158 = slide/notes background, 6 = image). */
  shapeType: number;
  transform: Transform | null;
  /** The shape's reconstructed text (UTF-16), folded from INSERT/DELETE ops. */
  text: string;
}

/** One page: its id, family (slide/layout/master), and layout binding (op18). */
export interface SlidePageModel {
  id: PageId;
  pageType: SlidesPageType;
  /** Layout family name from DECLARE_PLACEHOLDER (e.g. "TITLE"), or null. */
  layoutType: string | null;
}

/**
 * Privacy-safe fidelity notice: appended whenever an op degrades to
 * `SlidesUnknownOp`, a `modelVersion` mismatch is detected, or a value-bearing shape
 * can never be placed because its transform failed to decode (`unplaced-shape` — the
 * render pass drops such a shape, so recording the loss keeps it honest, not silent).
 * `detail` is a content-free code (an opcode, a version, or a shape type) — never
 * slide text.
 */
export interface SlidesFidelityNotice {
  readonly kind: "unknown-op" | "model-version-mismatch" | "unplaced-shape";
  readonly detail: string;
}

/** The full presentation working model. */
export interface PresentationModel {
  /** Page size in EMU/25 units (Punch), or null before SET_PAGE_SIZE. */
  pageSize: { width: number; height: number } | null;
  pages: Map<PageId, SlidePageModel>;
  /** Slide (pageType 0) ids in creation order — the render/scrub order. */
  slideOrder: PageId[];
  shapes: Map<ShapeId, ShapeModel>;
  /** Shape ids in creation order, for stable per-slide rendering. */
  shapeOrder: ShapeId[];
  /** The first themed palette seen (the master theme), or null. */
  theme: SlidesTheme | null;
  fidelityNotices: SlidesFidelityNotice[];
}

/** A fresh, empty presentation model. */
export function createModel(): PresentationModel {
  return {
    pageSize: null,
    pages: new Map(),
    slideOrder: [],
    shapes: new Map(),
    shapeOrder: [],
    theme: null,
    fidelityNotices: [],
  };
}

function cloneShape(shape: ShapeModel): ShapeModel {
  return {
    id: shape.id,
    pageId: shape.pageId,
    shapeType: shape.shapeType,
    transform: shape.transform === null ? null : { ...shape.transform },
    text: shape.text,
  };
}

function cloneTheme(theme: SlidesTheme | null): SlidesTheme | null {
  return theme === null ? null : { name: theme.name, palette: [...theme.palette] };
}

/** Deep-clone the model (used by snapshotting — the spine never mutates a snapshot). */
export function cloneModel(model: PresentationModel): PresentationModel {
  const pages = new Map<PageId, SlidePageModel>();
  for (const [id, page] of model.pages) {
    pages.set(id, { id: page.id, pageType: page.pageType, layoutType: page.layoutType });
  }
  const shapes = new Map<ShapeId, ShapeModel>();
  for (const [id, shape] of model.shapes) {
    shapes.set(id, cloneShape(shape));
  }
  return {
    pageSize: model.pageSize === null ? null : { ...model.pageSize },
    pages,
    slideOrder: [...model.slideOrder],
    shapes,
    shapeOrder: [...model.shapeOrder],
    theme: cloneTheme(model.theme),
    fidelityNotices: model.fidelityNotices.map((n) => ({ kind: n.kind, detail: n.detail })),
  };
}
