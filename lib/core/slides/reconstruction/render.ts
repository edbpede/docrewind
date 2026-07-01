// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides render projection: turn the reconstructed {@link PresentationModel} into
// UI-ready, geometry-resolved slides the viewport paints. This is the "structural
// layout + parity" compromise (the Slides analogue of the Sheets grid render):
// shapes are placed at their transform-derived boxes on a scaled slide canvas, text
// is drawn with role-based typography (title vs body), non-text media becomes a
// labeled placeholder box (no image bytes — network isolation), and the theme
// supplies the background colour. Pixel-exact parity is a non-goal; correct slides,
// correct text, and correct structural placement are.
//
// PURE: no browser / fetch / Worker / DOM. The component consumes these plain data
// shapes.

import type { ShapeId } from "@/lib/core/slides/decoder/types";
import type { PresentationModel, ShapeModel } from "./model";

/** Punch text-box type code (title/body/subtitle placeholders + inserted text boxes). */
const TYPE_TEXT = 108;
/** Punch slide/notes background frame — never drawn (the theme paints the bg). */
const TYPE_BACKGROUND = 158;

/**
 * A shape's intrinsic reference box in EMU/25 units. The transform's scale is
 * relative to this box; empirically ≈ a 3-inch square (3 × 914400 EMU ÷ 25) fits
 * placeholders across the full observed scale range (0.18–2.84). Calibrated against
 * the live editor; adjust here if a future capture disagrees.
 */
export const SLIDE_SHAPE_BASE_UNITS = 109728;

/** Fallback 16:9 page size (EMU/25) when SET_PAGE_SIZE was absent. */
const DEFAULT_PAGE = { width: 365760, height: 205740 };

/** Default palette colours when the deck carried no theme. */
const DEFAULT_BACKGROUND = "#FFFFFF";
const DEFAULT_TEXT_COLOR = "#1A1A1A";

/** Font size as a fraction of slide height, by role (title larger than body). */
const TITLE_FONT_FRAC = 0.11;
const BODY_FONT_FRAC = 0.055;

/** One geometry-resolved shape ready to paint (boxes are fractions of slide W/H). */
export interface RenderedShape {
  readonly kind: "text" | "media";
  /** Box as fractions of the slide (left/top from translate, width/height from scale). */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** The shape's text (empty for media). */
  readonly text: string;
  readonly role: "title" | "body";
  readonly align: "left" | "center" | "right";
  /** Font size as a fraction of slide height (text only). */
  readonly fontFrac: number;
  /** Placeholder label for media (e.g. "image"); empty for text. */
  readonly label: string;
}

/** One geometry-resolved slide ready to paint. */
export interface RenderedSlide {
  readonly pageId: string;
  /** 0-based slide index within the presentation. */
  readonly index: number;
  readonly background: string;
  /** Default text colour (theme palette[0]); a readable near-black fallback. */
  readonly textColor: string;
  /** Slide aspect ratio (width / height) for a correctly-shaped canvas. */
  readonly aspectRatio: number;
  readonly shapes: readonly RenderedShape[];
}

/** The number of user-visible slides in the model. */
export function slideCount(model: PresentationModel): number {
  return model.slideOrder.length;
}

/** True when reconstruction dropped anything (drives the calm fidelity indicator). */
export function hasFidelityNotice(model: PresentationModel): boolean {
  return model.fidelityNotices.length > 0;
}

function backgroundOf(model: PresentationModel): string {
  const palette = model.theme?.palette;
  return palette !== undefined && palette.length > 1
    ? (palette[1] ?? DEFAULT_BACKGROUND)
    : DEFAULT_BACKGROUND;
}

function textColorOf(model: PresentationModel): string {
  const palette = model.theme?.palette;
  return palette !== undefined && palette.length > 0
    ? (palette[0] ?? DEFAULT_TEXT_COLOR)
    : DEFAULT_TEXT_COLOR;
}

/** Shapes belonging to a page, in creation order (stable render). */
function shapesOfPage(model: PresentationModel, pageId: string): ShapeModel[] {
  const out: ShapeModel[] = [];
  for (const id of model.shapeOrder) {
    const shape = model.shapes.get(id as ShapeId);
    if (shape !== undefined && shape.pageId === pageId) out.push(shape);
  }
  return out;
}

