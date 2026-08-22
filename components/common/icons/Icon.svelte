<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Shared SVG frame for the DocRewind icon set — see `./index.ts` for the
  // set-wide provenance and style contract. The prop contract lives in `./types.ts`
  // and is re-exported here so every icon can take it from the frame it renders
  // through.

  import type { IconProps } from "./types";

  export type { IconProps };
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
