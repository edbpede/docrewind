<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Shared SVG frame for the DocRewind icon set — see `./index.ts` for the
  // set-wide provenance and style contract. `IconProps` lives here because this
  // is the component that defines the frame every icon renders through.

  export interface IconProps {
    /** Edge length in px. Default 20. */
    readonly size?: number | undefined;
    /** Extra classes (color via `text-*`, since paths use `currentColor`). */
    readonly class?: string | undefined;
    /** Stroke width for outline icons. Default 1.75. */
    readonly stroke?: number | undefined;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  type Internal = IconProps & { readonly children: Snippet; readonly filled?: boolean };

  /** Shared SVG frame. `filled` swaps stroke geometry for solid fills (play/pause). */
  let { size, class: klass, stroke, children, filled }: Internal = $props();
</script>

<svg
  width={size ?? 20}
  height={size ?? 20}
  viewBox="0 0 24 24"
  fill={filled ? "currentColor" : "none"}
  stroke={filled ? "none" : "currentColor"}
  stroke-width={stroke ?? 1.75}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={klass}
  aria-hidden="true"
>
  {@render children()}
</svg>
