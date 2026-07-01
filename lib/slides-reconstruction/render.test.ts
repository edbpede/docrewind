// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for the Slides render projection: geometry resolution (transform ->
// fractional box), title detection + alignment, media placeholders, empty/background
// shape skipping, and page/theme fallbacks.

import { describe, expect, test } from "bun:test";
import type { SlidesOperation, Transform } from "../slides-decoder/types";
import { unsafeAsPageId, unsafeAsShapeId } from "../slides-decoder/types";
import { applySlidesOperation } from "./apply";
import { createModel, type PresentationModel } from "./model";
import {
  hasFidelityNotice,
  renderSlide,
  renderSlides,
  SLIDE_SHAPE_BASE_UNITS,
  slideCount,
} from "./render";

const P = unsafeAsPageId;
const S = unsafeAsShapeId;
// A page sized so the base box is exactly 0.1 of the page (clean fractions).
const PAGE = SLIDE_SHAPE_BASE_UNITS * 10;

function xform(tx: number, ty: number, sx = 1, sy = 1): Transform {
  return { scaleX: sx, shearY: 0, shearX: 0, scaleY: sy, translateX: tx, translateY: ty };
}

function build(layoutType: string): PresentationModel {
  const m = createModel();
  const ops: SlidesOperation[] = [
    { op: "page-size", width: PAGE, height: PAGE },
    {
      op: "define-page",
      pageId: P("p"),
      pageType: "slide",
      theme: { name: "T", palette: ["#000000", "#FFFFFF"] },
    },
    { op: "declare-placeholder", pageId: P("p"), layoutType },
    {
      op: "create-shape",
      shapeId: S("body"),
      parentId: P("p"),
      shapeType: 108,
      transform: xform(0, PAGE / 2),
    },
    {
      op: "create-shape",
      shapeId: S("title"),
      parentId: P("p"),
      shapeType: 108,
      transform: xform(SLIDE_SHAPE_BASE_UNITS, SLIDE_SHAPE_BASE_UNITS, 2),
    },
    {
      op: "create-shape",
      shapeId: S("pic"),
      parentId: P("p"),
      shapeType: 6,
      transform: xform(0, 0),
    },
    {
      op: "create-shape",
      shapeId: S("bg"),
      parentId: P("p"),
      shapeType: 158,
      transform: xform(0, 0),
    },
    {
      op: "create-shape",
      shapeId: S("empty"),
      parentId: P("p"),
      shapeType: 108,
      transform: xform(0, 0),
    },
    { op: "insert-text", shapeId: S("title"), offset: 0, text: "The Title" },
    { op: "insert-text", shapeId: S("body"), offset: 0, text: "Some body" },
  ];
  for (const op of ops) applySlidesOperation(m, op);
  return m;
}

describe("renderSlide geometry + classification", () => {
  test("resolves transform to fractional boxes (left/top/width/height)", () => {
    const slide = renderSlide(build("TITLE"), 0);
    const title = slide?.shapes.find((s) => s.role === "title");
    expect(title?.left).toBeCloseTo(0.1, 5); // translateX = BASE => 0.1 of page
    expect(title?.top).toBeCloseTo(0.1, 5);
    expect(title?.width).toBeCloseTo(0.2, 5); // scaleX 2 * BASE / (10*BASE)
    expect(title?.height).toBeCloseTo(0.1, 5);
  });

  test("topmost text shape is the title; a TITLE layout centers all its text", () => {
    const slide = renderSlide(build("TITLE"), 0);
    const title = slide?.shapes.find((s) => s.role === "title");
    expect(title?.text).toBe("The Title");
    expect(title?.align).toBe("center");
    // A pure title slide centers the subtitle too (matches Google's TITLE layout).
    const body = slide?.shapes.find((s) => s.role === "body" && s.kind === "text");
    expect(body?.text).toBe("Some body");
    expect(body?.align).toBe("center");
  });

  test("a content layout left-aligns the title", () => {
    const slide = renderSlide(build("TITLE_AND_BODY"), 0);
    expect(slide?.shapes.find((s) => s.role === "title")?.align).toBe("left");
  });

  test("non-text media becomes a labeled placeholder; bg + empty are skipped", () => {
    const slide = renderSlide(build("TITLE"), 0);
    const media = slide?.shapes.filter((s) => s.kind === "media") ?? [];
    expect(media.length).toBe(1);
    expect(media[0]?.label).toBe("media");
    // title + body + pic = 3; bg(158) and empty text are skipped.
    expect(slide?.shapes.length).toBe(3);
  });

  test("exposes background, text colour, aspect ratio, index, and pageId", () => {
    const slide = renderSlide(build("TITLE"), 0);
    expect(slide?.background).toBe("#FFFFFF");
    expect(slide?.textColor).toBe("#000000"); // theme palette[0]
    expect(slide?.aspectRatio).toBe(1);
    expect(slide?.index).toBe(0);
    expect(slide?.pageId).toBe(P("p"));
  });
});

describe("edge cases + helpers", () => {
  test("renderSlide returns null for an out-of-range index", () => {
    expect(renderSlide(build("TITLE"), 5)).toBeNull();
  });

  test("a null-transform text shape is skipped", () => {
    const m = createModel();
    for (const op of [
      { op: "define-page", pageId: P("p"), pageType: "slide", theme: null },
      { op: "create-shape", shapeId: S("t"), parentId: P("p"), shapeType: 108, transform: null },
      { op: "insert-text", shapeId: S("t"), offset: 0, text: "orphan" },
    ] satisfies SlidesOperation[]) {
      applySlidesOperation(m, op);
    }
    expect(renderSlide(m, 0)?.shapes).toEqual([]);
  });

  test("falls back to a 16:9 page and white background with no page-size/theme", () => {
    const m = createModel();
    applySlidesOperation(m, { op: "define-page", pageId: P("p"), pageType: "slide", theme: null });
    const slide = renderSlide(m, 0);
    expect(slide?.aspectRatio).toBeCloseTo(16 / 9, 2);
    expect(slide?.background).toBe("#FFFFFF");
  });

  test("renderSlides projects every slide; slideCount + hasFidelityNotice report state", () => {
    const m = build("TITLE");
    expect(renderSlides(m).length).toBe(1);
    expect(slideCount(m)).toBe(1);
    expect(hasFidelityNotice(m)).toBe(false);
    m.fidelityNotices.push({ kind: "unknown-op", detail: "1" });
    expect(hasFidelityNotice(m)).toBe(true);
  });
});
