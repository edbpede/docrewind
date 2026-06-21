// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Component tests for the advanced-view charts (components/DocumentSummary): the
// length-ceiling and document-position Y-axis captions, the high-resolution hour
// axis for short single-session spans, and the synchronized hover scrub + tooltip
// that correlates activity with document position across BOTH charts.

import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import DocumentSummary from "@/components/DocumentSummary";
import type { Operation } from "@/lib/decoder/types";
import { asRevisionId } from "@/lib/domain/ids";
import type { DecodedRevision } from "@/lib/domain/model";
import { formatHourLabel, strings, summaryCharCount } from "@/lib/i18n/strings";
import { buildHourTicks } from "@/lib/summary/axis";

const HOUR = 3_600_000;
const DAY = 86_400_000;

function rev(id: number, time: number | null, operations: readonly Operation[]): DecodedRevision {
  return { revisionId: asRevisionId(id), userId: null, sessionId: null, time, operations };
}

function insert(s: string, ibi: number): Operation {
  return { ty: "is", s, ibi };
}

/** jsdom returns a zero-sized rect; stub a real width so the pointer→time mapping
 *  in `moveHover` has something to project against. */
function stubRect(el: HTMLElement, width = 1000): void {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: 200,
      width,
      height: 200,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
}

describe("DocumentSummary", () => {
  afterEach(() => cleanup());

  it("labels the length ceiling and the document-position bounds", () => {
    const t0 = Date.UTC(2026, 5, 21, 12, 0, 0);
    const { container } = render(() => (
      <DocumentSummary
        revisions={[
          rev(1, t0, [insert("hello", 1)]),
          rev(2, t0 + DAY, [insert(" world", 6)]),
          rev(3, t0 + 2 * DAY, [insert("!", 12)]),
        ]}
      />
    ));

    // Activity chart: a caption announcing the peak document length (12 chars).
    expect(screen.getByText(summaryCharCount(12))).toBeTruthy();
    // Position chart: top/bottom orientation captions.
    expect(screen.getByText(strings.summary.axisDocStart)).toBeTruthy();
    expect(screen.getByText(strings.summary.axisDocEnd)).toBeTruthy();
    // Both charts render, with a scatter point per positioned edit.
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("subdivides the x-axis into hour ticks for a short single-day span", () => {
    const start = new Date(2026, 5, 21, 9, 23).getTime();
    const end = start + 2 * HOUR + 59 * 60 * 1000;
    const { container } = render(() => (
      <DocumentSummary
        revisions={[
          rev(1, start, [insert("a", 1)]),
          rev(2, start + HOUR, [insert("b", 2)]),
          rev(3, start + 2 * HOUR, [insert("c", 3)]),
          rev(4, end, [insert("d", 4)]),
        ]}
      />
    ));

    // Day mode for a sub-day span would collapse to a single label per chart (2
    // total); the hour axis subdivides it into several.
    const ticks = container.querySelectorAll("[data-axis-tick]");
    expect(ticks.length).toBeGreaterThan(2);

    // An interior hour tick renders as a clock-time label (locale-agnostic: both
    // sides go through the same formatter).
    const hourTicks = buildHourTicks(start, end);
    const interior = hourTicks[1];
    expect(interior).toBeDefined();
    const axisText = [...ticks].map((el) => el.textContent).join("|");
    expect(axisText).toContain(formatHourLabel(interior ?? 0, false));
  });

  it("scrubs both charts and floats a tooltip while hovering", () => {
    const t0 = Date.UTC(2026, 5, 21, 12, 0, 0);
    const { container } = render(() => (
      <DocumentSummary
        revisions={[
          rev(1, t0, [insert("hello", 1)]),
          rev(2, t0 + DAY, [insert(" world", 6)]),
          rev(3, t0 + 2 * DAY, [insert("!", 12)]),
        ]}
      />
    ));

    // No scrub feedback at rest.
    expect(container.querySelector(".dr-sum-tip")).toBeNull();
    expect(container.querySelectorAll("[data-scrub]").length).toBe(0);

    const activity = container.querySelector('[data-chart="activity"]') as HTMLElement;
    stubRect(activity);
    fireEvent.pointerMove(activity, { clientX: 500 });

    // The tooltip floats over the hovered chart with content-free stats.
    const tip = container.querySelector(".dr-sum-tip");
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toContain("chars");
    // The scrub line is mirrored across BOTH charts (cross-chart correlation).
    expect(container.querySelectorAll("[data-scrub]").length).toBe(2);

    // Leaving the chart clears the shared hover state.
    fireEvent.pointerLeave(activity);
    expect(container.querySelector(".dr-sum-tip")).toBeNull();
    expect(container.querySelectorAll("[data-scrub]").length).toBe(0);
  });
});
