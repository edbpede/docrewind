// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import SummaryInsights from "@/components/SummaryInsights";
import Timeline, { type TimelineMarker } from "@/components/Timeline";
import { asRevisionId, asUserId } from "@/lib/domain/ids";
import type { DecodedRevision } from "@/lib/domain/model";

function revision(
  id: number,
  time: number | null = null,
  userId: DecodedRevision["userId"] = null,
): DecodedRevision {
  return {
    revisionId: asRevisionId(id),
    userId,
    sessionId: null,
    time,
    operations: [],
  };
}

describe("replay UI components", () => {
  afterEach(() => cleanup());

  it("scrubs the timeline with pointer input", async () => {
    const onScrub = vi.fn();
    render(() => <Timeline currentIndex={0} max={10} events={[]} onScrub={onScrub} />);
    const slider = screen.getByRole("slider");
    slider.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 10,
        right: 100,
        bottom: 10,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;
    slider.setPointerCapture = vi.fn();
    slider.hasPointerCapture = vi.fn(() => true);
    slider.releasePointerCapture = vi.fn();

    await fireEvent.pointerDown(slider, { pointerId: 1, clientX: 75 });
    await fireEvent.pointerMove(slider, { pointerId: 1, clientX: 25 });
    await fireEvent.pointerUp(slider, { pointerId: 1, clientX: 25 });

    expect(onScrub.mock.calls.map((call) => call[0])).toEqual([8, 3]);
  });

  it("scrubs the timeline with the keyboard (Arrow / Home / End)", async () => {
    const onScrub = vi.fn();
    render(() => <Timeline currentIndex={5} max={10} events={[]} onScrub={onScrub} />);
    const slider = screen.getByRole("slider");

    // Exposes a focusable ARIA slider with the full value contract.
    expect(slider.getAttribute("tabindex")).toBe("0");
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    expect(slider.getAttribute("aria-valuemax")).toBe("10");
    expect(slider.getAttribute("aria-valuenow")).toBe("5");

    await fireEvent.keyDown(slider, { key: "ArrowRight" });
    await fireEvent.keyDown(slider, { key: "ArrowLeft" });
    await fireEvent.keyDown(slider, { key: "Home" });
    await fireEvent.keyDown(slider, { key: "End" });

    // ±1 step from the current index, then clamp to both bounds.
    expect(onScrub.mock.calls.map((call) => call[0])).toEqual([6, 4, 0, 10]);
  });

  it("jumps to accessible timeline markers", async () => {
    const onScrub = vi.fn();
    const events: TimelineMarker[] = [
      { id: "large-4", kind: "large-insertion", index: 4, label: "Large insertion" },
    ];
    render(() => <Timeline currentIndex={0} max={10} events={events} onScrub={onScrub} />);

    await fireEvent.click(screen.getByRole("button", { name: /Large insertion/ }));

    expect(onScrub).toHaveBeenCalledWith(4);
  });

  it("shows replay duration and attribution caveat", () => {
    render(() => (
      <SummaryInsights
        revisions={[
          revision(1, 1_000, asUserId("user-a")),
          revision(2, 61_000, asUserId("user-b")),
        ]}
        timeline={[]}
        realIdentities={true}
      />
    ));

    expect(screen.getByText("Replay duration")).toBeTruthy();
    expect(screen.getByText("1m")).toBeTruthy();
    expect(screen.getByText("user-a")).toBeTruthy();
    expect(screen.getByText("Attribution may be incomplete.")).toBeTruthy();
  });
});
