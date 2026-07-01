// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SlideStrip — the slide navigator for a Slides replay (the Slides analogue of
// SheetTabs). A horizontally-scrollable filmstrip of live thumbnails (each a small
// `SlideCanvas` of the reconstructed slide at the CURRENT revision), so the strip
// reflects the deck AND its slide set at this moment in history. Selecting a
// thumbnail swaps the hero SlideViewport below — the textbook WAI-ARIA tabs case,
// so this carries the full tab contract: roving `tabindex` (only the active tab is
// in the page Tab order), arrow-key navigation (Left/Right/Home/End, focus follows
// selection), and an `aria-controls`/`role="tabpanel"` link to the slide panel.
//
// Content-free chrome (slide NUMBERS, never a caption); only the reconstructed
// slide render is shown. SolidJS idioms: `<For>`, never destructure props.

import type { Component } from "solid-js";
import { Index, Show } from "solid-js";
import SlideCanvas from "@/components/slides/SlideCanvas";
import { slideOf, strings } from "@/lib/core/i18n/strings";
import type { RenderedSlide } from "@/lib/core/slides/reconstruction/render";

/** DOM id of the slide `role="tabpanel"` the strip controls (set on the panel in App). */
export const SLIDE_PANEL_ID = "dr-slide-panel";

/** Stable DOM id for a thumbnail tab, so the panel can name itself via `aria-labelledby`. */
export const slideTabId = (index: number): string => `dr-slide-tab-${index}`;

export interface SlideStripProps {
  readonly slides: readonly RenderedSlide[];
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
}

const SlideStrip: Component<SlideStripProps> = (props) => {
  let stripEl!: HTMLDivElement;

  const onKeyDown = (event: KeyboardEvent): void => {
    const count = props.slides.length;
    if (count === 0) return;
    const current = props.activeIndex;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % count;
        break;
      case "ArrowLeft":
        next = (current - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    props.onSelect(next);
    const tabs = stripEl.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[next]?.focus();
  };

  return (
    <Show when={props.slides.length > 1}>
      <div
        ref={stripEl}
        role="tablist"
        aria-label={strings.slide.stripLabel}
        class="flex gap-2.5 overflow-x-auto pb-1"
        onKeyDown={onKeyDown}
      >
        {/* `<Index>`, not `<For>`: `props.slides` is a fresh array of freshly
            projected slides on every replay frame, so reference-keyed `<For>`
            would rebuild every thumbnail button each revision — the flicker, and
            the reason a click so often landed on a node that was about to be
            destroyed. `<Index>` keys by position: the buttons persist and only
            their inner canvas updates, so selection is stable and clickable while
            playback runs. */}
        <Index each={props.slides}>
          {(slide, index) => (
            <button
              type="button"
              role="tab"
              id={slideTabId(index)}
              aria-selected={index === props.activeIndex}
              aria-controls={SLIDE_PANEL_ID}
              aria-label={slideOf(index + 1, props.slides.length)}
              tabindex={index === props.activeIndex ? 0 : -1}
              class="group relative shrink-0 rounded-lg outline-none ring-1 ring-hairline transition focus-visible:ring-2 focus-visible:ring-accent"
              classList={{
                "ring-2 ring-accent": index === props.activeIndex,
                "opacity-70 hover:opacity-100": index !== props.activeIndex,
              }}
              onClick={() => props.onSelect(index)}
            >
              <div class="w-36 overflow-hidden rounded-lg bg-surface">
                <SlideCanvas slide={slide()} />
              </div>
              <span class="absolute left-1 top-1 rounded bg-ink/70 px-1.5 text-[0.6875rem] font-medium tabular-nums text-canvas">
                {index + 1}
              </span>
            </button>
          )}
        </Index>
      </div>
    </Show>
  );
};

export default SlideStrip;
