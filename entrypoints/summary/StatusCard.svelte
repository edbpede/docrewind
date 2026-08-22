<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A centered status card (loading / missing / error). Calm, plain-language, with
  // one clear recovery action.
  //
  // Svelte allows one component per file, so this lifts out of `summary/App` as a
  // sibling rather than staying an inline second component.
  //
  // The `icon` prop stays COMPONENT-VALUED — it was Solid's
  // `Component<{ size?: number }>` rendered as `<props.icon size={32} />`. Here it is
  // destructured to a CAPITALIZED local (`icon: Icon`), because Svelte's compiler
  // only treats a tag as a component when its name starts with a capital letter:
  // `<icon />` would emit a literal `<icon>` element instead. The icon set is a
  // directory of real components (see components/common/icons/index.ts), so an icon
  // passes through as a plain value exactly as it did under Solid.

  import type { Component } from "svelte";

  export interface StatusCardProps {
    readonly icon: Component<{ readonly size?: number | undefined }>;
    readonly title: string;
    readonly body: string;
    readonly action?: { readonly label: string; readonly href: string } | undefined;
  }

  let { icon: Icon, title, body, action }: StatusCardProps = $props();
</script>

<section class="dr-card flex flex-col items-center gap-3 py-10 text-center">
  <span class="text-ink-muted"><Icon size={32} /></span>
  <h2 class="dr-heading">{title}</h2>
  <p class="text-ink-muted" style:max-width="32rem">{body}</p>
  {#if action}
    {@const link = action}
    <a class="btn-primary mt-1 inline-flex items-center gap-1.5" href={link.href}>{link.label}</a>
  {/if}
</section>
