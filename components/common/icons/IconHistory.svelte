<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A clock-with-rewind — the "revision history / replay" mark.

  import Icon from "./Icon.svelte";
  import type { IconProps } from "./types";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
  <path d="M3 3v5h5" />
  <path d="M12 7.5V12l3 1.7" />
</Icon>
