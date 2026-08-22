<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // DiagnosticsPreferences (plan Phase 5 Step 8 / PRD §10.8). A SETTINGS TOGGLE
  // ONLY: choose default vs. structural diagnostics verbosity, backed by
  // `lib/platform/settings.ts`. No diagnostic-report rendering ships in Phase 5 (deferred).
  // Presented as an iOS-style grouped row with a segmented control on the right.

  import { onMount } from "svelte";
  import { strings } from "@/lib/core/i18n/strings";
  import { type DiagnosticsMode, diagnosticsMode } from "@/lib/platform/settings";

  const MODES = ["default", "structural"] as const satisfies readonly DiagnosticsMode[];

  function modeLabel(item: DiagnosticsMode): string {
    return item === "default"
      ? strings.options.diagnosticsDefault
      : strings.options.diagnosticsStructural;
  }

  // Read-once + optimistic local overwrite (the old `createResource` + `mutate`).
  let mode = $state<DiagnosticsMode | undefined>(undefined);

  onMount(async () => {
    mode = await diagnosticsMode.getValue();
  });

  function select(next: DiagnosticsMode): void {
    mode = next;
    void diagnosticsMode.setValue(next);
  }
</script>

<section class="dr-group" aria-labelledby="dr-diagnostics-heading">
  <h2 id="dr-diagnostics-heading" class="dr-group-label">
    {strings.options.diagnosticsHeading}
  </h2>
  <div class="dr-rows">
    <div class="dr-row-stack">
      <p class="dr-row-help">{strings.options.diagnosticsBody}</p>
      <fieldset class="seg m-0 self-start border-0">
        <legend class="sr-only">{strings.options.diagnosticsHeading}</legend>
        <!--
          Was Solid's `<Index each={MODES}>`, which is position-keyed and updates in
          place. Svelte's KEYLESS `{#each}` is the exact equivalent (§6.1).
          DO NOT ADD A KEY HERE.
        -->
        {#each MODES as item}
          <button
            type="button"
            class={mode === item ? "seg-item seg-item-active" : "seg-item"}
            aria-pressed={mode === item}
            onclick={() => select(item)}
          >
            {modeLabel(item)}
          </button>
        {/each}
      </fieldset>
    </div>
  </div>
</section>
