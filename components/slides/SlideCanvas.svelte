<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // SlideCanvas — paints ONE reconstructed slide (a pure `RenderedSlide` from
  // `lib/core/slides/reconstruction/render.ts`) as an absolutely-positioned shape canvas. The
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
  // System fonts + DESIGN tokens only. Svelte idioms: `{#each}`/`{#if}` with runes.
  // The per-shape markup lives in the sibling `ShapeView.svelte` (one component per
  // file), which was a module-local component in the Solid original.

  import ShapeView from "@/components/slides/ShapeView.svelte";
  import type { RenderedSlide } from "@/lib/core/slides/reconstruction/render";

  interface SlideCanvasProps {
    readonly slide: RenderedSlide;
  }

  const { slide }: SlideCanvasProps = $props();
</script>

<div
  class="relative overflow-hidden"
  style:container-type="size"
  style:aspect-ratio="{slide.aspectRatio}"
  style:background-color={slide.background}
  style:color={slide.textColor}
>
  <!-- A KEYLESS `{#each}` (the exact equivalent of Solid's `<Index>`), never a
       keyed one: the reconstructed shapes are a BRAND-NEW array on every replay
       frame (a fresh `renderSlide` projection), so keying by the shape reference
       or by any per-frame id would tear down and rebuild every shape node each
       revision — the visible flicker. A keyless `{#each}` matches by POSITION and
       updates each shape's box/text in place, so the canvas morphs smoothly
       instead of blinking. Shapes are positionally stable (creation order); a
       mid-deck edit updates shifted rows in place and trims one from the tail.
       DO NOT ADD A KEY HERE. -->
  {#each slide.shapes as shape}
    <ShapeView {shape} />
  {/each}
</div>
