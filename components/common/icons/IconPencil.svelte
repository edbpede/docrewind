<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon from "./Icon.svelte";
  import type { IconProps } from "./types";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M12.5 5.5 16 9M4 20l1-4 11-11a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" />
</Icon>
