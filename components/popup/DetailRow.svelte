<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One label/value row in the About ledger (the iOS grouped-row pattern).
  // A sibling of `PopupApp.svelte` (one component per file); the value arrives as
  // the implicit `children` snippet.

  import type { Snippet } from "svelte";

  interface DetailRowProps {
    readonly label: string;
    readonly children: Snippet;
  }

  let { label, children }: DetailRowProps = $props();
</script>

<div class="dr-row">
  <dt class="dr-row-label shrink-0">{label}</dt>
  <dd class="m-0 min-w-0 text-right text-[0.9375rem]">{@render children?.()}</dd>
</div>
