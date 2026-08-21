<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <circle cx="12" cy="12" r="9.25" />
  <path d="M12 11.5v5" />
  <path d="M12 7.75h.01" />
</Icon>
