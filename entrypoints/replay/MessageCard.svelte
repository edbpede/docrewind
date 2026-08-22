<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A small centered card for missing-doc / load-failure states. Calm, not alarming:
  // a brand row for orientation, the privacy reassurance, then a plain-language error
  // with one clear recovery action.
  //
  // Its own file because Svelte is one component per file.

  import BrandMark from "@/components/common/BrandMark.svelte";
  import { IconAlert } from "@/components/common/icons";
  import PrivacyBanner from "@/components/common/PrivacyBanner.svelte";
  import { strings } from "@/lib/core/i18n/strings";

  export interface MessageCardProps {
    readonly title: string;
    readonly body: string;
    readonly actionLabel?: string | undefined;
    readonly onAction?: (() => void) | undefined;
  }

  const { title, body, actionLabel, onAction }: MessageCardProps = $props();
</script>

<main class="mx-auto flex max-w-prose flex-col gap-4 p-6 sm:p-8">
  <div class="flex items-center gap-2.5">
    <BrandMark size={30} />
    <span class="text-base font-semibold text-ink">{strings.app.brandName}</span>
  </div>
  <PrivacyBanner />
  <div class="dr-card flex items-start gap-3">
    <IconAlert size={22} class="mt-0.5 shrink-0 text-danger" />
    <div class="flex flex-col gap-1.5">
      <h1 class="dr-subheading text-balance">{title}</h1>
      <p class="dr-body text-ink-secondary text-pretty">{body}</p>
      {#if actionLabel}
        {@const label = actionLabel}
        <button type="button" class="btn-primary mt-1.5 self-start" onclick={() => onAction?.()}>
          {label}
        </button>
      {/if}
    </div>
  </div>
</main>
