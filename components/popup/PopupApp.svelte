<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // PopupApp — the toolbar action surface. Pinning the extension and clicking its
  // icon opens THIS popup (WXT auto-wires `action.default_popup` from the
  // `entrypoints/popup/` entrypoint; `action` needs no permission, so the privacy
  // invariant — permissions:["storage"], host:docs.google.com — is untouched).
  //
  // A friendly, fixed-width little app (360px) in the warm Apple-Settings register:
  // the shared theme applier, BrandMark chip, and `btn-*`/`dr-*` tokens. Two views
  // live in one popup — an overview (what DocRewind is, a calm privacy reassurance,
  // and quick actions) and an About ledger (version/author/license/source as a
  // grouped iOS row list) — toggled in place so the popup never needs a second page.
  // "Options" hands off to the real options page via `runtime.openOptionsPage()`
  // (no `tabs` permission required).
  //
  // Svelte idioms: `class` (never `className`). `ExternalLink` and `DetailRow` are
  // sibling components (one component per file) taking a `children` snippet.
  //
  // NOTE ON BRANCH ORDER: this was Solid's
  // `<Show when={view() === "about"} fallback={…overview…}>…about…</Show>`, where the
  // FALLBACK is the else branch. As `{#if}`/`{:else}` the two branches swap position
  // in the source: About comes first, the overview second. The rendered condition is
  // unchanged — `view === "about"` still selects the About ledger.

  import { browser } from "wxt/browser";
  import BrandMark from "@/components/common/BrandMark.svelte";
  import {
    IconArrowLeft,
    IconInfo,
    IconSettings,
    IconShield,
  } from "@/components/common/icons";
  import ThemeControl from "@/components/common/ThemeControl.svelte";
  import { useThemeSync } from "@/components/common/theme-sync.svelte";
  import DetailRow from "@/components/popup/DetailRow.svelte";
  import ExternalLink from "@/components/popup/ExternalLink.svelte";
  import { strings } from "@/lib/core/i18n/strings";

  const popup = strings.popup;

  /** Read the manifest version, falling back to an em dash if unavailable. */
  function appVersion(): string {
    try {
      return browser.runtime.getManifest().version ?? "—";
    } catch {
      return "—";
    }
  }

  useThemeSync();
  let view = $state<"main" | "about">("main");
  const version = appVersion();

  function openOptions(): void {
    // Opens the extension's own options page in a tab; the popup auto-dismisses
    // as focus moves to it. No `tabs` permission needed for own-page navigation.
    void browser.runtime.openOptionsPage();
  }
</script>

<div class="dr-surface w-90 max-w-full">
  {#if view === "about"}
    <div class="flex flex-col gap-4 p-5">
      <header class="flex items-center gap-2">
        <button
          type="button"
          class="btn-ghost px-2.5"
          aria-label={popup.backHint}
          onclick={() => {
            view = "main";
          }}
        >
          <IconArrowLeft size={18} />
          {popup.backButton}
        </button>
        <h2 class="dr-subheading ml-1">{popup.aboutHeading}</h2>
      </header>

      <div class="flex flex-col items-center gap-2 py-1 text-center">
        <BrandMark size={48} label={strings.app.brandName} />
        <span class="dr-heading">{strings.app.brandName}</span>
        <span class="dr-muted">{popup.tagline}</span>
      </div>

      <dl class="dr-rows m-0">
        <DetailRow label={popup.versionLabel}>
          <span class="font-mono tabular-nums text-ink-secondary">{version}</span>
        </DetailRow>
        <DetailRow label={popup.authorLabel}>
          <ExternalLink href={popup.authorUrl}>{popup.authorHandle}</ExternalLink>
        </DetailRow>
        <DetailRow label={popup.licenseLabel}>
          <span class="font-mono text-[0.8125rem] text-ink-secondary">{popup.licenseValue}</span>
        </DetailRow>
        <DetailRow label={popup.sourceLabel}>
          <ExternalLink href={popup.sourceUrl}>{popup.sourceText}</ExternalLink>
        </DetailRow>
      </dl>
    </div>
  {:else}
    <div class="flex flex-col gap-5 p-5">
      <header class="flex items-center gap-3.5">
        <BrandMark size={40} />
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="dr-subheading truncate">{strings.app.brandName}</span>
          <span class="dr-muted text-pretty">{popup.tagline}</span>
        </div>
        <span class="dr-badge ml-auto shrink-0 self-start font-mono tabular-nums">
          v{version}
        </span>
      </header>

      <p class="dr-body text-pretty">{popup.description}</p>

      <div class="banner-card">
        <IconShield class="banner-icon" />
        <div class="flex flex-col">
          <span class="banner-title">{popup.privacyNote}</span>
        </div>
      </div>

      <section class="dr-group" aria-labelledby="dr-popup-appearance">
        <h2 id="dr-popup-appearance" class="dr-group-label">
          {strings.options.settingsHeading}
        </h2>
        <div class="dr-rows">
          <ThemeControl />
        </div>
      </section>

      <div class="flex flex-col gap-2.5">
        <button type="button" class="btn-primary btn-block btn-lg" onclick={openOptions}>
          <IconSettings size={18} />
          {popup.optionsButton}
        </button>
        <button
          type="button"
          class="btn-secondary btn-block"
          onclick={() => {
            view = "about";
          }}
        >
          <IconInfo size={18} />
          {popup.aboutButton}
        </button>
      </div>
    </div>
  {/if}
</div>
