// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentViewport from "@/components/DocumentViewport";
import PlaybackControls from "@/components/PlaybackControls";
import SummaryInsights from "@/components/SummaryInsights";
import Timeline, { clusterMarkers, type TimelineMarker } from "@/components/Timeline";
import TimelineLegend from "@/components/TimelineLegend";
import type { Block } from "@/lib/reconstruction/blocks";
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

// Wrap a flat run list (single-line, as these tests hand-build) into the single
// paragraph block the viewport now consumes, assigning the global run `seq` —
// mirrors blocksAt() for newline-free runs (the structure under test here).
function blocksOf(segments: readonly Segment[]): Block[] {
  return [
    { kind: "paragraph", runs: segments.map((segment, index) => ({ ...segment, seq: index })) },
  ];
}

describe("replay UI components", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scrubs the timeline with pointer input across the padded interior", async () => {
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

    // The markers axis is inset by EDGE_INSET_PX (28px) at each end, so on this
    // 100px-wide mock the usable band is [28, 72] and a click maps through
    // (clientX − 28) / 44.
    await fireEvent.pointerDown(slider, { pointerId: 1, clientX: 64 });
    await fireEvent.pointerMove(slider, { pointerId: 1, clientX: 36 });
    await fireEvent.pointerUp(slider, { pointerId: 1, clientX: 36 });

    // (64 − 28) / 44 ≈ 0.82 → 8;  (36 − 28) / 44 ≈ 0.18 → 2.
    expect(onScrub.mock.calls.map((call) => call[0])).toEqual([8, 2]);
  });

  it("clamps pointer scrubs that land in either end safe area to the bounds", async () => {
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

    // A click inside the left margin (< 28px) clamps to index 0; one inside the
    // right margin (> 72px) clamps to max — the inset never yields fractional
    // positions beyond the boundary marks.
    await fireEvent.pointerDown(slider, { pointerId: 1, clientX: 4 });
    await fireEvent.pointerUp(slider, { pointerId: 1, clientX: 4 });
    await fireEvent.pointerDown(slider, { pointerId: 2, clientX: 97 });
    await fireEvent.pointerUp(slider, { pointerId: 2, clientX: 97 });

    expect(onScrub.mock.calls.map((call) => call[0])).toEqual([0, 10]);
  });

  it("parks the playhead in the end margin at the resting endpoints, axis in between", () => {
    const thumbLeft = (index: number, max: number): string => {
      const { container } = render(() => (
        <Timeline currentIndex={index} max={max} events={[]} onScrub={() => {}} />
      ));
      return (container.querySelector(".tl-thumb") as HTMLElement).style.left;
    };

    // Revision 0 rests in the LEFT margin (a fixed px), before the first marker —
    // NOT on the inset axis (which begins at 28px) where an early marker sits.
    expect(thumbLeft(0, 10)).toBe("9px");

    // The final state rests in the RIGHT margin, after the last marker.
    const atEnd = thumbLeft(10, 10);
    expect(atEnd).toContain("9px");
    expect(atEnd).toContain("100%");

    // Any interior revision rides the shared inset axis (a `calc`), so scrubbing
    // onto a marker lands the nib exactly on it.
    const interior = thumbLeft(5, 10);
    expect(interior).toContain("calc(28px");
    expect(interior).not.toBe("9px");
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
      <DocumentViewport blocks={blocksOf(segments)} caret={{ revision: 2, color: "#ff0000" }} />
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
      <DocumentViewport blocks={blocksOf(segments)} caret={{ revision: 5, color: "#00ff00" }} />
    ));
    expect(container.querySelector(".doc-caret")).toBeTruthy();
  });

  it("latches the caret at a mid-document insert point, not the trailing base run", () => {
    // The post-fix shape for an edit threaded INTO Revision 0 base content: the run
    // carrying the edit closes at the insertion point (toRevision=1) and the trailing
    // base content is its OWN run (from/to 0). The caret must sit after the edit run,
    // never sweep to the end of the surrounding base text — the reported nib bug.
    const segments: Segment[] = [
      {
        kind: "accepted-text",
        text: "Hello XYZ",
        fromRevision: 0,
        toRevision: 1,
        revisions: [0, 1],
      },
      { kind: "accepted-text", text: "World", fromRevision: 0, toRevision: 0, revisions: [0] },
    ];
    const { container } = render(() => (
      <DocumentViewport blocks={blocksOf(segments)} caret={{ revision: 1, color: "#00ff00" }} />
    ));
    const carets = container.querySelectorAll(".doc-caret");
    expect(carets).toHaveLength(1);
    // The caret is painted immediately after the inserting run, not the base run.
    expect(carets[0]?.previousElementSibling?.textContent).toBe("Hello XYZ");
  });

  it("paints no caret on a frame whose revision left no visible run", () => {
    const segments: Segment[] = [
      { kind: "accepted-text", text: "Hello", fromRevision: 1, toRevision: 1, revisions: [1] },
    ];
    // A pure-deletion frame: the current revision (7) has no run of its own on screen.
    const { container } = render(() => (
      <DocumentViewport blocks={blocksOf(segments)} caret={{ revision: 7, color: null }} />
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
        blocks={blocksOf(segments)}
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
    const { container } = render(() => <DocumentViewport blocks={blocksOf(segments())} />);
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
        blocks={blocksOf(segments)}
        authorKeyByRevision={new Map([[1, "ada"]])}
        highlight={null}
      />
    ));
    expect(screen.getByText("plain").getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/Contributed by/)).toBeNull();
  });
  // ── Follow-caret auto-scroll + off-screen indicator ─────────────────────────
  // A stubbed rAF runs the deferred measure synchronously; a mocked caret rect drives
  // the (pure) band decision. `window.scrollTo` is jsdom-unimplemented, so it is stubbed.
  function domRect(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 10,
      width: 10,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }
  function syncRaf(): void {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  }
  const caretSegments: Segment[] = [
    { kind: "accepted-text", text: "Hello ", fromRevision: 1, toRevision: 1, revisions: [1] },
    { kind: "accepted-text", text: "world", fromRevision: 2, toRevision: 2, revisions: [2] },
  ];

  it("auto-scrolls to keep the caret in view when follow is on and it leaves the band", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    syncRaf();
    // Caret far below the reading band (innerHeight≈768; band bottom ≈ 599) → must scroll.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(900, 920));
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
      />
    ));
    expect(scrollTo).toHaveBeenCalled();
  });

  // ── Claim: follow suppresses viewport scroll anchoring (large up/down-jump fix) ──
  // The reconstructed document re-renders every playback tick, so Chromium re-anchors
  // the viewport — a scroll the component never issued (total scrollHeight unchanged) —
  // and the onScroll guard, having already reached its follow target, misreads that
  // browser re-anchoring as a user scroll and disengages follow mid-playback. The
  // viewport defends against this by disabling scroll anchoring on the document scroller
  // while follow is engaged, and restoring the default once the user takes over.
  it("disables scroll anchoring on the viewport scroller while follow is engaged and restores it when follow turns off", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    syncRaf();
    // Caret comfortably in the band → no programmatic scroll; isolates the anchoring effect.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(100, 120));
    const [follow, setFollow] = createSignal(true);
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow={follow()}
      />
    ));
    expect(document.documentElement.style.overflowAnchor).toBe("none");
    setFollow(false);
    expect(document.documentElement.style.overflowAnchor).toBe("");
    setFollow(true);
    expect(document.documentElement.style.overflowAnchor).toBe("none");
  });

  it("shows a 'Jump to edit' pill instead of scrolling when follow is off and the caret is off-screen", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    syncRaf();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(900, 920));
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow={false}
      />
    ));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Jump to edit" })).toBeTruthy();
  });

  it("points the jump pill upward when the active edit is above the viewport", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    syncRaf();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(-50, -30));
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow={false}
      />
    ));
    const pill = screen.getByRole("button", { name: "Jump to edit" });
    expect(pill.querySelector(".rotate-180")).toBeTruthy();
  });

  it("disengages follow on a genuine user scroll gesture (wheel)", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    syncRaf();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(100, 120));
    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));
    window.dispatchEvent(new Event("wheel"));
    expect(onFollowOff).toHaveBeenCalled();
  });

  it("disengages follow on keyboard navigation keys (keydown ArrowDown)", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    syncRaf();
    // Caret in view — no programmatic scrollTo fires, so progScroll stays false.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(100, 120));
    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(onFollowOff).toHaveBeenCalled();
  });

  it("disengages follow on a non-wheel scroll event (scrollbar drag)", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    syncRaf();
    // Caret in view — recompute does not call scrollTo, so progScroll stays false.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(100, 120));
    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).toHaveBeenCalled();
  });

  it("does not disengage follow on the component's own programmatic scrollTo", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    syncRaf();
    // scrollHeight/innerHeight: realistic scrollable page so maxScroll (4232) >> target (~786).
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(5000);
    // Caret far below the band → recompute calls scrollTo → sets progScroll flag.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(900, 920));
    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));
    // Simulate the scroll events that window.scrollTo would emit during its animation.
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).not.toHaveBeenCalled();
  });

  it("re-engages follow and snaps to the caret when the jump pill is tapped", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    syncRaf();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(900, 920));
    const onFollowOn = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow={false}
        onFollowOn={onFollowOn}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Jump to edit" }));
    expect(onFollowOn).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalled();
  });

  it("PlaybackControls exposes a Follow edits toggle reflecting its state", () => {
    const onFollowChange = vi.fn();
    render(() => (
      <PlaybackControls
        playing={false}
        speed={1}
        follow
        onPlayPause={() => {}}
        onRestart={() => {}}
        onSpeed={() => {}}
        onFollowChange={onFollowChange}
      />
    ));
    const toggle = screen.getByRole("button", { name: "Follow edits" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onFollowChange).toHaveBeenCalledWith(false);
  });
  // ── Claim A: target-aware programmatic-scroll guard (easing-tail safe) ──────
  it("suppresses all easing-tail scroll events within tolerance of the auto-scroll target and disengages follow only when a user scroll moves clearly away after settling", () => {
    let capturedTarget = 0;
    const scrollTo = vi.fn((opts: ScrollToOptions) => {
      capturedTarget = opts.top ?? 0;
    });
    vi.stubGlobal("scrollTo", scrollTo);
    syncRaf();
    let mockScrollY = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => mockScrollY);
    // scrollHeight/innerHeight: realistic scrollable page so maxScroll (4232) >> target (~786),
    // making the markProgrammatic clamp a no-op and progScrollTarget equal to capturedTarget.
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(5000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(900, 920));
    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));
    // Component called scrollTo; capture the programmatic target.
    expect(scrollTo).toHaveBeenCalled();
    expect(capturedTarget).toBeGreaterThan(0);

    // Mid-animation: scrollY well below target — suppressed.
    mockScrollY = Math.floor(capturedTarget / 2);
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).not.toHaveBeenCalled();

    // Easing tail: multiple consecutive within-2px frames — ALL suppressed (the fix).
    mockScrollY = capturedTarget - 1.5;
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).not.toHaveBeenCalled();

    mockScrollY = capturedTarget - 0.4;
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).not.toHaveBeenCalled();

    mockScrollY = capturedTarget;
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).not.toHaveBeenCalled();

    // User scroll clearly away from the settled target — disengages follow exactly once.
    mockScrollY = capturedTarget - 50;
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).toHaveBeenCalledTimes(1);
  });

  // ── Fidelity: deferred-recompute ordering (async rAF, in-band caret after settle) ──
  it("faithfully reproduces production deferred-recompute ordering: progScrollReached survives a recompute that sees the caret in-band after settle, then a user scroll away disengages follow", () => {
    // Uses a manually-flushable rAF queue instead of syncRaf to exercise the true
    // production path: each onScroll call schedules a NEW recompute frame (because
    // recompute clears rafId on entry). The test mutates the caret rect between frames
    // to reflect that the programmatic scroll actually landed — making recompute return
    // decision.scroll=false so markProgrammatic is NOT called and progScrollReached
    // survives into the user-scroll disengage check.
    //
    // A hypothetical bug that does NOT update the caret rect (keeps it at 900,920)
    // would cause recompute to call markProgrammatic again, resetting progScrollReached
    // to false, and the final onFollowOff assertion would FAIL — proving that the test
    // genuinely distinguishes correct from buggy implementations.
    const rafQueue: FrameRequestCallback[] = [];
    let rafCounter = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafCounter++;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    let capturedTarget = 0;
    vi.stubGlobal(
      "scrollTo",
      vi.fn((opts: ScrollToOptions) => {
        capturedTarget = opts.top ?? 0;
      }),
    );

    let mockScrollY = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => mockScrollY);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(5000);

    // Phase 1: caret far below the band. The variable is reassigned in phase 2 so
    // the spy implementation closes over the binding, not the value.
    let mockCaretRect: DOMRect = domRect(900, 920);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => mockCaretRect,
    );

    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));

    // Frame 1: createEffect → schedule() → rAF queued. Flush it.
    // recompute: caret (900,920) is below the band → decision.scroll=true →
    //   markProgrammatic(target) → progScroll=true, progScrollReached=false.
    // After recompute: rafId=undefined (cleared at entry).
    expect(rafQueue.length).toBe(1);
    rafQueue.shift()?.(0);
    expect(capturedTarget).toBeGreaterThan(0);

    // Phase 2: programmatic scroll has landed. Reflect the settled state:
    //   • scrollY is now at the target (within PROG_SCROLL_TOLERANCE_PX=2).
    //   • The caret rect updates to in-band because the page scrolled.
    //     followScroll(300, 320, 768, capturedTarget): bandTopPx=153.6, bandBottomPx=598.88
    //     → 300 ≥ 153.6 and 320 ≤ 598.88 → { scroll: false } → markProgrammatic NOT called.
    mockScrollY = capturedTarget;
    mockCaretRect = domRect(300, 320);

    // Easing-tail scroll event at the target:
    //   onScroll → schedule() queues frame2 (rafId was undefined after frame1)
    //           → within-tolerance (|0| ≤ 2) → progScrollReached=true, suppressed.
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).not.toHaveBeenCalled();

    // Frame 2: recompute with the now-in-band caret.
    // decision.scroll=false → markProgrammatic NOT called → progScrollReached stays true.
    // (If this frame ran with the OLD rect (900,920), markProgrammatic would fire,
    // resetting progScrollReached=false, and the next assertion would fail — the test
    // then correctly identifies the bug.)
    expect(rafQueue.length).toBe(1);
    rafQueue.shift()?.(0);
    expect(onFollowOff).not.toHaveBeenCalled();

    // Phase 3: user scrolls 50px past the settled target — clearly away.
    // progScrollReached=true + |50| > PROG_SCROLL_TOLERANCE_PX → clear guard → disengage.
    mockScrollY = capturedTarget + 50;
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).toHaveBeenCalledTimes(1);
  });

  // ── Claim: clamped-maxScroll guard (progScrollTarget upper-bound fix) ─────────
  it("clamps progScrollTarget to the reachable max-scroll when the raw followScroll target exceeds the document bottom, so progScrollReached trips at the clamped landing and a user scroll away disengages", () => {
    let capturedTarget = 0;
    const scrollTo = vi.fn((opts: ScrollToOptions) => {
      capturedTarget = opts.top ?? 0;
    });
    vi.stubGlobal("scrollTo", scrollTo);
    syncRaf();
    let mockScrollY = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => mockScrollY);
    // innerHeight=300, scrollHeight=800 → maxScroll=500. followScroll target
    // with caretTop=900: max(0, 0+900-300*0.38)=786 > 500, so after the fix
    // progScrollTarget = min(786, 500) = 500.
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(300);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(900, 920));
    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));
    // The browser receives the raw (unclamped) followScroll target (~786).
    expect(scrollTo).toHaveBeenCalled();
    expect(capturedTarget).toBeGreaterThan(500);

    // Simulate the browser landing at the clamped max-scroll (500).
    // Without the fix, progScrollTarget would be ~786, so |500-786|>2 and
    // progScrollReached would never trip — suppression stays stuck for 1200ms.
    // With the fix, progScrollTarget=500, so the landing is within PROG_SCROLL_TOLERANCE_PX
    // and progScrollReached trips immediately.
    mockScrollY = 500;
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).not.toHaveBeenCalled(); // reached clamped target — suppressed

    // A subsequent user scroll clearly away (50px) now disengages exactly once.
    mockScrollY = 550;
    window.dispatchEvent(new Event("scroll"));
    expect(onFollowOff).toHaveBeenCalledTimes(1);
  });

  // ── Claim: large smooth-scroll outlives the fixed guard (inactivity-timer fix) ──
  it("does not disengage follow when a large smooth-scroll animation runs longer than the guard timeout: the inactivity timer re-arms on each programmatic frame and only releases the guard after the scroll goes quiet", () => {
    vi.useFakeTimers();
    try {
      const scrollTo = vi.fn();
      vi.stubGlobal("scrollTo", scrollTo);
      syncRaf();
      let mockScrollY = 0;
      vi.spyOn(window, "scrollY", "get").mockImplementation(() => mockScrollY);
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
      // A very tall page (≈ a long doc around revision 50): maxScroll ≫ target, so the
      // followScroll target is reachable and the markProgrammatic clamp is a no-op.
      vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(200_000);
      // Caret far below the band at render → one large programmatic smooth scroll fires.
      let mockCaretRect = domRect(900, 920);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
        () => mockCaretRect,
      );
      const onFollowOff = vi.fn();
      render(() => (
        <DocumentViewport
          blocks={blocksOf(caretSegments)}
          caret={{ revision: 2, color: "#000000" }}
          follow
          onFollowOff={onFollowOff}
        />
      ));
      expect(scrollTo).toHaveBeenCalledTimes(1);

      // The page is now gliding toward the target and the caret has entered the band, so
      // recompute returns decision.scroll=false and NEVER re-issues markProgrammatic. (This
      // mirrors a pure-deletion stretch where measureCaret returns null and likewise stops
      // re-arming the guard.) Only onScroll's own classification keeps the guard alive now.
      mockCaretRect = domRect(300, 320);
      mockScrollY = 300; // mid-animation: > PROG_SCROLL_TOLERANCE_PX from the ~608px target.

      // Chromium animates a large smooth scroll for ~1.5s — past the 1200ms guard. Emit the
      // animation's mid-flight scroll frames spread across 1600ms total. With a fixed
      // wall-clock timeout the guard expires after 1200ms and the next frame is misread as a
      // user gesture; with the inactivity timer each frame re-arms it, so it never fires.
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(400);
        window.dispatchEvent(new Event("scroll"));
      }
      expect(onFollowOff).not.toHaveBeenCalled();

      // The animation goes quiet (target reached, no more frames). After a full idle window
      // with NO programmatic activity the guard releases — proving the safety net still
      // works — so a genuine later user scroll disengages follow exactly once.
      mockScrollY = 608; // settled near the target, so the release is not a "moved away".
      vi.advanceTimersByTime(1300);
      window.dispatchEvent(new Event("scroll"));
      expect(onFollowOff).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Claim B: defaultPrevented guard on nav-key handler ────────────────────────
  it("does not disengage follow when a NAV_KEYS keydown was already handled (defaultPrevented) by a descendant element, e.g. the timeline slider", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    syncRaf();
    // Caret in view so no programmatic scrollTo fires (progScroll stays false).
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(domRect(100, 120));
    const onFollowOff = vi.fn();
    render(() => (
      <DocumentViewport
        blocks={blocksOf(caretSegments)}
        caret={{ revision: 2, color: "#000000" }}
        follow
        onFollowOff={onFollowOff}
      />
    ));

    // A child element (e.g. the timeline slider) calls preventDefault on Arrow before
    // it bubbles to the window keydown handler.
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.addEventListener("keydown", (e) => e.preventDefault());
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    document.body.removeChild(el);
    expect(onFollowOff).not.toHaveBeenCalled();

    // PageDown is NOT handled by the timeline slider (no preventDefault), so it still
    // disengages document follow.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", cancelable: true }));
    expect(onFollowOff).toHaveBeenCalledTimes(1);
  });
});
