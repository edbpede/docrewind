// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit + golden tests for `slideIndexOfRevision` — the revision→slide join that
// powers "follow edits" across a multi-slide deck. Synthetic models exercise every
// op arm; the captured-live fixture proves it holds on the real reverse-engineered
// grammar (the same 112-revision, two-slide capture the golden reconstruction test
// pins).

import { describe, expect, test } from "bun:test";
import { unsafeAsRevisionId } from "@/lib/core/domain/ids";
import { SLIDES_CAPTURED_HISTORY } from "@/lib/core/fixtures/slides-captured";
import { decodeSlidesOperations, decodeSlidesSnapshot } from "@/lib/core/slides/decoder/decode";
import {
  type PageId,
  type ShapeId,
  type SlidesDecodedRevision,
  type SlidesOperation,
  unsafeAsPageId,
  unsafeAsShapeId,
} from "@/lib/core/slides/decoder/types";
import { applySlidesOperation } from "./apply";
import { slideIndexOfRevision } from "./attribution";
import { createModel, type PresentationModel } from "./model";
import { buildSlidesReplayIndex, presentationAtRevisionIndex } from "./snapshot";

const P = (id: string): PageId => unsafeAsPageId(id);
const S = (id: string): ShapeId => unsafeAsShapeId(id);

/** A model with two slides (p → 0, p2 → 1), a layout page L, and one text box each. */
function twoSlideModel(): PresentationModel {
  const m = createModel();
  applySlidesOperation(m, { op: "define-page", pageId: P("p"), pageType: "slide", theme: null });
  applySlidesOperation(m, { op: "define-page", pageId: P("p2"), pageType: "slide", theme: null });
  applySlidesOperation(m, { op: "define-page", pageId: P("L"), pageType: "layout", theme: null });
  applySlidesOperation(m, {
    op: "create-shape",
    shapeId: S("s0"),
    parentId: P("p"),
    shapeType: 108,
    transform: null,
  });
  applySlidesOperation(m, {
    op: "create-shape",
    shapeId: S("s1"),
    parentId: P("p2"),
    shapeType: 108,
    transform: null,
  });
  applySlidesOperation(m, {
    op: "create-shape",
    shapeId: S("sL"),
    parentId: P("L"),
    shapeType: 108,
    transform: null,
  });
  return m;
}

function rev(operations: SlidesOperation[]): SlidesDecodedRevision {
  return {
    revisionId: unsafeAsRevisionId(1),
    userId: null,
    sessionId: null,
    time: null,
    operations,
    modelVersion: 0,
    modelVersionMismatch: false,
  };
}

describe("slideIndexOfRevision — op arms", () => {
  const model = twoSlideModel();

  test("returns null for a revision with no slide-locating ops", () => {
    expect(slideIndexOfRevision(model, rev([]))).toBeNull();
    expect(slideIndexOfRevision(model, rev([{ op: "marker" }, { op: "text-style" }]))).toBeNull();
  });

  test("insert-text resolves through shape → page → slide index", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "insert-text", shapeId: S("s0"), offset: 0, text: "hi" }]),
      ),
    ).toBe(0);
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "insert-text", shapeId: S("s1"), offset: 0, text: "hi" }]),
      ),
    ).toBe(1);
  });

  test("delete-text resolves to the shape's slide", () => {
    expect(
      slideIndexOfRevision(model, rev([{ op: "delete-text", shapeId: S("s1"), start: 0, end: 1 }])),
    ).toBe(1);
  });

  test("create-shape resolves via its parent page", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([
          {
            op: "create-shape",
            shapeId: S("x"),
            parentId: P("p2"),
            shapeType: 108,
            transform: null,
          },
        ]),
      ),
    ).toBe(1);
  });

  test("define-page of a slide resolves to that slide's index", () => {
    // The model already carries p2 at index 1; a revision that (re-)declares it as a
    // slide attributes to index 1 — the "a new slide arrived" follow case.
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "define-page", pageId: P("p2"), pageType: "slide", theme: null }]),
      ),
    ).toBe(1);
  });

  test("define-page of a non-slide page (layout) is not slide-locating", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "define-page", pageId: P("L"), pageType: "layout", theme: null }]),
      ),
    ).toBeNull();
  });

  test("edits confined to a layout/master page return null", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "insert-text", shapeId: S("sL"), offset: 0, text: "x" }]),
      ),
    ).toBeNull();
  });

  test("a text op on a missing shape returns null", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "insert-text", shapeId: S("ghost"), offset: 0, text: "x" }]),
      ),
    ).toBeNull();
  });

  test("txn recursion attributes to its inner op's slide", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "txn", ops: [{ op: "insert-text", shapeId: S("s1"), offset: 0, text: "hi" }] }]),
      ),
    ).toBe(1);
  });

  test("a revision spanning two slides attributes to the LAST touched slide", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([
          { op: "insert-text", shapeId: S("s1"), offset: 0, text: "b" },
          { op: "insert-text", shapeId: S("s0"), offset: 0, text: "a" },
        ]),
      ),
    ).toBe(0);
  });

  test("an unknown op alone is not slide-locating", () => {
    expect(
      slideIndexOfRevision(
        model,
        rev([{ op: "unknown", opCode: "999", byteLength: 4, revisionId: unsafeAsRevisionId(1) }]),
      ),
    ).toBeNull();
  });
});

describe("slideIndexOfRevision — captured-live golden", () => {
  const envelope = SLIDES_CAPTURED_HISTORY.envelope;
  const revisions = decodeSlidesOperations(envelope);
  const baseOps = decodeSlidesSnapshot(envelope);
  const index = buildSlidesReplayIndex(revisions, 20, baseOps);

  test("every revision attributes within the deck it produced (never out of range)", () => {
    for (let n = 1; n <= revisions.length; n++) {
      const model = presentationAtRevisionIndex(index, n);
      const revision = revisions[n - 1];
      if (revision === undefined) continue;
      const slide = slideIndexOfRevision(model, revision);
      if (slide !== null) {
        expect(slide).toBeGreaterThanOrEqual(0);
        expect(slide).toBeLessThan(model.slideOrder.length);
      }
    }
  });

  test("follow moves to the second slide once its edits begin", () => {
    // The frame the deck first reaches two slides.
    let firstTwoSlideRev = -1;
    for (let n = 1; n <= revisions.length; n++) {
      if (presentationAtRevisionIndex(index, n).slideOrder.length === 2) {
        firstTwoSlideRev = n;
        break;
      }
    }
    expect(firstTwoSlideRev).toBeGreaterThan(0);

    // Before slide 2 exists, no revision can attribute to index 1.
    for (let n = 1; n < firstTwoSlideRev; n++) {
      const model = presentationAtRevisionIndex(index, n);
      const revision = revisions[n - 1];
      if (revision === undefined) continue;
      const slide = slideIndexOfRevision(model, revision);
      if (slide !== null) expect(slide).toBe(0);
    }

    // From that point on, at least one revision attributes to slide index 1 — the
    // follow target the old code never moved to.
    let sawSlideTwo = false;
    for (let n = firstTwoSlideRev; n <= revisions.length; n++) {
      const model = presentationAtRevisionIndex(index, n);
      const revision = revisions[n - 1];
      if (revision === undefined) continue;
      if (slideIndexOfRevision(model, revision) === 1) {
        sawSlideTwo = true;
        break;
      }
    }
    expect(sawSlideTwo).toBe(true);
  });
});