/** Whether a shape should draw as media (non-text, non-background placeholder). */
function isMedia(shape: ShapeModel): boolean {
  return shape.shapeType !== TYPE_TEXT && shape.shapeType !== TYPE_BACKGROUND;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve a shape's transform to an axis-aligned fractional box on the slide, or
 * null when the shape has no transform. v1 uses only scale + translate; the
 * `shearX`/`shearY` (rotation/skew) components are intentionally dropped — a
 * rotated/sheared placeholder is drawn upright at its scaled size, consistent with
 * the "structural layout, not pixel-exact parity" compromise.
 */
function boxOf(shape: ShapeModel, pageW: number, pageH: number): Box | null {
  const t = shape.transform;
  if (t === null) return null;
  return {
    left: t.translateX / pageW,
    top: t.translateY / pageH,
    width: (Math.abs(t.scaleX) * SLIDE_SHAPE_BASE_UNITS) / pageW,
    height: (Math.abs(t.scaleY) * SLIDE_SHAPE_BASE_UNITS) / pageH,
  };
}

/**
 * Project one slide (by 0-based index) into a {@link RenderedSlide}, or null when
 * the index is out of range. Text shapes with content are placed at their
 * transform box; the topmost text shape is the title (centered on a pure-TITLE
 * layout, else left-aligned); media shapes become labeled placeholders.
 */
export function renderSlide(model: PresentationModel, index: number): RenderedSlide | null {
  const pageId = model.slideOrder[index];
  if (pageId === undefined) return null;
  const page = model.pages.get(pageId);
  const pageW = model.pageSize?.width ?? DEFAULT_PAGE.width;
  const pageH = model.pageSize?.height ?? DEFAULT_PAGE.height;

  const candidates = shapesOfPage(model, pageId);
  // Title = the topmost text shape that carries text (smallest translateY).
  let titleId: ShapeId | null = null;
  let titleTop = Number.POSITIVE_INFINITY;
  for (const shape of candidates) {
    if (shape.shapeType !== TYPE_TEXT || shape.text.trim().length === 0) continue;
    const top = shape.transform?.translateY ?? Number.POSITIVE_INFINITY;
    if (top < titleTop) {
      titleTop = top;
      titleId = shape.id;
    }
  }
  // A pure title slide centers its title; content slides left-align it.
  const centeredTitle = page?.layoutType === "TITLE" || page?.layoutType === "CENTERED_TITLE";

  const shapes: RenderedShape[] = [];
  for (const shape of candidates) {
    const box = boxOf(shape, pageW, pageH);
    if (box === null) continue;
    if (shape.shapeType === TYPE_TEXT) {
      if (shape.text.trim().length === 0) continue; // skip empty placeholders
      const role: "title" | "body" = shape.id === titleId ? "title" : "body";
      // A pure title slide centers ALL its text (title + subtitle), matching
      // Google's centered TITLE layout; content slides left-align everything.
      const align: "left" | "center" | "right" = centeredTitle ? "center" : "left";
      shapes.push({
        kind: "text",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        text: shape.text,
        role,
        align,
        fontFrac: role === "title" ? TITLE_FONT_FRAC : BODY_FONT_FRAC,
        label: "",
      });
    } else if (isMedia(shape)) {
      // A neutral "media" label: the shapeType alone can't reliably tell an image
      // from a chart/table/video, so the placeholder never asserts "Image" for a
      // chart. Rendering embedded objects as a labeled box (no bytes, no fetch) is
      // the intended v1 compromise, mirroring the Sheets chart/image placeholders.
      shapes.push({
        kind: "media",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        text: "",
        role: "body",
        align: "left",
        fontFrac: BODY_FONT_FRAC,
        label: "media",
      });
    }
    // TYPE_BACKGROUND (158) shapes are intentionally skipped.
  }

  return {
    pageId,
    index,
    background: backgroundOf(model),
    textColor: textColorOf(model),
    aspectRatio: pageW / pageH,
    shapes,
  };
}

/** Project every slide in order (convenience for a full-deck render). */
export function renderSlides(model: PresentationModel): RenderedSlide[] {
  const out: RenderedSlide[] = [];
  for (let i = 0; i < model.slideOrder.length; i++) {
    const slide = renderSlide(model, i);
    if (slide !== null) out.push(slide);
  }
  return out;
}
