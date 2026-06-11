// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay activation affordance (plan §1.6 / PRD §9.2, §11.2). A minimal, style-
// isolated, intentional trigger — full visual design is Phase 5 (frontend-design
// skill). Solid idioms only: `props.x` (never destructured), `class` (never
// `className`), an explicit `onClick`, no `.map()`/ternary rendering, no React
// hooks. Activation happens ONLY on the user's explicit click (no auto-load).

import type { Component } from "solid-js";

export interface ReplayAffordanceProps {
  /** Invoked on the user's explicit click — never automatically. */
  readonly onActivate: () => void;
}

const ReplayAffordance: Component<ReplayAffordanceProps> = (props) => {
  return (
    <button
      type="button"
      class="docrewind-replay-trigger"
      aria-label="Replay this document's revision history"
      onClick={() => props.onActivate()}
    >
      Replay revisions
    </button>
  );
};

export default ReplayAffordance;
