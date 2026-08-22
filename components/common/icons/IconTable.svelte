<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon from "./Icon.svelte";
  import type { IconProps } from "./types";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <rect x="3" y="3" width="18" height="18" rx="2.5" />
  <path d="M3 9h18M3 15h18M9 3v18" />
</Icon>
