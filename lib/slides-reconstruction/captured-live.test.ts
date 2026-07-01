// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end golden test over the real sanitized live capture
// (lib/fixtures/slides-captured.ts, 112 revisions). Proves the full pure pipeline
// — decode → snapshot-seeded replay → render — reconstructs the exact slides and
// text that were authored in the editor during the capture. This is the anchor
// that pins the reverse-engineered grammar to observed behaviour.

import { describe, expect, test } from "bun:test";
import { SLIDES_CAPTURED_HISTORY } from "../fixtures/slides-captured";
import { decodeSlidesOperations, decodeSlidesSnapshot } from "../slides-decoder/decode";
import { renderSlides } from "./render";
import { buildSlidesReplayIndex, presentationAtRevisionIndex } from "./snapshot";

const envelope = SLIDES_CAPTURED_HISTORY.envelope;

function finalModel() {
  const revisions = decodeSlidesOperations(envelope);
  const baseOps = decodeSlidesSnapshot(envelope);
  const index = buildSlidesReplayIndex(revisions, 20, baseOps);
  return { revisions, model: presentationAtRevisionIndex(index, revisions.length) };
}

describe("slides captured-live golden", () => {
  test("decodes all 112 revisions without throwing", () => {
    const revisions = decodeSlidesOperations(envelope);
    expect(revisions.length).toBe(112);
  });

  test("reconstructs exactly two user-visible slides in order", () => {
    const { model } = finalModel();
    expect(model.slideOrder.length).toBe(2);
  });

  test("reconstructs the authored slide text verbatim", () => {
    const { model } = finalModel();
    const slides = renderSlides(model);
    expect(slides.length).toBe(2);

    const slide1Text = slides[0]?.shapes.map((s) => s.text) ?? [];
    expect(slide1Text).toContain("DocRewind Slides");
    expect(slide1Text).toContain("Reverse engineering revision history");

    const slide2Text = slides[1]?.shapes.map((s) => s.text) ?? [];
    expect(slide2Text).toContain("Agenda");
    expect(slide2Text).toContain("Point one\nPoint two");
  });

  test("titles are identified and the title-slide title is centered", () => {
    const { model } = finalModel();
    const slides = renderSlides(model);
    const slide1Title = slides[0]?.shapes.find((s) => s.role === "title");
    expect(slide1Title?.text).toBe("DocRewind Slides");
    expect(slide1Title?.align).toBe("center");
  });

  test("resolves a 16:9 page and a white theme background", () => {
    const { model } = finalModel();
    const slides = renderSlides(model);
    expect(slides[0]?.background).toBe("#FFFFFF");
    // 365760x205740 => 16:9 (1.777…)
    expect(slides[0]?.aspectRatio).toBeCloseTo(16 / 9, 2);
  });

  test("clean capture raises no fidelity notices", () => {
    const { model } = finalModel();
    expect(model.fidelityNotices).toEqual([]);
  });

  test("scrubbing to an early revision shows only the first slide", () => {
    const { revisions } = finalModel();
    const baseOps = decodeSlidesSnapshot(envelope);
    const index = buildSlidesReplayIndex(revisions, 20, baseOps);
    // Revision 1 (the initial template txn) creates slide "p" but not the 2nd slide.
    const early = presentationAtRevisionIndex(index, 1);
    expect(early.slideOrder.length).toBe(1);
  });
});
