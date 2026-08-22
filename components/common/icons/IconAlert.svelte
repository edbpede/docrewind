<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon from "./Icon.svelte";
  import type { IconProps } from "./types";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  <path d="M12 9v4.5" />
  <path d="M12 17.25h.01" />
</Icon>
