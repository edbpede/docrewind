// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SlideCanvas — paints ONE reconstructed slide (a pure `RenderedSlide` from
// `slides-reconstruction/render.ts`) as an absolutely-positioned shape canvas. The
// "structural layout + parity" compromise (the Slides analogue of GridViewport):
// each shape sits at its transform-derived fractional box on a correctly-shaped
// canvas, text is drawn at role-based sizes, and media becomes a labeled
// placeholder — never image bytes, never a network fetch (local-first; §4).
//
// Scale-independence: the canvas is a CSS container (`container-type: size`), so
// box positions are `%` of the canvas and font sizes are `cqh` (a fraction of the
// canvas height). The SAME component therefore renders both the hero viewport and
// the tiny navigator thumbnails, staying crisp at any size. Content-free chrome;
// only the reconstructed slide text (metadata the user is replaying) is shown.
//
// System fonts + DESIGN tokens only. SolidJS idioms: `<For>`/`<Show>`, never
// destructure props.

import type { Component } from "solid-js";
import { Index, Show } from "solid-js";
import { strings } from "@/lib/i18n/strings";
import type { RenderedShape, RenderedSlide } from "@/lib/slides-reconstruction/render";

export interface SlideCanvasProps {
  readonly slide: RenderedSlide;
}

/** Format a fraction as a percent string. Boxes may legitimately exceed [0,1]
 *  (a shape placed partly off-slide); the canvas `overflow-hidden` does the clipping. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`;
}

const ShapeView: Component<{ shape: RenderedShape }> = (props) => (
  <div
    class="absolute flex overflow-hidden"
    style={{
      left: pct(props.shape.left),
      top: pct(props.shape.top),
      width: pct(props.shape.width),
      height: pct(props.shape.height),
      // Title text is bottom-anchored in its (tall) placeholder box, matching how
      // Google seats a title low in its frame; body text hangs from the top.
      "align-items": props.shape.role === "title" ? "flex-end" : "flex-start",
      "justify-content":
        props.shape.align === "center"
          ? "center"
          : props.shape.align === "right"
            ? "flex-end"
            : "flex-start",
    }}
  >
    <Show
      when={props.shape.kind === "text"}
      fallback={
        <div class="flex h-full w-full items-center justify-center rounded-[0.4cqh] border border-dashed border-current/35 bg-current/[0.04]">
          <span
            class="rounded bg-current/10 px-[1cqh] py-[0.4cqh] font-medium uppercase tracking-wide"
            style={{ "font-size": "3.4cqh" }}
          >
            {strings.slide.mediaPlaceholder}
          </span>
        </div>
      }
    >
      <p
        class="m-0 w-full whitespace-pre-wrap break-words leading-[1.18]"
        style={{
          "font-size": `${(props.shape.fontFrac * 100).toFixed(2)}cqh`,
          "text-align": props.shape.align,
          "font-weight": props.shape.role === "title" ? 600 : 400,
        }}
      >
        {props.shape.text}
      </p>
    </Show>
  </div>
);

const SlideCanvas: Component<SlideCanvasProps> = (props) => (
  <div
    class="relative overflow-hidden"
    style={{
      "container-type": "size",
      "aspect-ratio": `${props.slide.aspectRatio}`,
      "background-color": props.slide.background,
      color: props.slide.textColor,
    }}
  >
    {/* `<Index>`, not `<For>`: the reconstructed shapes are a BRAND-NEW array on
        every replay frame (a fresh `renderSlide` projection), so reference-keyed
        `<For>` would tear down and rebuild every shape node each revision — the
        visible flicker. `<Index>` keys by position and updates each shape's
        reactive box/text in place, so the canvas morphs smoothly instead of
        blinking. Shapes are positionally stable (creation order); a mid-deck edit
        updates shifted rows in place and trims one from the tail. */}
    <Index each={props.slide.shapes}>{(shape) => <ShapeView shape={shape()} />}</Index>
  </div>
);

export default SlideCanvas;
