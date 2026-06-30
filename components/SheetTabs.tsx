// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SheetTabs — the multi-sheet tab switcher for a Sheets replay (plan P3). A
// DESIGN segmented/pill control (reusing the `seg` register) over the grid
// model's `order: Gid[]`, so tabs reflect the sheet set AND its order at the
// current revision (add/rename/delete are replayed into the model). Renders
// nothing for a single unnamed sheet would still show one tab — a spreadsheet
// always has at least one. Content-free: shows sheet NAMES (metadata), never
// cell data. SolidJS idioms: `<For>`, never destructure props.

import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { strings } from "@/lib/i18n/strings";
import type { Gid } from "@/lib/sheets-decoder/types";
import type { GridModel } from "@/lib/sheets-reconstruction/model";

export interface SheetTabsProps {
  readonly model: GridModel;
  readonly activeGid: Gid | null;
  readonly onSelect: (gid: Gid) => void;
}

const SheetTabs: Component<SheetTabsProps> = (props) => {
  return (
    <Show when={props.model.order.length > 0}>
      <div class="seg" role="tablist" aria-label={strings.sheet.tabsLabel}>
        <For each={props.model.order}>
          {(gid) => (
            <button
              type="button"
              role="tab"
              aria-selected={props.activeGid === gid}
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
