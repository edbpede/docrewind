<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A bar chart — the "document summary / writing insights" mark.

  import Icon, { type IconProps } from "./Icon.svelte";

  let { size, class: klass, stroke }: IconProps = $props();
</script>

<Icon {size} class={klass} {stroke}>
  <path d="M4 4v16h16" />
  <path d="M8 16v-4" />
  <path d="M13 16V8" />
  <path d="M18 16v-7" />
</Icon>
