<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import Icon from "./Icon.svelte";
  import type { IconProps } from "./types";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M14 4h6v6" />
  <path d="M20 4 11 13" />
  <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
</Icon>
