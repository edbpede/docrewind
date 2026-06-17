// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SummaryInsights from "@/components/SummaryInsights";
import Timeline, { clusterMarkers, type TimelineMarker } from "@/components/Timeline";
import TimelineLegend from "@/components/TimelineLegend";

// jsdom ships no ResizeObserver, and the Timeline only stacks colliding seals
// once it has a measured width. This mock reports a fixed 600px track and fires
// synchronously on observe, so component tests can exercise the stacked path.
const MOCK_TRACK_WIDTH = 600;
class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    this.callback(
      [{ contentRect: { width: MOCK_TRACK_WIDTH, height: 10 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

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
  beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it("reveals a marker's revision data on hover and hides it on leave", async () => {
    const events: TimelineMarker[] = [
      {
        id: "large-4",
        kind: "large-insertion",
        index: 4,
        label: "Large insertion",
        detail: "+1,240 characters",
      },
    ];
    render(() => <Timeline currentIndex={0} max={10} events={events} onScrub={vi.fn()} />);
    const marker = screen.getByRole("button", { name: /Large insertion/ });

    expect(screen.queryByRole("tooltip")).toBeNull();

    await fireEvent.pointerEnter(marker);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(screen.getByText("+1,240 characters")).toBeTruthy();
    expect(screen.getByText("Revision 4 of 10")).toBeTruthy();

    await fireEvent.pointerLeave(marker);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stacks colliding markers into one counted seal and expands it on click", async () => {
    const onScrub = vi.fn();
    // A lone session early, then a tight burst of four marks at the tail — at the
    // mocked 600px width the burst collides into a single stacked seal.
    const events: TimelineMarker[] = [
      { id: "session-73", kind: "session", index: 73, label: "Editing session" },
      { id: "ins-145", kind: "large-insertion", index: 145, label: "Large insertion" },
      { id: "del-146", kind: "large-deletion", index: 146, label: "Large deletion" },
      { id: "ins-147", kind: "large-insertion", index: 147, label: "Large insertion" },
      { id: "session-148", kind: "session", index: 148, label: "Editing session" },
    ];
    render(() => <Timeline currentIndex={0} max={148} events={events} onScrub={onScrub} />);

    // The four-mark burst is one button; the early session stays its own seal.
    const stack = screen.getByRole("button", { name: /4 marks/ });
    expect(
      screen.getByRole("button", { name: /Editing session — Revision 73 of 148/ }),
    ).toBeTruthy();
    // Color is never the sole tell — the breakdown rides the accessible name.
    expect(stack.getAttribute("aria-label")).toContain("2 Large insertions");
    expect(stack.textContent).toBe("4");
    expect(stack.getAttribute("aria-haspopup")).toBe("dialog");

    // Hover peeks the burst's span without committing to a jump.
    await fireEvent.pointerEnter(stack);
    expect(screen.getByText("Revisions 145–148 of 148")).toBeTruthy();
    await fireEvent.pointerLeave(stack);

    // Clicking the stack expands it into a panel of per-mark jump rows rather than
    // scrubbing to a guessed frame — the reader picks the exact mark to land on.
    await fireEvent.click(stack);
    expect(onScrub).not.toHaveBeenCalled();
    expect(stack.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("dialog", { name: /4 marks/ });
    expect(panel).toBeTruthy();

    // Each member is its own jump target; choosing one scrubs to that frame.
    const jump = screen.getByRole("button", {
      name: /Jump to Large insertion — Revision 145 of 148/,
    });
    await fireEvent.click(jump);
    expect(onScrub).toHaveBeenCalledWith(145);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clusterMarkers chains colliding marks and leaves distant ones singleton", () => {
    const events: TimelineMarker[] = [
      { id: "a", kind: "session", index: 10, label: "a" },
      { id: "b", kind: "large-insertion", index: 11, label: "b" },
      { id: "c", kind: "pause", index: 80, label: "c" },
    ];
    // width 200, max 100 -> pxOf = index * 2: a=20, b=22 (gap 2 < 18 -> stack), c=160.
    const clusters = clusterMarkers(events, 100, 200);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.members.map((m) => m.id)).toEqual(["a", "b"]);
    expect(clusters[0]?.jumpIndex).toBe(10);
    expect(clusters[0]?.span).toEqual({ start: 10, end: 11 });
    expect(clusters[1]?.members.map((m) => m.id)).toEqual(["c"]);
  });

  it("clusterMarkers never stacks without a measured width", () => {
    const events: TimelineMarker[] = [
      { id: "a", kind: "session", index: 10, label: "a" },
      { id: "b", kind: "large-insertion", index: 11, label: "b" },
    ];
    expect(clusterMarkers(events, 100, 0)).toHaveLength(2);
  });

  it("clusterMarkers drops out-of-range anchors", () => {
    const events: TimelineMarker[] = [
      { id: "lo", kind: "session", index: -1, label: "lo" },
      { id: "ok", kind: "pause", index: 50, label: "ok" },
      { id: "hi", kind: "session", index: 101, label: "hi" },
    ];
    const clusters = clusterMarkers(events, 100, 200);
    expect(clusters.flatMap((c) => c.members.map((m) => m.id))).toEqual(["ok"]);
  });

  it("lists only the marker kinds present, in stable order", () => {
    const events: TimelineMarker[] = [
      { id: "pause-9", kind: "pause", index: 9, label: "Pause", detail: "12m without edits" },
      {
        id: "session-1",
        kind: "session",
        index: 1,
        label: "Editing session",
        detail: "10 inserted · 0 deleted",
      },
    ];
    render(() => <TimelineLegend events={events} />);

    // The "Marks" heading is aria-hidden, so the role query returns just the two
    // present kinds — in stable session→pause order regardless of input order.
    const items = screen.getAllByRole("listitem").map((node) => node.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("Editing session");
    expect(items[1]).toContain("Pause");
    // The absent large-edit kinds are never keyed.
    expect(screen.queryByText("Large insertion")).toBeNull();
    expect(screen.queryByText("Large deletion")).toBeNull();
  });

  it("renders nothing when there are no markers", () => {
    const { container } = render(() => <TimelineLegend events={[]} />);
    expect(container.querySelector("ul")).toBeNull();
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
