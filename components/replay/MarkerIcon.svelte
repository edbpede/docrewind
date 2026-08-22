<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // An intuitive icon per timeline marker kind — a non-color affordance paired with
  // the seal hue (§9.11): a pencil for a writing session, a plus for a surge of
  // inserted text, a minus for a passage cut, and paused bars for a pause between
  // sittings. (These replace the old scholarly glyphs § ⌃ ⌄ ‖, which read as cryptic
  // to non-technical users.) A COMPONENT rather than a function, because a Svelte
  // function cannot return markup — this is the one piece of the old `markerIcon()`
  // that could not move into the pure `timeline-markers.ts`. The scrubber and the
  // legend both render it, so each mark is keyed to its meaning by the same glyph.

  import { IconMinus, IconPauseBars, IconPencil, IconPlus } from "@/components/common/icons";
  import type { TimelineMarkerKind } from "./timeline-markers";

  interface MarkerIconProps {
    readonly kind: TimelineMarkerKind;
    /** Edge length in px. Default 12 — the seal-sized glyph. */
    readonly size?: number | undefined;
  }

  const { kind, size = 12 }: MarkerIconProps = $props();
</script>

<!-- The old `markerIcon()` closed its switch with a `never` guard, which a Svelte
     `{#if}` chain cannot express. The last branch is therefore written as an explicit
     `kind === "pause"` rather than a bare `{:else}`, so a fifth marker kind renders
     NOTHING (visibly wrong) instead of silently inheriting the pause glyph. The union
     itself is still guarded at compile time by `markerToneClass`'s `never` case and by
     `CLUSTER_KIND_LABEL`'s `Record<TimelineMarkerKind, string>` in ./timeline-markers.ts,
     both of which fail to build if a kind is added — add the glyph here at the same time. -->
{#if kind === "session"}
  <IconPencil {size} />
{:else if kind === "large-insertion"}
  <IconPlus {size} />
{:else if kind === "large-deletion"}
  <IconMinus {size} />
{:else if kind === "pause"}
  <IconPauseBars {size} />
{/if}
