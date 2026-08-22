<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // ThemeSegmented — the pill row of the ThemeControl widget: an accessible `seg`
  // group over the three theme states. Split out of `ThemeControl.svelte` because
  // Svelte allows one component per file; `THEME_OPTIONS` lives here, beside its
  // only consumer, and is re-exported by `ThemeControl.svelte` so the module's
  // public surface is unchanged.

  import { strings } from "@/lib/core/i18n/strings";
  import type { Theme } from "@/lib/platform/settings";

  /** The three supported theme states, in display order, with localized labels. */
  export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
    { value: "system", label: strings.options.themeSystem },
    { value: "light", label: strings.options.themeLight },
    { value: "dark", label: strings.options.themeDark },
  ];
</script>

<script lang="ts">
  interface ThemeSegmentedProps {
    readonly value: Theme;
    readonly onChange: (next: Theme) => void;
  }

  let { value, onChange }: ThemeSegmentedProps = $props();
</script>

<fieldset class="seg m-0 border-0">
  <legend class="sr-only">{strings.options.themeLabel}</legend>
  {#each THEME_OPTIONS as option (option.value)}
    <button
      type="button"
      class={value === option.value ? "seg-item seg-item-active" : "seg-item"}
      aria-pressed={value === option.value}
      onclick={() => onChange(option.value)}
    >
      {option.label}
    </button>
  {/each}
</fieldset>
