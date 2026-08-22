<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // DayAxis — the shared axis label row beneath a chart, aligned to its gridlines.
  // Labels are precomputed per tick (a calendar day, or a clock time for
  // short-span docs) by `DocumentSummary`, so this component is pure layout.
  //
  // Split out of `DocumentSummary.svelte` (one component per file). The `DayTick`
  // shape and the label-anchoring helper live here rather than in the parent
  // because they describe THIS axis's contract — the parent imports them back for
  // the hover tooltip, which anchors itself with exactly the same rule so a
  // tooltip at the chart edge clips no differently than an axis label there.

  export interface DayTick {
    readonly t: number;
    /** Left offset as a percent of the container width (matches the SVG x mapping). */
    readonly pct: number;
    /** The precomputed axis label (a day or, for short spans, a clock time). */
    readonly label: string;
  }

  /** Horizontal label anchoring so edge labels never clip the chart frame. */
  export function labelTransform(pct: number): string {
    if (pct <= 6) return "translateX(0)";
    if (pct >= 94) return "translateX(-100%)";
    return "translateX(-50%)";
  }
</script>

<script lang="ts">
  export interface DayAxisProps {
    readonly ticks: readonly DayTick[];
  }

  let { ticks }: DayAxisProps = $props();
</script>

<div class="relative" style:height="1.25rem" style:margin-top="0.25rem" style:overflow="hidden">
  <!-- Keyed by INDEX, deliberately: `spaceTicks()` in the parent can emit two ticks
       with an equal `pct`, and a rounded hour/day label repeats across days, so no
       field here is unique. Svelte throws `each_key_duplicate` on a duplicate key
       where Solid's `<For>` silently tolerated one. The array is rebuilt wholesale
       whenever the summary changes and never reorders in place, so the index is a
       correct key. DO NOT key this by `tick.t`, `tick.pct` or `tick.label`. -->
  {#each ticks as tick, i (i)}
    <span
      data-axis-tick
      class="text-ink-muted"
      style:position="absolute"
      style:left={`${Math.min(100, Math.max(0, tick.pct))}%`}
      style:transform={labelTransform(tick.pct)}
      style:white-space="nowrap"
      style:font-size="0.6875rem"
    >
      {tick.label}
    </span>
  {/each}
</div>
