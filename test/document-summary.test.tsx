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
import { formatHourLabel, strings } from "@/lib/i18n/strings";
import { buildHourTicks } from "@/lib/summary/axis";
import { deriveDocumentSummary } from "@/lib/summary/derive";

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

  it("renders a quantitative length scale and document-position bounds", () => {
    const t0 = Date.UTC(2026, 5, 21, 12, 0, 0);
    const { container } = render(() => (
      <DocumentSummary
        summary={deriveDocumentSummary([
          rev(1, t0, [insert("hello", 1)]),
          rev(2, t0 + DAY, [insert(" world", 6)]),
          rev(3, t0 + 2 * DAY, [insert("!", 12)]),
        ])}
      />
    ));

    // Both charts now carry a labelled Y axis (a gutter of ticks each), not a lone
    // ceiling caption: a length scale on the activity chart, position bounds on the
    // scatter. Read them from the dedicated tick column.
    const yTicks = [...container.querySelectorAll("[data-yaxis-tick]")].map((el) => el.textContent);
    // Activity length scale: a 0 baseline up to a tidy ceiling above the 12-char peak.
    expect(yTicks).toContain("0");
    expect(yTicks).toContain("15");
    // Position scale: plain-language ends plus an interior percentage gridline.
    expect(yTicks).toContain(strings.summary.axisDocStart);
    expect(yTicks).toContain(strings.summary.axisDocEnd);
    expect(yTicks).toContain("50%");

    // Both charts render, with a scatter point per positioned edit.
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("subdivides the x-axis into hour ticks for a short single-day span", () => {
    const start = new Date(2026, 5, 21, 9, 23).getTime();
    const end = start + 2 * HOUR + 59 * 60 * 1000;
    const { container } = render(() => (
      <DocumentSummary
        summary={deriveDocumentSummary([
          rev(1, start, [insert("a", 1)]),
          rev(2, start + HOUR, [insert("b", 2)]),
          rev(3, start + 2 * HOUR, [insert("c", 3)]),
          rev(4, end, [insert("d", 4)]),
        ])}
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
        summary={deriveDocumentSummary([
          rev(1, t0, [insert("hello", 1)]),
          rev(2, t0 + DAY, [insert(" world", 6)]),
          rev(3, t0 + 2 * DAY, [insert("!", 12)]),
        ])}
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
