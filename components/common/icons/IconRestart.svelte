<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
  <path d="M3 3v5h5" />
</Icon>
