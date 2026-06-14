// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay activation affordance (plan Phase 5 Step 9 / PRD §9.2, §11.2). An
// unobtrusive floating trigger styled with the design-system button shortcut.
// Solid idioms only: `props.x` (never destructured), `class` (never `className`),
// an explicit `onClick`, no `.map()`/ternary rendering. Activation happens ONLY on
// the user's explicit click (no auto-load). Icon is paired with text (§9.11).

import type { Component } from "solid-js";

export interface ReplayAffordanceProps {
  /** Invoked on the user's explicit click — never automatically. */
  readonly onActivate: () => void;
}

const ReplayAffordance: Component<ReplayAffordanceProps> = (props) => {
  return (
    <button
      type="button"
      class="btn-primary fixed bottom-4 right-4 z-[2147483647] shadow-lg"
      aria-label="Replay this document's revision history"
      onClick={() => props.onActivate()}
    >
      <span aria-hidden="true">⟲</span>
      <span>Replay revisions</span>
    </button>
  );
};

export default ReplayAffordance;
