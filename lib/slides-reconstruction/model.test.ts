// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for the Slides presentation model factory + deep clone (the spine
// clones snapshots, so aliasing a nested map/array/transform would corrupt scrubbing).

import { describe, expect, test } from "bun:test";
import { unsafeAsPageId, unsafeAsShapeId } from "../slides-decoder/types";
import { cloneModel, createModel } from "./model";

describe("createModel", () => {
  test("is empty", () => {
    const m = createModel();
    expect(m.pageSize).toBeNull();
    expect(m.pages.size).toBe(0);
    expect(m.slideOrder).toEqual([]);
    expect(m.shapes.size).toBe(0);
    expect(m.shapeOrder).toEqual([]);
    expect(m.theme).toBeNull();
    expect(m.fidelityNotices).toEqual([]);
  });
});

describe("cloneModel", () => {
  test("is a deep copy — mutating the clone never touches the original", () => {
    const m = createModel();
    m.pageSize = { width: 100, height: 50 };
    m.pages.set(unsafeAsPageId("p"), {
      id: unsafeAsPageId("p"),
      pageType: "slide",
      layoutType: "TITLE",
    });
    m.slideOrder.push(unsafeAsPageId("p"));
    m.shapes.set(unsafeAsShapeId("i0"), {
      id: unsafeAsShapeId("i0"),
      pageId: unsafeAsPageId("p"),
      shapeType: 108,
      transform: { scaleX: 1, shearY: 0, shearX: 0, scaleY: 1, translateX: 2, translateY: 3 },
      text: "Hi",
    });
    m.shapeOrder.push(unsafeAsShapeId("i0"));
    m.theme = { name: "T", palette: ["#000000", "#FFFFFF"] };
    m.fidelityNotices.push({ kind: "unknown-op", detail: "1" });

    const clone = cloneModel(m);
    const clonedPage = clone.pages.get(unsafeAsPageId("p"));
    const clonedShape = clone.shapes.get(unsafeAsShapeId("i0"));
    if (clone.pageSize === null || clonedPage === undefined || clonedShape === undefined) {
      throw new Error("clone lost a nested container");
    }
    // Mutate every nested container on the clone (readonly Transform/palette are
    // reassigned wholesale — the same way the apply engine replaces them).
    clone.pageSize.width = 999;
    clonedPage.layoutType = "BODY";
    clone.slideOrder.push(unsafeAsPageId("q"));
    clonedShape.text = "changed";
    clonedShape.transform = {
      scaleX: 9,
      shearY: 0,
      shearX: 0,
      scaleY: 9,
      translateX: 42,
      translateY: 99,
    };
    clone.shapeOrder.push(unsafeAsShapeId("z"));
    clone.theme = { name: "Changed", palette: ["#123456"] };
    clone.fidelityNotices.push({ kind: "model-version-mismatch", detail: "9" });

    expect(m.pageSize).toEqual({ width: 100, height: 50 });
    expect(m.pages.get(unsafeAsPageId("p"))?.layoutType).toBe("TITLE");
    expect(m.slideOrder).toEqual([unsafeAsPageId("p")]);
    expect(m.shapes.get(unsafeAsShapeId("i0"))?.text).toBe("Hi");
    expect(m.shapes.get(unsafeAsShapeId("i0"))?.transform?.translateX).toBe(2);
    expect(m.shapeOrder).toEqual([unsafeAsShapeId("i0")]);
    expect(m.theme?.palette).toEqual(["#000000", "#FFFFFF"]);
    expect(m.fidelityNotices).toEqual([{ kind: "unknown-op", detail: "1" }]);
  });

  test("clones a null-transform shape and an empty model faithfully", () => {
    const m = createModel();
    m.shapes.set(unsafeAsShapeId("x"), {
      id: unsafeAsShapeId("x"),
      pageId: unsafeAsPageId("p"),
      shapeType: 6,
      transform: null,
      text: "",
    });
    const clone = cloneModel(m);
    expect(clone.shapes.get(unsafeAsShapeId("x"))?.transform).toBeNull();
    expect(cloneModel(createModel())).toEqual(createModel());
  });
});
