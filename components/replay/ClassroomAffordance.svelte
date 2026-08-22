<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Google Classroom wrapper around `ReplayAffordance` — the styled box the
  // classroom content script mounts into its shadow root (PRD §9.2, §11.2).
  //
  // It exists because the spacing box used to be written as markup at the mount
  // site, and Svelte's `mount()` takes a COMPONENT, not a fragment. Do not collapse
  // it away by moving the styles onto the WXT container instead: the grading
  // surface prepends into a fixed-height flex action row that clips (see the
  // placement comment in `entrypoints/classroom.content.ts`), and this node is what
  // seats the button on it without disturbing that row.
  //
  // Inline styles only (no UnoCSS utility classes, which the shared-chunk dedup can
  // drop) — the button itself uses the safelisted `btn-secondary` /
  // `btn-secondary-compact` shortcuts, so it stays styled inside the shadow root.
  //
  // `compact` is fixed rather than forwarded: every Classroom surface this mounts
  // on (grading toolbar, submission card) is dense host chrome where the full-size
  // Docs-titlebar pill crowds or clips.

  import ReplayAffordance from "./ReplayAffordance.svelte";

  export interface ClassroomAffordanceProps {
    /** Invoked on the user's explicit click — never automatically. */
    readonly onActivate: () => void;
  }

  let { onActivate }: ClassroomAffordanceProps = $props();
</script>

<div style:display="inline-flex" style:align-items="center" style:margin="0 0.5rem">
  <ReplayAffordance {onActivate} compact />
</div>
