<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // YAxis — the axis label column to the LEFT of a chart. Each label is positioned
  // by percent of the chart height so it lines up exactly with its in-SVG
  // gridline; the fixed column width keeps both charts' plot areas aligned.
  //
  // Split out of `DocumentSummary.svelte` (one component per file). `Y_AXIS_W` is
  // exported because the X-axis row under each chart has to indent by exactly this
  // gutter for its day/time labels to stay under the plot.

  // Width of the Y-axis label gutter to the LEFT of each plot. Fixed (not a viewBox
  // fraction) so it stays legible at any container width and so both charts' plot
  // areas line up; sized to fit the longest label ("Start of doc"/"End of doc").
  export const Y_AXIS_W = "4.75rem";

  export interface YTick {
    /** Vertical offset as a percent of the chart height (matches the SVG y mapping,
     *  so the gutter label lines up exactly with its in-SVG gridline). */
    readonly pct: number;
    /** The precomputed axis label (a char-count scale value, or a position percent). */
    readonly label: string;
  }
</script>

<script lang="ts">
  export interface YAxisProps {
    readonly ticks: readonly YTick[];
  }

  let { ticks }: YAxisProps = $props();
</script>

<div class="relative shrink-0" style:width={Y_AXIS_W}>
  <!-- Keyed by INDEX, deliberately: a `YTick` carries only a `pct` and a `label`,
       neither unique (two rounded char-count labels can repeat, and the position
       axis's ends are plain-language captions). Svelte throws `each_key_duplicate`
       on a duplicate key where Solid's `<For>` tolerated one. The array is rebuilt
       wholesale and never reorders in place, so the index is a correct key. -->
  {#each ticks as tick, i (i)}
    <span
      data-yaxis-tick
      class="dr-sum-axis"
      style:top={`${Math.min(100, Math.max(0, tick.pct))}%`}
      style:right="0.5rem"
      style:transform="translateY(-50%)"
      style:font-variant-numeric="tabular-nums"
    >
      {tick.label}
    </span>
  {/each}
</div>
