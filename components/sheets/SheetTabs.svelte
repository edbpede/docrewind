<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // SheetTabs — the multi-sheet tab switcher for a Sheets replay (plan P3). A
  // DESIGN segmented/pill control (reusing the `seg` register) over the grid
  // model's `order: Gid[]`, so tabs reflect the sheet set AND its order at the
  // current revision (add/rename/delete are replayed into the model). A spreadsheet
  // always has at least one sheet, so the tablist shows one tab even when unnamed.
  // Content-free: shows sheet NAMES (metadata), never cell data.
  //
  // Unlike the other `seg` consumers (theme/diagnostics/speed), which are pure
  // preference TOGGLES, selecting a tab here swaps the content panel below
  // (`GridViewport`) — the textbook WAI-ARIA tabs case. So this carries the full
  // tab contract: roving `tabindex` (only the active tab sits in the page Tab
  // order), arrow-key navigation (Left/Right/Home/End, focus follows selection),
  // and an `aria-controls`/`role="tabpanel"` link to the grid panel (the panel side
  // is wired in the replay page via SHEET_GRID_PANEL_ID + sheetTabId, both in
  // `./sheet-tabs.ts`). Svelte
  // idioms: `{#each}` with runes.

  import type { Gid } from "@/lib/core/sheets/decoder/types";
  import { SHEET_GRID_PANEL_ID, sheetTabId } from "./sheet-tabs";

  export { SHEET_GRID_PANEL_ID, sheetTabId };
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { strings } from "@/lib/core/i18n/strings";
  import type { GridModel } from "@/lib/core/sheets/reconstruction/model";

  interface SheetTabsProps {
    readonly model: GridModel;
    readonly activeGid: Gid | null;
    readonly onSelect: (gid: Gid) => void;
  }

  const { model, activeGid, onSelect }: SheetTabsProps = $props();

  let tablistEl: HTMLDivElement | undefined = $state();

  // The single tab stop (roving tabindex): the active tab, or the first tab when
  // nothing is active yet — a tablist must always keep exactly one tab tabbable.
  const activeIndex = $derived.by(() => {
    const gid = activeGid;
    if (gid === null) return 0;
    const idx = model.order.indexOf(gid);
    return idx >= 0 ? idx : 0;
  });

  // Horizontal tab navigation with focus following selection (APG "automatic
  // activation"). Enter/Space already select via the native <button> click.
  const onKeyDown = async (event: KeyboardEvent): Promise<void> => {
    const order = model.order;
    if (order.length === 0) return;
    const current = activeIndex;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % order.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + order.length) % order.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = order.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const gid = order[next];
    if (gid === undefined) return;
    onSelect(gid);
    // Solid applied the selection synchronously; Svelte batches, so the new
    // roving `tabindex` is only on the DOM after a tick — focus after it.
    await tick();
    const tabs = tablistEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };
</script>

{#if model.order.length > 0}
  <!-- The WAI-ARIA tabs pattern puts the roving `tabindex` on the TABS, never on
       the tablist container itself; adding one here would insert a second tab stop
       and break the contract the tests assert. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    bind:this={tablistEl}
    class="seg"
    role="tablist"
    aria-label={strings.sheet.tabsLabel}
    onkeydown={onKeyDown}
  >
    {#each model.order as gid, index (index)}
      <button
        type="button"
        role="tab"
        id={sheetTabId(gid)}
        aria-selected={activeGid === gid}
        aria-controls={SHEET_GRID_PANEL_ID}
        tabindex={index === activeIndex ? 0 : -1}
        class={["seg-item", { "seg-item-active": activeGid === gid }]}
        onclick={() => onSelect(gid)}
      >
        {model.sheets.get(gid)?.name ?? gid}
      </button>
    {/each}
  </div>
{/if}
