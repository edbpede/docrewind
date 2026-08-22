<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // CacheControls (plan Phase 5 Step 8 / PRD §9.8). Clear cached data for the
  // current document (when the options page was opened with a `?doc=`) or for every
  // document, and show approximate usage. Destructive actions confirm first. Never
  // displays raw data — only coarse byte figures.

  import { onMount } from "svelte";
  import { IconInfo, IconTrash } from "@/components/common/icons";
  import type { DocId } from "@/lib/core/domain/model";
  import { strings } from "@/lib/core/i18n/strings";
  import type { RevisionStore, UsageEstimate } from "@/lib/core/store";

  export interface CacheControlsProps {
    readonly store: RevisionStore;
    /** Present when the page was opened in the context of one document. */
    readonly docId: DocId | null;
    readonly onClearDocument: (docId: DocId) => Promise<void>;
    readonly onClearAll: () => Promise<void>;
  }

  let { store, docId, onClearDocument, onClearAll }: CacheControlsProps = $props();

  function formatMib(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // The old `createResource` read the estimate once and exposed a `refetch`; here the
  // loader is a named async function the clear handlers re-invoke after a clear lands.
  let usage = $state<UsageEstimate | undefined>(undefined);

  async function loadUsage(): Promise<void> {
    usage = await store.estimateUsage();
  }

  onMount(() => {
    void loadUsage();
  });

  async function clearDocument(id: DocId): Promise<void> {
    if (!window.confirm(strings.options.clearConfirm)) {
      return;
    }
    await onClearDocument(id);
    void loadUsage();
  }

  async function clearAll(): Promise<void> {
    if (!window.confirm(strings.options.clearConfirm)) {
      return;
    }
    await onClearAll();
    void loadUsage();
  }
</script>

<!--
  The "Cached data" group heading is owned by the parent OptionsApp (one
  heading per group); this component renders the storage readout + the clear
  actions beneath the budget rows.
-->
<div class="dr-group">
  {#if usage !== undefined && usage.quota}
    {@const estimate = usage}
    <div class="dr-rows">
      <div class="dr-row">
        <span class="dr-row-label">{strings.options.cacheHeading}</span>
        <span class="dr-counter">
          {formatMib(estimate.usage)} / {formatMib(estimate.quota)}
        </span>
      </div>
    </div>
  {:else}
    <p class="note-info" role="status">
      <IconInfo size={18} class="note-icon" />
      <span>{strings.options.usageUnknown}</span>
    </p>
  {/if}

  <div class="flex flex-wrap gap-2 px-1">
    {#if docId}
      {@const id = docId}
      <button type="button" class="btn-secondary" onclick={() => void clearDocument(id)}>
        <IconTrash size={18} />
        {strings.options.clearCurrent}
      </button>
    {/if}
    <button type="button" class="btn-danger" onclick={() => void clearAll()}>
      <IconTrash size={18} />
      {strings.options.clearAll}
    </button>
  </div>
</div>
