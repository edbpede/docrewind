<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Crosshair — the "follow / lock onto the active edit" mark (transport toggle).

  import Icon from "./Icon.svelte";
  import type { IconProps } from "./types";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <circle cx="12" cy="12" r="7.5" />
  <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
</Icon>
