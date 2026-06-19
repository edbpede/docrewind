// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentViewport from "@/components/DocumentViewport";
import SummaryInsights from "@/components/SummaryInsights";
import Timeline, { clusterMarkers, type TimelineMarker } from "@/components/Timeline";
import TimelineLegend from "@/components/TimelineLegend";
import type { Segment } from "@/lib/reconstruction/render";

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

  it("renders the colophon record and attribution caveat", () => {
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

    // The colophon weaves the figures into one neutral sentence (no KPI tiles); the
    // duration rides inside the prose and zero-valued marginalia (large edits, pauses)
    // are omitted rather than tiled as "0".
    expect(screen.getByText("Reconstructed from 2 revisions, written over 1m.")).toBeTruthy();
    expect(screen.getByText("Contributors")).toBeTruthy();
    // Unresolved authors degrade to opaque labels, never the raw token.
    expect(screen.getByText("Author 1")).toBeTruthy();
    expect(screen.getByText("Attribution may be incomplete.")).toBeTruthy();
  });

  it("collapses one author across many sessions into a single chip", () => {
    // Regression for the transposed-tuple bug: a single author token repeated
    // across revisions must yield exactly one author chip, never one per row.
    render(() => (
      <SummaryInsights
        revisions={[
          revision(1, 1_000, asUserId("author-1")),
          revision(2, 61_000, asUserId("author-1")),
          revision(3, 200_000, asUserId("author-1")),
        ]}
        timeline={[]}
      />
    ));
    const chips = screen.getAllByRole("listitem");
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("Author 1");
  });

  it("renders a resolved real name when realIdentities is on", () => {
    render(() => (
      <SummaryInsights
        revisions={[revision(1, 1_000, asUserId("07280646734247216338"))]}
        timeline={[]}
        realIdentities={true}
        identities={{
          "07280646734247216338": {
            userId: "07280646734247216338",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
        }}
      />
    ));
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    // The raw opaque token must NOT leak when a name resolved.
    expect(screen.queryByText("07280646734247216338")).toBeNull();
  });

  it("falls back to an opaque Author label (never the raw token) when unresolved", () => {
    render(() => (
      <SummaryInsights
        revisions={[revision(1, 1_000, asUserId("unmapped-token"))]}
        timeline={[]}
        realIdentities={true}
        identities={{}}
      />
    ));
    expect(screen.getByText("Author 1")).toBeTruthy();
    // The raw Gaia token must never leak into the UI, even on a resolution miss.
    expect(screen.queryByText("unmapped-token")).toBeNull();
  });

  it("keeps authors opaque by default even when identities are present", () => {
    render(() => (
      <SummaryInsights
        revisions={[revision(1, 1_000, asUserId("07280646734247216338"))]}
        timeline={[]}
        identities={{
          "07280646734247216338": {
            userId: "07280646734247216338",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
        }}
      />
    ));
    expect(screen.getByText("Author 1")).toBeTruthy();
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
  });

  it("shows the email row in the detail card only when an address is known", () => {
    render(() => (
      <SummaryInsights
        revisions={[revision(1, 1_000, asUserId("07280646734247216338"))]}
        timeline={[]}
        realIdentities={true}
        identities={{
          "07280646734247216338": {
            userId: "07280646734247216338",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
        }}
      />
    ));
    // The card is revealed by pinning the chip (click); the known email then shows.
    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }));
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });

  it("omits the email row entirely for an author with no known address", () => {
    // Collaborators carry name + colour but no email (the wire format has none), so
    // the row is dropped rather than rendered with a "Not available" placeholder.
    render(() => (
      <SummaryInsights
        revisions={[revision(1, 1_000, asUserId("03089517982426497767"))]}
        timeline={[]}
        realIdentities={true}
        identities={{
          "03089517982426497767": {
            userId: "03089517982426497767",
            name: "RB Boot",
            email: null,
            color: "#673AB7",
          },
        }}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: /RB Boot/ }));
    // The card opened (the revision-count row is present)...
    expect(screen.getByText("Revisions")).toBeTruthy();
    // ...but with no address, neither the Email label nor any placeholder is rendered.
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.queryByText("Not available")).toBeNull();
  });

  it("publishes the foregrounded author key on hover and clears it on leave", () => {
    const onActiveAuthorChange = vi.fn();
    render(() => (
      <SummaryInsights
        revisions={[revision(1, 1_000, asUserId("author-x"))]}
        timeline={[]}
        onActiveAuthorChange={onActiveAuthorChange}
      />
    ));
    // The effect publishes the initial (empty) focus once on mount.
    expect(onActiveAuthorChange).toHaveBeenCalledWith(null);

    const chip = screen.getAllByRole("listitem")[0];
    if (chip === undefined) throw new Error("expected an author chip");
    fireEvent.pointerEnter(chip);
    expect(onActiveAuthorChange).toHaveBeenLastCalledWith("author-x");

    fireEvent.pointerLeave(chip);
    expect(onActiveAuthorChange).toHaveBeenLastCalledWith(null);
  });

  it("paints a colour-coded writing caret after the current revision's run", () => {
    const segments: Segment[] = [
      { kind: "accepted-text", text: "Hello ", fromRevision: 1, toRevision: 1, revisions: [1] },
      { kind: "accepted-text", text: "world", fromRevision: 2, toRevision: 2, revisions: [2] },
    ];
    const { container } = render(() => (
      <DocumentViewport segments={segments} caret={{ revision: 2, color: "#ff0000" }} />
    ));
    const caret = container.querySelector<HTMLElement>(".doc-caret");
    expect(caret).toBeTruthy();
    // The caret is tinted to the author's hue and hidden from assistive tech.
    expect(caret?.style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(caret?.getAttribute("aria-hidden")).toBe("true");
  });

  it("paints the caret on a run the current revision EXTENDED (sequential typing)", () => {
    // Revision 5 appended onto a run opened by revision 1 — the coalesced run keeps
    // fromRevision=1 but toRevision=5, so the caret must still follow the active frame.
    const segments: Segment[] = [
      { kind: "accepted-text", text: "Hello", fromRevision: 1, toRevision: 5, revisions: [1, 5] },
    ];
    const { container } = render(() => (
      <DocumentViewport segments={segments} caret={{ revision: 5, color: "#00ff00" }} />
    ));
    expect(container.querySelector(".doc-caret")).toBeTruthy();
  });

  it("paints no caret on a frame whose revision left no visible run", () => {
    const segments: Segment[] = [
      { kind: "accepted-text", text: "Hello", fromRevision: 1, toRevision: 1, revisions: [1] },
    ];
    // A pure-deletion frame: the current revision (7) has no run of its own on screen.
    const { container } = render(() => (
      <DocumentViewport segments={segments} caret={{ revision: 7, color: null }} />
    ));
    expect(container.querySelector(".doc-caret")).toBeNull();
  });

  it("highlights only the foregrounded author's runs and links them for a11y", () => {
    const segments: Segment[] = [
      { kind: "accepted-text", text: "by Ada", fromRevision: 1, toRevision: 1, revisions: [1] },
      { kind: "accepted-text", text: "by Boot", fromRevision: 2, toRevision: 2, revisions: [2] },
    ];
    const authorKeyByRevision = new Map<number, string>([
      [1, "ada"],
      [2, "boot"],
    ]);
    render(() => (
      <DocumentViewport
        segments={segments}
        authorKeyByRevision={authorKeyByRevision}
        highlight={{ key: "ada", color: "#673AB7", label: "Author 1" }}
      />
    ));
    const ada = screen.getByText("by Ada");
    const boot = screen.getByText("by Boot");
    // Ada's run is highlighted (linked to the off-screen attribution) and tinted...
    expect(ada.getAttribute("aria-describedby")).toBe("dr-doc-attr-desc");
    expect(ada.style.boxShadow).not.toBe("");
    // ...while Boot's run is untouched.
    expect(boot.getAttribute("aria-describedby")).toBeNull();
    expect(boot.style.boxShadow).toBe("");
    // The screen-reader-only description names the contributor (content-free).
    expect(screen.getByText("Contributed by Author 1")).toBeTruthy();
  });

  it("reuses run DOM nodes across a segments update so hover tooltips don't flicker", () => {
    // Regression: playback rebuilds `segments` into a FRESH array of FRESH objects
    // every tick. `<For>` (reference-keyed) found zero identity overlap and tore down
    // every span each tick, dropping `:hover` on the affordance run under the cursor
    // and re-running its `::after` fade from 0 — the reported tooltip flicker. `<Index>`
    // is position-keyed, so the node at each row persists and only its content updates.
    // We assert the exact contract: the suggest run's DOM node survives the update.
    const [segments, setSegments] = createSignal<Segment[]>([
      { kind: "accepted-text", text: "Hello ", fromRevision: 1, toRevision: 1, revisions: [1] },
      {
        kind: "suggested-insert",
        text: "wor",
        fromRevision: 2,
        toRevision: 2,
        revisions: [2],
      },
    ]);
    const { container } = render(() => <DocumentViewport segments={segments()} />);
    const before = container.querySelector(".doc-suggest");
    expect(before).toBeTruthy();
    expect(before?.getAttribute("data-doc-tip")).toBeTruthy();

    // A subsequent playback tick: a brand-new array of brand-new objects, with the
    // suggest run's tail grown by a char (the typical "still being typed" case).
    setSegments([
      { kind: "accepted-text", text: "Hello ", fromRevision: 1, toRevision: 1, revisions: [1] },
      {
        kind: "suggested-insert",
        text: "world",
        fromRevision: 2,
        toRevision: 2,
        revisions: [2],
      },
    ]);
    const after = container.querySelector(".doc-suggest");
    // SAME node instance (never recreated), so a live :hover and its tooltip persist...
    expect(after).toBe(before);
    // ...the tooltip label is unchanged, and the grown text is updated in place.
    expect(after?.getAttribute("data-doc-tip")).toBe(before?.getAttribute("data-doc-tip"));
    expect(after?.textContent).toContain("world");
  });

  it("renders no highlight or description when no author is foregrounded", () => {
    const segments: Segment[] = [
      { kind: "accepted-text", text: "plain", fromRevision: 1, toRevision: 1, revisions: [1] },
    ];
    render(() => (
      <DocumentViewport
        segments={segments}
        authorKeyByRevision={new Map([[1, "ada"]])}
        highlight={null}
      />
    ));
    expect(screen.getByText("plain").getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/Contributed by/)).toBeNull();
  });
});
