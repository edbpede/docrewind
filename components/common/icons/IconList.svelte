<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M8 6h13M8 12h13M8 18h13" />
  <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
</Icon>
