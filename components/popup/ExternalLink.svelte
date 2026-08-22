<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // An external link styled as a quiet, focusable inline action with an icon.
  // A sibling of `PopupApp.svelte` (one component per file); the link text arrives
  // as the implicit `children` snippet.

  import type { Snippet } from "svelte";
  import { IconExternal } from "@/components/common/icons";

  interface ExternalLinkProps {
    readonly href: string;
    readonly children: Snippet;
  }

  let { href, children }: ExternalLinkProps = $props();
</script>

<a {href} target="_blank" rel="noreferrer noopener" class="dr-link inline-flex items-center gap-1"
  >{@render children?.()}<IconExternal size={14} class="shrink-0 text-ink-faint" /></a
>
