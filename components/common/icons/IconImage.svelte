<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <rect x="3" y="3" width="18" height="18" rx="2.5" />
  <circle cx="8.5" cy="8.5" r="1.6" />
  <path d="m21 15-4.5-4.5L6 21" />
</Icon>
