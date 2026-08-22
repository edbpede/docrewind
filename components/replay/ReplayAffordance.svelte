<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Replay activation affordance (plan Phase 5 Step 9 / PRD §9.2, §11.2). An
  // unobtrusive trigger that mounts inside the Google Docs titlebar button row so
  // it reads as a native part of the toolbar (styled with the `btn-secondary`
  // design-system shortcut — the bordered, neutral pill that blends with the
  // Share-button group rather than the brand-colored primary button).
  // Svelte idioms only: runes (`$props()` IS destructured here — unlike Solid's
  // `props.x`, that keeps reactivity), `class` (never `className`), `{#if}`/`{#each}`
  // rather than `.map()`/ternary RENDERING (the two ternaries below pick a class
  // token and an icon size, not markup). Activation happens ONLY on the user's
  // explicit click (no auto-load). Icon is paired with text (§9.11).
  //
  // The click binding is a plain `onclick`, which Svelte 5 compiles to a REAL
  // listener on the button itself. Under Solid this had to be spelled as the
  // non-delegated `on:click` instead of `onClick`, because this component mounts
  // inside the docs (and Classroom) content script's shadow root, which sets
  // `isolateEvents: ["click"]` — that stops click propagation at the shadow
  // boundary, so a delegated handler hung off the document would never have seen
  // the event and would have silently never fired. Svelte delegates nothing, so
  // that hazard is gone and no escape hatch is needed. The isolation boundary
  // itself is NOT gone: nothing added here may rely on a click escaping to the
  // host page, or on the host page's own listeners seeing ours.

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

  let { onActivate, compact }: ReplayAffordanceProps = $props();
</script>

<button
  type="button"
  class={`${compact ? "btn-secondary-compact" : "btn-secondary"} self-center whitespace-nowrap`}
  aria-label="Replay this document's revision history"
  onclick={() => onActivate()}
>
  <!-- A clock-with-rewind mark in the brand accent: enough identity to be
       findable in the Docs toolbar, on a neutral pill that still feels native.
       Replaces the ambiguous ⟲ glyph (often read as undo/refresh). -->
  <IconHistory size={compact ? 16 : 18} class="text-brand-text" />
  <span>Replay revisions</span>
</button>
