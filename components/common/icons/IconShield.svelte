<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Shield-check — the privacy / on-device reassurance mark.

  import Icon from "./Icon.svelte";
  import type { IconProps } from "./types";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M12 21.5c4.4-1.5 8-4.2 8-9.3V5.6a1 1 0 0 0-.7-.95C16.6 3.8 14.3 2.9 12.5 2.1a1.2 1.2 0 0 0-1 0C9.7 2.9 7.4 3.8 4.7 4.65a1 1 0 0 0-.7.95v6.6c0 5.1 3.6 7.8 8 9.3Z" />
  <path d="m9 12 2 2 4-4.5" />
</Icon>
