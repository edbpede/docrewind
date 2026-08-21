<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // ShapeView — one shape of a reconstructed slide, painted at its
  // transform-derived fractional box. Split out of `SlideCanvas.svelte` because
  // Svelte is one component per file; it was a module-local `ShapeView` component
  // in the Solid original and is not used anywhere else.
  //
  // Scale-independence lives here too: the box is `%` of the enclosing canvas
  // (which is a CSS container) and font sizes are `cqh`, so the same markup is
  // crisp in the hero viewport and in a tiny navigator thumbnail. Media becomes a
  // labeled placeholder — never image bytes, never a network fetch (local-first; §4).

  /** Format a fraction as a percent string. Boxes may legitimately exceed [0,1]
   *  (a shape placed partly off-slide); the canvas `overflow-hidden` does the clipping. */
  function pct(fraction: number): string {
    return `${(fraction * 100).toFixed(3)}%`;
  }
</script>

<script lang="ts">
  import { strings } from "@/lib/core/i18n/strings";
  import type { RenderedShape } from "@/lib/core/slides/reconstruction/render";

  interface ShapeViewProps {
    readonly shape: RenderedShape;
  }

  const { shape }: ShapeViewProps = $props();

  // Title text is bottom-anchored in its (tall) placeholder box, matching how
  // Google seats a title low in its frame; body text hangs from the top.
  const alignItems = $derived(shape.role === "title" ? "flex-end" : "flex-start");
  const justifyContent = $derived(
    shape.align === "center" ? "center" : shape.align === "right" ? "flex-end" : "flex-start",
  );
</script>

<div
  class="absolute flex overflow-hidden"
  style:left={pct(shape.left)}
  style:top={pct(shape.top)}
  style:width={pct(shape.width)}
  style:height={pct(shape.height)}
  style:align-items={alignItems}
  style:justify-content={justifyContent}
>
  {#if shape.kind === "text"}
    <p
      class="m-0 w-full whitespace-pre-wrap break-words leading-[1.18]"
      style:font-size="{(shape.fontFrac * 100).toFixed(2)}cqh"
      style:text-align={shape.align}
      style:font-weight={shape.role === "title" ? 600 : 400}
    >{shape.text}</p>
  {:else}
    <div
      class="flex h-full w-full items-center justify-center rounded-[0.4cqh] border border-dashed border-current/35 bg-current/[0.04]"
    >
      <span
        class="rounded bg-current/10 px-[1cqh] py-[0.4cqh] font-medium uppercase tracking-wide"
        style:font-size="3.4cqh"
      >
        {strings.slide.mediaPlaceholder}
      </span>
    </div>
  {/if}
</div>
