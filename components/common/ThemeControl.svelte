<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // ThemeControl — the shared light/dark/system appearance selector. A pill-style
  // segmented control (`seg`/`seg-item`/`seg-item-active`) wired to the persisted
  // `theme` setting via a one-shot read on mount + `theme.setValue` (write). The SAME
  // control mounts in OptionsApp, PopupApp, and the replay surface so every UI reads
  // and writes ONE source of truth; whichever host mounts it also mounts
  // `useThemeSync`, so the `.dark` class on `<html>` repaints live the instant
  // `setValue` lands.
  //
  // Two presentations from one widget:
  //   • default — a `dr-row` (visible label ↔ segmented control) for the grouped
  //     settings cards in OptionsApp/PopupApp; the host owns the `dr-rows` chrome.
  //   • `bare`  — just the segmented control (accessible name from the sr-only
  //     legend) for inline placement like the replay footer.
  //
  // Svelte idioms: `class` (never `className`); `{#each}`/`{#if}` over `.map()`/ternaries.
  // The pill row itself lives in `ThemeSegmented.svelte` (one component per file);
  // `THEME_OPTIONS` is defined there and re-exported here so this module's public
  // surface is exactly what it was before the port.

  export { THEME_OPTIONS } from "./ThemeSegmented.svelte";
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import ThemeSegmented from "@/components/common/ThemeSegmented.svelte";
  import { strings } from "@/lib/core/i18n/strings";
  import { type Theme, theme } from "@/lib/platform/settings";

  interface ThemeControlProps {
    readonly bare?: boolean | undefined;
  }

  let { bare }: ThemeControlProps = $props();

  // Read-once + optimistic local overwrite: the pills repaint immediately while the
  // async `setValue` lands, exactly as the old `createResource`/`mutate` pair did.
  //
  let themeValue = $state<Theme | undefined>(undefined);

  onMount(async () => {
    themeValue = await theme.getValue();
  });

  function onTheme(next: Theme): void {
    if (themeValue === next) return;
    themeValue = next;
    void theme.setValue(next);
  }
</script>

{#if !bare}
  <div class="dr-row">
    <span class="dr-row-label">{strings.options.themeLabel}</span>
    <ThemeSegmented value={themeValue ?? "system"} onChange={onTheme} />
  </div>
{:else}
  <ThemeSegmented value={themeValue ?? "system"} onChange={onTheme} />
{/if}
