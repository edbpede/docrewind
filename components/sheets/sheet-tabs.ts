// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The DOM-id contract between `SheetTabs.svelte` and the grid panel it controls.
// Both halves of the WAI-ARIA tabs wiring need these: the tablist sets
// `aria-controls`/`id` from here, and the replay page sets the panel's `id` and
// `aria-labelledby` from the same values.
//
// A plain `.ts` rather than `SheetTabs.svelte`'s `<script module>` so `tsc` can
// resolve it: `tsc` reads a `.svelte` specifier through the ambient `*.svelte`
// shim, which declares a default export only, so a named export imported from a
// `.ts` file (here, `test/grid.components.test.ts`) fails to typecheck even though
// `svelte-check` resolves it. Same reasoning as `components/replay/timeline-markers.ts`.

import type { Gid } from "@/lib/core/sheets/decoder/types";

/** DOM id of the grid `role="tabpanel"` the tabs control (set on the panel in App). */
export const SHEET_GRID_PANEL_ID = "dr-sheet-grid-panel";

/** Stable DOM id for a tab, so the panel can name itself via `aria-labelledby`. */
export const sheetTabId = (gid: Gid): string => `dr-sheet-tab-${gid}`;
