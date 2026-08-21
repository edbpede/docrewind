<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M19 12H5" />
  <path d="m12 19-7-7 7-7" />
</Icon>
