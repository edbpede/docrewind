// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Vitest (jsdom) tests for the Slides replay filmstrip. The regression these guard
// is the "blink": every replay frame hands SlideStrip a BRAND-NEW array of freshly
// projected slides, and the strip must update those thumbnails IN PLACE (`<Index>`)
// rather than tear down and rebuild every button (`<For>`). A rebuild each revision
// is what flickered the deck and destroyed the button mid-click. We assert the
// button DOM nodes survive an array-reference swap, that content still updates, and
// that selection still fires.
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import SlideStrip from "@/components/SlideStrip";
import type { RenderedShape, RenderedSlide } from "@/lib/slides-reconstruction/render";

function textShape(text: string): RenderedShape {
  return {
    kind: "text",
    left: 0.1,
    top: 0.1,
    width: 0.5,
    height: 0.2,
    text,
    role: "title",
    align: "left",
    fontFrac: 0.1,
    label: "",
  };
}

/** A fresh two-slide deck; `tag` distinguishes successive projections by content. */
function deck(tag: string): RenderedSlide[] {
  return [0, 1].map((index) => ({
    pageId: `p${index}`,
    index,
    background: "#FFFFFF",
    textColor: "#1A1A1A",
    aspectRatio: 16 / 9,
    shapes: [textShape(`slide ${index + 1} ${tag}`)],
  }));
}

describe("SlideStrip", () => {
  it("renders one tab per slide with roving tabindex on the active tab", () => {
    const { container } = render(() => (
      <SlideStrip slides={deck("a")} activeIndex={1} onSelect={() => {}} />
    ));
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.tabIndex).toBe(-1);
    expect(tabs[1]?.tabIndex).toBe(0);
  });

  it("fires onSelect with the clicked slide index", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <SlideStrip slides={deck("a")} activeIndex={0} onSelect={onSelect} />
    ));
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    fireEvent.click(tabs[1] as HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("preserves thumbnail DOM across a new-reference slides array (no blink)", () => {
    const [slides, setSlides] = createSignal<RenderedSlide[]>(deck("a"));
    const { container } = render(() => (
      <SlideStrip slides={slides()} activeIndex={0} onSelect={() => {}} />
    ));

    const before = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const firstBefore = before[0];
    const secondBefore = before[1];
    expect(container.textContent).toContain("slide 1 a");

    // A new replay frame: a fresh array of fresh slide objects (same length). With
    // `<For>` these new references would rebuild every button; `<Index>` keeps them.
    setSlides(deck("b"));

    const after = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(after.length).toBe(2);
    expect(after[0]).toBe(firstBefore); // same DOM node — not torn down
    expect(after[1]).toBe(secondBefore);
    // ...and the content still updated in place.
    expect(container.textContent).toContain("slide 1 b");
    expect(container.textContent).not.toContain("slide 1 a");
  });

  it("is hidden for a single-slide deck (a lone slide is not a tablist)", () => {
    const { container } = render(() => (
      <SlideStrip slides={[deck("a")[0] as RenderedSlide]} activeIndex={0} onSelect={() => {}} />
    ));
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
