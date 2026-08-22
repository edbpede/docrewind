<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The durable-maintenance status line under the options groups: "queued" while a
  // guarded storage request is outstanding, "could not be confirmed" once one failed.
  // Meaning never relies on hue alone — the icon swaps with the tone.
  //
  // Split out of `OptionsApp.svelte` (one component per file).

  import { IconAlert, IconInfo } from "@/components/common/icons";
  import { strings } from "@/lib/core/i18n/strings";

  interface MaintenanceNoteProps {
    readonly failed: boolean;
  }

  let { failed }: MaintenanceNoteProps = $props();
</script>

<p class={failed ? "note-warning" : "note-info"} role="status">
  {#if failed}
    <IconAlert size={18} class="note-icon" />
  {:else}
    <IconInfo size={18} class="note-icon" />
  {/if}
  <span>
    {failed ? strings.options.maintenanceFailed : strings.options.maintenancePending}
  </span>
</p>
