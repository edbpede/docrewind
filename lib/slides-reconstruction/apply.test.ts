// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for the Slides reconstruction apply engine: every op arm, text
// insert/delete folding + clamping, slide registration/dedup, theme capture, and
// the honest fidelity-notice paths (unknown op, model-version mismatch).

import { describe, expect, test } from "bun:test";
import { unsafeAsRevisionId } from "../domain/ids";
import {
  type PageId,
  type ShapeId,
  type SlidesDecodedRevision,
  type SlidesOperation,
  unsafeAsPageId,
  unsafeAsShapeId,
} from "../slides-decoder/types";
import { applySlidesOperation, applySlidesRevision } from "./apply";
import { createModel, type PresentationModel } from "./model";

const P = (id: string): PageId => unsafeAsPageId(id);
const S = (id: string): ShapeId => unsafeAsShapeId(id);

function createShape(id: string, parent: string, type = 108): SlidesOperation {
  return {
    op: "create-shape",
    shapeId: S(id),
    parentId: P(parent),
    shapeType: type,
    transform: null,
  };
}

function apply(model: PresentationModel, ...ops: SlidesOperation[]): void {
  for (const op of ops) applySlidesOperation(model, op);
}

describe("page + shape structure", () => {
  test("define-page registers a slide in slideOrder (deduped)", () => {
    const m = createModel();
    apply(m, { op: "define-page", pageId: P("p"), pageType: "slide", theme: null });
    apply(m, { op: "define-page", pageId: P("p"), pageType: "slide", theme: null });
    expect(m.slideOrder).toEqual([P("p")]);
    expect(m.pages.get(P("p"))?.pageType).toBe("slide");
  });

  test("layout/master pages are registered but not in slideOrder", () => {
    const m = createModel();
    apply(m, { op: "define-page", pageId: P("l"), pageType: "layout", theme: null });
    apply(m, { op: "define-page", pageId: P("m"), pageType: "master", theme: null });
    expect(m.slideOrder).toEqual([]);
    expect(m.pages.size).toBe(2);
  });

  test("first themed palette wins; later themes are ignored", () => {
    const m = createModel();
    apply(m, {
      op: "define-page",
      pageId: P("m"),
      pageType: "master",
      theme: { name: "A", palette: ["#111111", "#ffffff"] },
    });
    apply(m, {
      op: "define-page",
      pageId: P("m2"),
      pageType: "master",
      theme: { name: "B", palette: ["#222222", "#000000"] },
    });
    expect(m.theme?.name).toBe("A");
  });

  test("create-shape registers a shape once; re-create keeps text, refreshes geometry", () => {
    const m = createModel();
    apply(m, createShape("i0", "p"));
    apply(m, { op: "insert-text", shapeId: S("i0"), offset: 0, text: "Hi" });
    apply(m, {
      op: "create-shape",
      shapeId: S("i0"),
      parentId: P("p"),
      shapeType: 6,
      transform: { scaleX: 1, shearY: 0, shearX: 0, scaleY: 1, translateX: 5, translateY: 6 },
    });
    expect(m.shapeOrder).toEqual([S("i0")]);
    const shape = m.shapes.get(S("i0"));
    expect(shape?.text).toBe("Hi");
    expect(shape?.shapeType).toBe(6);
    expect(shape?.transform?.translateX).toBe(5);
  });

  test("declare-placeholder sets a page's layout type; missing page is a no-op", () => {
    const m = createModel();
    apply(m, { op: "define-page", pageId: P("p"), pageType: "slide", theme: null });
    apply(m, { op: "declare-placeholder", pageId: P("p"), layoutType: "TITLE" });
    apply(m, { op: "declare-placeholder", pageId: P("ghost"), layoutType: "BODY" });
    expect(m.pages.get(P("p"))?.layoutType).toBe("TITLE");
    expect(m.pages.get(P("ghost"))).toBeUndefined();
  });
});

describe("text folding", () => {
  test("insert-text splices at the offset; clamps an out-of-range offset", () => {
    const m = createModel();
    apply(m, createShape("t", "p"));
    apply(m, { op: "insert-text", shapeId: S("t"), offset: 0, text: "world" });
    apply(m, { op: "insert-text", shapeId: S("t"), offset: 0, text: "hello " });
    apply(m, { op: "insert-text", shapeId: S("t"), offset: 999, text: "!" });
    expect(m.shapes.get(S("t"))?.text).toBe("hello world!");
  });

  test("delete-text removes the clamped half-open range", () => {
    const m = createModel();
    apply(m, createShape("t", "p"));
    apply(m, { op: "insert-text", shapeId: S("t"), offset: 0, text: "abcdef" });
    apply(m, { op: "delete-text", shapeId: S("t"), start: 1, end: 3 });
    expect(m.shapes.get(S("t"))?.text).toBe("adef");
    apply(m, { op: "delete-text", shapeId: S("t"), start: 2, end: 999 });
    expect(m.shapes.get(S("t"))?.text).toBe("ad");
  });

  test("text ops on a missing shape are ignored (no throw, no shape)", () => {
    const m = createModel();
    apply(m, { op: "insert-text", shapeId: S("ghost"), offset: 0, text: "x" });
    apply(m, { op: "delete-text", shapeId: S("ghost"), start: 0, end: 1 });
    expect(m.shapes.size).toBe(0);
  });
});

describe("page size + txn + inert + fidelity", () => {
  test("page-size sets the model page size", () => {
    const m = createModel();
    apply(m, { op: "page-size", width: 365760, height: 205740 });
    expect(m.pageSize).toEqual({ width: 365760, height: 205740 });
  });

  test("txn applies nested ops in order", () => {
    const m = createModel();
    apply(m, {
      op: "txn",
      ops: [
        { op: "define-page", pageId: P("p"), pageType: "slide", theme: null },
        createShape("i0", "p"),
        { op: "insert-text", shapeId: S("i0"), offset: 0, text: "Deck" },
      ],
    });
    expect(m.slideOrder).toEqual([P("p")]);
    expect(m.shapes.get(S("i0"))?.text).toBe("Deck");
  });

  test.each<SlidesOperation>([
    { op: "shape-prop" },
    { op: "create-page" },
    { op: "page-membership" },
    { op: "text-style" },
    { op: "marker" },
    { op: "list-entity" },
    { op: "default-style" },
  ])("inert op %o changes nothing", (op) => {
    const m = createModel();
    apply(m, op);
    expect(m).toEqual(createModel());
  });

  test("unknown op raises a single deduplicated fidelity notice", () => {
    const m = createModel();
    const unknown: SlidesOperation = {
      op: "unknown",
      opCode: "777",
      byteLength: 10,
      revisionId: unsafeAsRevisionId(1),
    };
    apply(m, unknown, unknown);
    expect(m.fidelityNotices).toEqual([{ kind: "unknown-op", detail: "777" }]);
  });

  test("a model-version mismatch raises a fidelity notice per revision", () => {
    const m = createModel();
    const revision: SlidesDecodedRevision = {
      revisionId: unsafeAsRevisionId(1),
      userId: null,
      sessionId: null,
      time: null,
      operations: [{ op: "marker" }],
      modelVersion: 5,
      modelVersionMismatch: true,
    };
    applySlidesRevision(m, revision);
    expect(m.fidelityNotices).toEqual([{ kind: "model-version-mismatch", detail: "5" }]);
  });
});
