<script module lang="ts">
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
  // slide render is shown. Svelte idioms: `{#each}` with runes.

  import { SLIDE_PANEL_ID, slideTabId } from "./slide-strip";

  export { SLIDE_PANEL_ID, slideTabId };
</script>

<script lang="ts">
  import { tick } from "svelte";
  import SlideCanvas from "@/components/slides/SlideCanvas.svelte";
  import { slideOf, strings } from "@/lib/core/i18n/strings";
  import type { RenderedSlide } from "@/lib/core/slides/reconstruction/render";

  interface SlideStripProps {
    readonly slides: readonly RenderedSlide[];
    readonly activeIndex: number;
    readonly onSelect: (index: number) => void;
  }

  const { slides, activeIndex, onSelect }: SlideStripProps = $props();

  let stripEl: HTMLDivElement | undefined = $state();

  const onKeyDown = async (event: KeyboardEvent): Promise<void> => {
    const count = slides.length;
    if (count === 0) return;
    const current = activeIndex;
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
    onSelect(next);
    // Solid applied the selection synchronously; Svelte batches, so the new
    // roving `tabindex` is only on the DOM after a tick — focus after it.
    await tick();
    const tabs = stripEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };
</script>

{#if slides.length > 1}
  <!-- The WAI-ARIA tabs pattern puts the roving `tabindex` on the TABS, never on
       the tablist container itself; adding one here would insert a second tab stop
       and break the contract the tests assert. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    bind:this={stripEl}
    role="tablist"
    aria-label={strings.slide.stripLabel}
    class="flex gap-2.5 overflow-x-auto pb-1"
    onkeydown={onKeyDown}
  >
    <!-- A KEYLESS `{#each}` (the exact equivalent of Solid's `<Index>`), never a
         keyed one: `slides` is a fresh array of freshly projected slides on every
         replay frame, so keying by the slide reference or by any per-frame id
         would rebuild every thumbnail button each revision — the flicker, and the
         reason a click so often landed on a node that was about to be destroyed.
         A keyless `{#each}` matches by POSITION: the buttons persist and only
         their inner canvas updates, so selection is stable and clickable while
         playback runs. `slides.components.test.ts` asserts the button DOM nodes
         survive an array-reference swap. DO NOT ADD A KEY HERE. -->
    {#each slides as slide, index}
      <button
        type="button"
        role="tab"
        id={slideTabId(index)}
        aria-selected={index === activeIndex}
        aria-controls={SLIDE_PANEL_ID}
        aria-label={slideOf(index + 1, slides.length)}
        tabindex={index === activeIndex ? 0 : -1}
        class={[
          "group relative shrink-0 rounded-lg outline-none ring-1 ring-hairline transition focus-visible:ring-2 focus-visible:ring-accent",
          {
            "ring-2 ring-accent": index === activeIndex,
            "opacity-70 hover:opacity-100": index !== activeIndex,
          },
        ]}
        onclick={() => onSelect(index)}
      >
        <div class="w-36 overflow-hidden rounded-lg bg-surface">
          <SlideCanvas {slide} />
        </div>
        <span
          class="absolute left-1 top-1 rounded bg-ink/70 px-1.5 text-[0.6875rem] font-medium tabular-nums text-canvas"
        >
          {index + 1}
        </span>
      </button>
    {/each}
  </div>
{/if}
