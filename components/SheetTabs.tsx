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
// is wired in the replay page via SHEET_GRID_PANEL_ID + sheetTabId). SolidJS
// idioms: `<For>`, never destructure props.

import type { Component } from "solid-js";
import { createMemo, For, Show } from "solid-js";
import { strings } from "@/lib/i18n/strings";
import type { Gid } from "@/lib/sheets-decoder/types";
import type { GridModel } from "@/lib/sheets-reconstruction/model";

/** DOM id of the grid `role="tabpanel"` the tabs control (set on the panel in App). */
export const SHEET_GRID_PANEL_ID = "dr-sheet-grid-panel";

/** Stable DOM id for a tab, so the panel can name itself via `aria-labelledby`. */
export const sheetTabId = (gid: Gid): string => `dr-sheet-tab-${gid}`;

export interface SheetTabsProps {
  readonly model: GridModel;
  readonly activeGid: Gid | null;
  readonly onSelect: (gid: Gid) => void;
}

const SheetTabs: Component<SheetTabsProps> = (props) => {
  let tablistEl!: HTMLDivElement;

  // The single tab stop (roving tabindex): the active tab, or the first tab when
  // nothing is active yet — a tablist must always keep exactly one tab tabbable.
  const activeIndex = createMemo(() => {
    const gid = props.activeGid;
    if (gid === null) return 0;
    const idx = props.model.order.indexOf(gid);
    return idx >= 0 ? idx : 0;
  });

  // Horizontal tab navigation with focus following selection (APG "automatic
  // activation"). Enter/Space already select via the native <button> click.
  const onKeyDown = (event: KeyboardEvent): void => {
    const order = props.model.order;
    if (order.length === 0) return;
    const current = activeIndex();
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
    props.onSelect(gid);
    const tabs = tablistEl.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[next]?.focus();
  };

  return (
    <Show when={props.model.order.length > 0}>
      <div
        ref={tablistEl}
        class="seg"
        role="tablist"
        aria-label={strings.sheet.tabsLabel}
        onKeyDown={onKeyDown}
      >
        <For each={props.model.order}>
          {(gid, index) => (
            <button
              type="button"
              role="tab"
              id={sheetTabId(gid)}
              aria-selected={props.activeGid === gid}
              aria-controls={SHEET_GRID_PANEL_ID}
              tabindex={index() === activeIndex() ? 0 : -1}
              class="seg-item"
              classList={{ "seg-item-active": props.activeGid === gid }}
              onClick={() => props.onSelect(gid)}
            >
              {props.model.sheets.get(gid)?.name ?? gid}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};

export default SheetTabs;
