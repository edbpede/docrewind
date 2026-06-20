// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "bun:test";
import {
  BAND_ANCHOR,
  BAND_BOTTOM,
  BAND_TOP,
  caretVisibility,
  followScroll,
} from "@/lib/replay/follow";

const VH = 1000; // a round viewport height keeps the band maths obvious.

describe("followScroll (dead-zone hysteresis)", () => {
  it("does not scroll while the caret sits inside the band", () => {
    // Band is [200, 780] on a 1000px viewport; a caret at 400–420 is comfortably in.
    const decision = followScroll(400, 420, VH, 0);
    expect(decision.scroll).toBe(false);
    expect(decision.top).toBe(0);
  });

  it("does not scroll for a caret hugging either inner edge of the band", () => {
    expect(followScroll(VH * BAND_TOP, VH * BAND_TOP + 20, VH, 0).scroll).toBe(false);
    expect(followScroll(VH * BAND_BOTTOM - 20, VH * BAND_BOTTOM, VH, 0).scroll).toBe(false);
  });

  it("recenters to the anchor when the caret falls below the band", () => {
    // Caret near the bottom of the screen (900) → scroll down so it lands on the anchor.
    const scrollY = 500;
    const decision = followScroll(900, 920, VH, scrollY);
    expect(decision.scroll).toBe(true);
    expect(decision.top).toBe(scrollY + 900 - VH * BAND_ANCHOR);
  });

  it("recenters to the anchor when the caret rises above the band", () => {
    // Caret above the band (50) with the page already scrolled down → scroll up.
    const scrollY = 800;
    const decision = followScroll(50, 70, VH, scrollY);
    expect(decision.scroll).toBe(true);
    expect(decision.top).toBe(scrollY + 50 - VH * BAND_ANCHOR);
  });

  it("clamps the target scroll to zero (never scrolls past the top)", () => {
    // Caret far above the viewport while only slightly scrolled: the anchor target
    // is negative, so it clamps to 0 — and 0 differs from scrollY, so it DOES scroll.
    const decision = followScroll(-500, -480, VH, 100);
    expect(decision.scroll).toBe(true);
    expect(decision.top).toBe(0);
  });

  it("does not scroll when already at the top and the caret can rise no further", () => {
    // scrollY 0 + a negative anchor target that clamps to 0 == current scroll → no-op.
    expect(followScroll(10, 30, VH, 0).scroll).toBe(false);
  });

  it("treats a sub-pixel correction as no scroll (avoids churn)", () => {
    // Construct a caret just outside the band whose anchor target ≈ current scrollY.
    const scrollY = 100;
    const caretTop = VH * BAND_ANCHOR + scrollY - 100.4; // target − scrollY ≈ 0.4px
    const decision = followScroll(caretTop, VH * BAND_BOTTOM + 5, VH, scrollY);
    expect(decision.scroll).toBe(false);
  });

  it("honors a custom band", () => {
    // A tight band [100, 200] makes a mid-screen caret out-of-band.
    const decision = followScroll(500, 520, VH, 0, { top: 0.1, bottom: 0.2, anchor: 0.1 });
    expect(decision.scroll).toBe(true);
    expect(decision.top).toBe(500 - VH * 0.1);
  });
});

describe("caretVisibility", () => {
  it("is visible when the caret overlaps the viewport", () => {
    expect(caretVisibility(100, 120, VH)).toBe("visible");
    expect(caretVisibility(0, 20, VH)).toBe("visible");
    expect(caretVisibility(VH - 5, VH + 50, VH)).toBe("visible");
  });

  it("is above when the caret is fully past the top edge", () => {
    expect(caretVisibility(-40, -10, VH)).toBe("above");
    expect(caretVisibility(-100, 0, VH)).toBe("above");
  });

  it("is below when the caret is fully past the bottom edge", () => {
    expect(caretVisibility(VH + 10, VH + 30, VH)).toBe("below");
    expect(caretVisibility(VH, VH + 20, VH)).toBe("below");
  });
});
