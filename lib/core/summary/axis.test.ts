// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit tests for the pure document-summary axis math: short-span detection,
// hour-stride selection, hour/day tick generation, and the hover nearest-point
// binary search. Assertions are timezone-robust — they build and read timestamps
// through the same local `Date`, and check structural properties (on-the-hour
// alignment, range containment, monotonicity) rather than locale-formatted text.

import { describe, expect, it } from "bun:test";
import {
  buildDayTicks,
  buildHourTicks,
  hourStepHours,
  isShortSpan,
  linearTicks,
  nearestPoint,
  niceStep,
  ONE_HOUR_MS,
  SHORT_SPAN_MS,
} from "./axis";
import type { SummaryPoint } from "./derive";

function point(t: number): SummaryPoint {
  return { t, length: 0, pos: -1 };
}

describe("isShortSpan", () => {
  it("is true for a real span up to the 36h threshold", () => {
    expect(isShortSpan(0, ONE_HOUR_MS)).toBe(true);
    expect(isShortSpan(0, 25 * ONE_HOUR_MS)).toBe(true);
    expect(isShortSpan(0, SHORT_SPAN_MS)).toBe(true);
  });

  it("is false past the threshold and for empty/negative spans", () => {
    expect(isShortSpan(0, SHORT_SPAN_MS + 1)).toBe(false);
    expect(isShortSpan(0, 0)).toBe(false);
    expect(isShortSpan(10, 5)).toBe(false);
  });
});

describe("hourStepHours", () => {
  it("widens the stride as the span grows", () => {
    expect(hourStepHours(6 * ONE_HOUR_MS)).toBe(1);
    expect(hourStepHours(6 * ONE_HOUR_MS + 1)).toBe(2);
    expect(hourStepHours(12 * ONE_HOUR_MS)).toBe(2);
    expect(hourStepHours(12 * ONE_HOUR_MS + 1)).toBe(3);
    expect(hourStepHours(24 * ONE_HOUR_MS)).toBe(3);
    expect(hourStepHours(24 * ONE_HOUR_MS + 1)).toBe(6);
    expect(hourStepHours(SHORT_SPAN_MS)).toBe(6);
  });
});

describe("buildHourTicks", () => {
  it("emits on-the-hour ticks within range for a short span", () => {
    const start = new Date(2026, 5, 21, 9, 23).getTime();
    const end = new Date(2026, 5, 21, 12, 22).getTime();
    const ticks = buildHourTicks(start, end);

    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(start);
      expect(t).toBeLessThanOrEqual(end);
      const d = new Date(t);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
      // step = 1h for a sub-6h span, so every hour is a valid boundary.
      expect(d.getHours() % hourStepHours(end - start)).toBe(0);
    }
    // Strictly increasing.
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i] ?? 0) > (ticks[i - 1] ?? 0)).toBe(true);
    }
  });

  it("aligns ticks to multiples of the stride for a wider short span", () => {
    // ~30h span → 6h stride; every tick's local hour is a multiple of 6.
    const start = new Date(2026, 5, 21, 8, 0).getTime();
    const end = start + 30 * ONE_HOUR_MS;
    const ticks = buildHourTicks(start, end);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(new Date(t).getHours() % 6).toBe(0);
    }
  });

  it("returns nothing for a non-positive span", () => {
    expect(buildHourTicks(100, 100)).toEqual([]);
    expect(buildHourTicks(100, 50)).toEqual([]);
  });
});

describe("buildDayTicks", () => {
  it("emits local midnights across a multi-day span", () => {
    const start = new Date(2026, 5, 21, 14, 0).getTime();
    const end = new Date(2026, 5, 24, 10, 0).getTime();
    const ticks = buildDayTicks(start, end);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (const t of ticks) {
      const d = new Date(t);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it("returns nothing for a non-positive span", () => {
    expect(buildDayTicks(100, 100)).toEqual([]);
  });
});

describe("nearestPoint", () => {
  const series = [point(0), point(10), point(20), point(30)];

  it("returns null for an empty series", () => {
    expect(nearestPoint([], 5)).toBeNull();
  });

  it("clamps to the endpoints outside the range", () => {
    expect(nearestPoint(series, -5)?.t).toBe(0);
    expect(nearestPoint(series, 999)?.t).toBe(30);
  });

  it("picks the closer neighbor", () => {
    expect(nearestPoint(series, 12)?.t).toBe(10);
    expect(nearestPoint(series, 18)?.t).toBe(20);
    expect(nearestPoint(series, 0)?.t).toBe(0);
    expect(nearestPoint(series, 20)?.t).toBe(20);
  });

  it("breaks an exact tie toward the earlier point", () => {
    expect(nearestPoint(series, 15)?.t).toBe(10);
  });

  it("returns the only point for a single-element series", () => {
    expect(nearestPoint([point(42)], 1000)?.t).toBe(42);
  });
});

describe("niceStep", () => {
  it("snaps a raw step up to 1 / 2 / 5 × a power of ten", () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(2)).toBe(2);
    expect(niceStep(2.1)).toBe(5);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(6)).toBe(10);
    expect(niceStep(30)).toBe(50);
    expect(niceStep(3000)).toBe(5000);
  });

  it("guards non-positive and non-finite input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
    expect(niceStep(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("linearTicks", () => {
  it("emits 0…nice-ceiling ascending with a tidy step", () => {
    const axis = linearTicks(12, 4);
    expect(axis.axisMax).toBe(15);
    expect(axis.ticks).toEqual([0, 5, 10, 15]);
  });

  it("covers the max with a little headroom and always starts at 0", () => {
    const axis = linearTicks(12_000, 4);
    expect(axis.ticks[0]).toBe(0);
    expect(axis.axisMax).toBeGreaterThanOrEqual(12_000);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.axisMax);
    // The step is uniform across the whole axis.
    const step = (axis.ticks[1] ?? 0) - (axis.ticks[0] ?? 0);
    for (let i = 1; i < axis.ticks.length; i++) {
      expect((axis.ticks[i] ?? 0) - (axis.ticks[i - 1] ?? 0)).toBe(step);
    }
  });

  it("never repeats an integer-rounded tick", () => {
    const axis = linearTicks(2, 4);
    expect(new Set(axis.ticks).size).toBe(axis.ticks.length);
  });

  it("degrades to a safe [0, 1] axis for empty / non-finite input", () => {
    expect(linearTicks(0).ticks).toEqual([0, 1]);
    expect(linearTicks(-5).axisMax).toBe(1);
    expect(linearTicks(Number.POSITIVE_INFINITY).axisMax).toBe(1);
  });
});
