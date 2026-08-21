<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke} filled>
  <rect x="6" y="5" width="4" height="14" rx="1.4" />
  <rect x="14" y="5" width="4" height="14" rx="1.4" />
</Icon>
