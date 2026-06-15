// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay activation affordance (plan Phase 5 Step 9 / PRD §9.2, §11.2). An
// unobtrusive floating trigger styled with the design-system button shortcut.
// Solid idioms only: `props.x` (never destructured), `class` (never `className`),
// no `.map()`/ternary rendering. Activation happens ONLY on the user's explicit
// click (no auto-load). Icon is paired with text (§9.11).
//
// Click binding is the NON-delegated `on:click` (a real listener on the button),
// NOT Solid's delegated `onClick`. This component mounts inside the docs content
// script's shadow root, which sets `isolateEvents: ["click"]` — that stops click
// propagation at the shadow boundary, so it would never reach the document-level
// listener Solid uses for delegated `onClick`, and the handler would silently
// never fire. `on:click` fires at the target, before the isolation boundary.

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
      on:click={() => props.onActivate()}
    >
      <span aria-hidden="true">⟲</span>
      <span>Replay revisions</span>
    </button>
  );
};

export default ReplayAffordance;
