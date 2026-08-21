<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // GridViewport — renders one reconstructed SheetGrid as an accessible, bounded
  // table (plan P3 / §7). A spreadsheet can be 10k+ rows, so the ROW axis is
  // VIRTUALIZED: only the visible row window (+ overscan) is in the DOM, with
  // top/bottom spacer rows preserving the scrollbar geometry and a sticky
  // `<thead>` + sticky row-number column — a large grid stays responsive (R7). The
  // column axis is capped (most sheets are narrow; a runaway col count never
  // explodes the DOM). Cell values/formulas go through the pure `render.ts`
  // (formulas as text, numbers via the supported number-format patterns); numeric
  // cells use mono/tabular figures.
  //
  // A calm, non-blocking fidelity-notice line (§9) appears above the grid when the
  // model degraded any op — never a scary banner, never blocking the replay.
  //
  // Semantic `<table>` markup (accessible by construction). System fonts + DESIGN
  // tokens only — no web font. Svelte idioms: `{#each}`/`{#if}` with runes.

  const ROW_H = 28;
  const COL_W = 112;
  const ROW_HDR_W = 56;
  const HEADER_H = 28;
  const OVERSCAN = 6;
  const VIEWPORT_H = 460;
  const DEFAULT_VISIBLE_ROWS = 40;
  const MIN_ROWS = 24;
  const MIN_COLS = 12;
  const MAX_ROWS = 50_000;
  // Column render cap: most sheets are narrow; a runaway col count never explodes
  // the DOM (the row axis carries the heavy virtualization).
  const MAX_COLS = 64;

  const GRIDLINE = "1px solid var(--dr-hairline)";
</script>

<script lang="ts">
  import { strings } from "@/lib/core/i18n/strings";
  import type { SheetGrid } from "@/lib/core/sheets/reconstruction/model";
  import {
    columnLabel,
    placeholderAt,
    renderCellAt,
    rowSegments,
  } from "@/lib/core/sheets/reconstruction/render";

  interface GridViewportProps {
    readonly sheet: SheetGrid;
    /** Render the §9 fidelity notice when the model carries any notice. */
    readonly showFidelityNotice: boolean;
  }

  const { sheet, showFidelityNotice }: GridViewportProps = $props();

  let scrollTop = $state(0);
  let viewportH = $state(VIEWPORT_H);

  const totalRows = $derived(Math.min(MAX_ROWS, Math.max(MIN_ROWS, sheet.rowCount)));
  const totalCols = $derived(Math.min(MAX_COLS, Math.max(MIN_COLS, sheet.colCount)));

  const cols = $derived(Array.from({ length: totalCols }, (_v, i) => i));

  const rowWindow = $derived.by(() => {
    const visible = Math.max(DEFAULT_VISIBLE_ROWS, Math.ceil(viewportH / ROW_H));
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(totalRows, start + visible + OVERSCAN * 2);
    return { start, end };
  });
  const rows = $derived.by(() => {
    const { start, end } = rowWindow;
    return Array.from({ length: Math.max(0, end - start) }, (_v, i) => start + i);
  });

  const onScroll = (event: Event): void => {
    const el = event.currentTarget as HTMLElement;
    scrollTop = el.scrollTop;
    if (el.clientHeight > 0) viewportH = el.clientHeight;
  };
</script>

<div class="flex flex-col gap-2">
  {#if showFidelityNotice}
    <output class="note-base note-warning text-[0.8125rem]">
      {strings.sheet.fidelityNotice}
    </output>
  {/if}
  <div
    class="overflow-auto rounded-xl bg-surface ring-1 ring-hairline"
    style:height="{VIEWPORT_H}px"
    onscroll={onScroll}
  >
    <table
      aria-label={strings.sheet.gridLabel}
      style:border-collapse="separate"
      style:border-spacing="0"
      style:table-layout="fixed"
      style:width="{ROW_HDR_W + totalCols * COL_W}px"
    >
      <thead>
        <tr>
          <th
            class="bg-sunken"
            style:position="sticky"
            style:top="0"
            style:left="0"
            style:z-index="3"
            style:width="{ROW_HDR_W}px"
            style:height="{HEADER_H}px"
            style:border-right={GRIDLINE}
            style:border-bottom={GRIDLINE}
          ></th>
          {#each cols as c}
            <th
              scope="col"
              class="bg-sunken text-xs font-medium text-ink-muted"
              style:position="sticky"
              style:top="0"
              style:z-index="2"
              style:width="{COL_W}px"
              style:height="{HEADER_H}px"
              style:border-right={GRIDLINE}
              style:border-bottom={GRIDLINE}
            >
              {columnLabel(c)}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        <tr style:height="{rowWindow.start * ROW_H}px">
          <td colspan={totalCols + 1}></td>
        </tr>
        {#each rows as r}
          <tr style:height="{ROW_H}px">
            <th
              scope="row"
              class="bg-sunken text-xs tabular-nums text-ink-muted"
              style:position="sticky"
              style:left="0"
              style:z-index="1"
              style:width="{ROW_HDR_W}px"
              style:border-right={GRIDLINE}
              style:border-bottom={GRIDLINE}
            >
              {r + 1}
            </th>
            {#each rowSegments(sheet, r, totalCols) as seg}
              <!-- A cross-row covered cell renders blank (load-bearing §0):
                   the merge set is the SOLE authority that blanks an absorbed
                   cell, so a value typed before the merge must not leak.
                   (Solid returned early from the `<For>` callback here; Svelte's
                   `{@const}` only takes expressions, so the same two shapes are
                   the two branches of an `{#if}`.) -->
              {#if "covered" in seg}
                <td
                  aria-hidden="true"
                  style:width="{COL_W}px"
                  style:max-width="{COL_W}px"
                  style:border-right={GRIDLINE}
                  style:border-bottom={GRIDLINE}
                ></td>
              {:else}
                {@const cell = renderCellAt(sheet, r, seg.col)}
                {@const placeholder = placeholderAt(sheet, r, seg.col)}
                {@const spanW = seg.colSpan * COL_W}
                <td
                  colspan={seg.colSpan}
                  class={[
                    "overflow-hidden text-ellipsis whitespace-nowrap px-1.5 text-[0.8125rem] text-ink",
                    {
                      "font-bold": cell?.bold === true,
                      italic: cell?.italic === true,
                      "font-mono tabular-nums text-right": cell?.numeric === true,
                      "text-ink-secondary": cell?.formula === true,
                    },
                  ]}
                  title={cell?.formula === true ? strings.sheet.formulaLabel : undefined}
                  style:width="{spanW}px"
                  style:max-width="{spanW}px"
                  style:border-right={GRIDLINE}
                  style:border-bottom={GRIDLINE}
                >
                  {#if placeholder}
                    <span
                      class="inline-flex items-center rounded bg-sunken px-1 text-[0.6875rem] font-medium text-ink-muted ring-1 ring-hairline"
                      >{placeholder.kind === "chart"
                        ? strings.sheet.chartPlaceholder
                        : strings.sheet.imagePlaceholder}</span
                    >
                  {:else}
                    {cell?.text ?? ""}
                  {/if}
                </td>
              {/if}
            {/each}
          </tr>
        {/each}
        <tr style:height="{Math.max(0, totalRows - rowWindow.end) * ROW_H}px">
          <td colspan={totalCols + 1}></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
