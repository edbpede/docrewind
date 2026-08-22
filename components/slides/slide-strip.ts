// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The DOM-id contract between `SlideStrip.svelte` and the slide panel it controls.
// Both halves of the WAI-ARIA tabs wiring need these: the filmstrip sets
// `aria-controls`/`id` from here, and the replay page sets the panel's `id` and
// `aria-labelledby` from the same values.
//
// A plain `.ts` rather than `SlideStrip.svelte`'s `<script module>` so `tsc` can
// resolve it: `tsc` reads a `.svelte` specifier through the ambient `*.svelte`
// shim, which declares a default export only, so a named export imported from a
// `.ts` file (here, `test/slides.components.test.ts`) fails to typecheck even though
// `svelte-check` resolves it. Same reasoning as `components/replay/timeline-markers.ts`.

/** DOM id of the slide `role="tabpanel"` the strip controls (set on the panel in App). */
export const SLIDE_PANEL_ID = "dr-slide-panel";

/** Stable DOM id for a thumbnail tab, so the panel can name itself via `aria-labelledby`. */
export const slideTabId = (index: number): string => `dr-slide-tab-${index}`;
