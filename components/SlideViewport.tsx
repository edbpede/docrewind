// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SlideViewport — the hero surface of a Slides replay: the current slide, framed
// like a physical slide (a soft ring + shadow on the page canvas), at the deck's
// true aspect ratio. A calm, non-blocking fidelity-notice line (§9) appears above
// the slide when the model degraded any op — never a scary banner, never blocking
// the replay (PRODUCT.md Principle 6).
//
// The heavy lifting is the pure `renderSlide` projection + `SlideCanvas`; this is a
// thin frame + notice around it. System fonts + DESIGN tokens only. SolidJS idioms:
// `<Show>`, never destructure props.

import type { Component } from "solid-js";
import { Show } from "solid-js";
import SlideCanvas from "@/components/SlideCanvas";
import { strings } from "@/lib/i18n/strings";
import type { RenderedSlide } from "@/lib/slides-reconstruction/render";

export interface SlideViewportProps {
  readonly slide: RenderedSlide;
  /** Render the §9 fidelity notice when the model carries any notice. */
  readonly showFidelityNotice: boolean;
}

const SlideViewport: Component<SlideViewportProps> = (props) => (
  <div class="flex flex-col gap-2">
    <Show when={props.showFidelityNotice}>
      <output class="note-base note-warning text-[0.8125rem]">
        {strings.slide.fidelityNotice}
      </output>
    </Show>
    {/* The framed slide. The surrounding replay panel carries the tabpanel role +
        label, so this decorative frame stays unlabelled (a role-less aria-label is
        invalid, and would double-announce). */}
    <div class="mx-auto w-full max-w-3xl overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-hairline">
      <SlideCanvas slide={props.slide} />
    </div>
  </div>
);

export default SlideViewport;
