// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay activation affordance (plan Phase 5 Step 9 / PRD §9.2, §11.2). An
// unobtrusive trigger that mounts inside the Google Docs titlebar button row so
// it reads as a native part of the toolbar (styled with the `btn-secondary`
// design-system shortcut — the bordered, neutral pill that blends with the
// Share-button group rather than the brand-colored primary button).
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
import { IconHistory } from "@/components/common/icons";

export interface ReplayAffordanceProps {
  /** Invoked on the user's explicit click — never automatically. */
  readonly onActivate: () => void;
  /**
   * Render the smaller `btn-secondary-compact` chip used inside dense host chrome — the
   * Google Classroom grading toolbar and submission card, where the default
   * (Docs-titlebar) size crowds or clips the embedding surface. Defaults to the
   * full size.
   */
  readonly compact?: boolean;
}

const ReplayAffordance: Component<ReplayAffordanceProps> = (props) => {
  return (
    <button
      type="button"
      class={`${props.compact ? "btn-secondary-compact" : "btn-secondary"} self-center whitespace-nowrap`}
      aria-label="Replay this document's revision history"
      on:click={() => props.onActivate()}
    >
      {/* A clock-with-rewind mark in the brand accent: enough identity to be
          findable in the Docs toolbar, on a neutral pill that still feels native.
          Replaces the ambiguous ⟲ glyph (often read as undo/refresh). */}
      <IconHistory size={props.compact ? 16 : 18} class="text-brand-text" />
      <span>Replay revisions</span>
    </button>
  );
};

export default ReplayAffordance;
