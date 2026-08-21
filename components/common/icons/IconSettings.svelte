<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M21 4h-7" />
  <path d="M10 4H3" />
  <path d="M21 12h-9" />
  <path d="M8 12H3" />
  <path d="M21 20h-5" />
  <path d="M12 20H3" />
  <path d="M14 2v4" />
  <path d="M8 10v4" />
  <path d="M16 18v4" />
</Icon>
