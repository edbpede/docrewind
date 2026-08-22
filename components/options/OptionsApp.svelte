<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // OptionsApp (plan Phase 5 Step 8). The settings + privacy surface. It mounts the
  // SAME theme applier as the replay App (so changing the theme here restyles both
  // pages live), parses an optional `?doc=` for per-document cache clearing, and
  // wires every `lib/platform/settings.ts` item through a one-shot read on mount +
  // `setValue` (write). Never displays raw document data.
  //
  // Visual register: iOS-Settings — a warm canvas, a reassuring privacy banner, then
  // quiet group labels over grouped-row cards. Boolean settings are friendly switches
  // (a native checkbox kept for a11y + tests, styled as a switch via `peer-checked:`);
  // the theme is a segmented control; storage caps are unit-suffixed number fields.
  //
  // The three row shapes (`SwitchRow`, `BudgetRow`, `MaintenanceNote`) are sibling
  // components — Svelte allows one component per file.

  import { onMount } from "svelte";
  import BrandMark from "@/components/common/BrandMark.svelte";
  import PrivacySummary from "@/components/common/PrivacySummary.svelte";
  import ThemeControl from "@/components/common/ThemeControl.svelte";
  import { useThemeSync } from "@/components/common/theme-sync.svelte";
  import BudgetRow from "@/components/options/BudgetRow.svelte";
  import CacheControls from "@/components/options/CacheControls.svelte";
  import DiagnosticsPreferences from "@/components/options/DiagnosticsPreferences.svelte";
  import MaintenanceNote from "@/components/options/MaintenanceNote.svelte";
  import SwitchRow from "@/components/options/SwitchRow.svelte";
  import { asDocId } from "@/lib/core/domain/ids";
  import type { DocId } from "@/lib/core/domain/model";
  import { strings } from "@/lib/core/i18n/strings";
  import { createIdbStore } from "@/lib/platform/db";
  import { sendMessage } from "@/lib/platform/messaging";
  import {
    createPendingDestructiveStorageClear,
    createPendingStorageMaintenanceRequest,
    getPendingDestructiveStorageClears,
    getPendingStorageMaintenance,
    keepRawData,
    realIdentities,
    removePendingDestructiveStorageClear,
    removePendingStorageMaintenance,
    resolvedIdentities,
    type StorageBudget,
    storageBudget,
    upsertPendingDestructiveStorageClear,
    upsertPendingStorageMaintenance,
  } from "@/lib/platform/settings";

  const MIB = 1024 * 1024;

  function parseDocId(search: string): DocId | null {
    const raw = new URLSearchParams(search).get("doc");
    if (raw === null) {
      return null;
    }
    try {
      return asDocId(raw);
    } catch {
      return null;
    }
  }

  useThemeSync();

  const store = createIdbStore();
  const docId = parseDocId(window.location.search);

  // Read-once + optimistic local overwrite for each persisted item (the old
  // `createResource` + `mutate` pairs): the row repaints immediately while the
  // async `setValue` lands.
  let keepRaw = $state<boolean | undefined>(undefined);
  let showIdentities = $state<boolean | undefined>(undefined);
  let budget = $state<StorageBudget | undefined>(undefined);
  let maintenanceStatus = $state<"pending" | "failed" | null>(null);

  onMount(() => {
    void (async () => {
      keepRaw = await keepRawData.getValue();
    })();
    void (async () => {
      showIdentities = await realIdentities.getValue();
    })();
    void (async () => {
      budget = await storageBudget.getValue();
    })();
    void refreshPendingStatus();
  });

  function onKeepRaw(next: boolean): void {
    keepRaw = next;
    void keepRawData.setValue(next);
    const currentBudget = budget;
    void (async () => {
      const resolvedBudget = currentBudget ?? (await storageBudget.getValue());
      await sendDurableMaintenance({
        docId,
        keepRawData: next,
        budget: resolvedBudget,
      });
    })().catch(() => {
      maintenanceStatus = "failed";
    });
  }

  function onIdentities(next: boolean): void {
    showIdentities = next;
    void realIdentities.setValue(next);
    // Opting out falls back to opaque labels: drop the resolved-name cache so the
    // privacy promise is instantaneous, not deferred to session end (lib/platform/settings.ts).
    if (!next) {
      void resolvedIdentities.removeValue();
    }
  }

  function onBudget(field: "perDocumentBytes" | "globalCapBytes", mib: number): void {
    const current = budget;
    if (current === undefined || !Number.isFinite(mib) || mib <= 0) {
      return;
    }
    const next = { ...current, [field]: Math.round(mib * MIB) };
    budget = next;
    void storageBudget.setValue(next);
    void sendDurableMaintenance({
      docId,
      keepRawData: keepRaw ?? true,
      budget: next,
    }).catch(() => {
      maintenanceStatus = "failed";
    });
  }

  async function sendDurableMaintenance(input: {
    readonly docId: DocId | null;
    readonly keepRawData: boolean;
    readonly budget: StorageBudget;
  }): Promise<void> {
    const request = createPendingStorageMaintenanceRequest(input);
    await upsertPendingStorageMaintenance(request);
    maintenanceStatus = "pending";
    try {
      const ack = await sendMessage("requestStorageMaintenance", request);
      if (ack.status === "completed") {
        await removePendingStorageMaintenance(request.id, request.queuedAt);
        await refreshPendingStatus();
      } else {
        maintenanceStatus = ack.status === "failed" ? "failed" : "pending";
      }
    } catch {
      maintenanceStatus = "failed";
    }
  }

  async function refreshPendingStatus(): Promise<void> {
    const [pendingMaintenance, pendingClears] = await Promise.all([
      getPendingStorageMaintenance(),
      getPendingDestructiveStorageClears(),
    ]);
    maintenanceStatus =
      pendingMaintenance.length > 0 || pendingClears.length > 0 ? "pending" : null;
  }

  async function clearDocumentCache(targetDocId: DocId): Promise<void> {
    const request = createPendingDestructiveStorageClear({
      kind: "document",
      docId: targetDocId,
    });
    await upsertPendingDestructiveStorageClear(request);
    maintenanceStatus = "pending";
    try {
      const ack = await sendMessage("clearDocumentCache", request);
      if (ack.status === "completed") {
        await removePendingDestructiveStorageClear(request);
        await refreshPendingStatus();
      } else {
        maintenanceStatus = ack.status === "failed" ? "failed" : "pending";
      }
    } catch {
      maintenanceStatus = "failed";
    }
  }

  async function clearAllCaches(): Promise<void> {
    const request = createPendingDestructiveStorageClear({ kind: "all" });
    await upsertPendingDestructiveStorageClear(request);
    maintenanceStatus = "pending";
    try {
      const ack = await sendMessage("clearAllCaches", request);
      if (ack.status === "completed") {
        await removePendingDestructiveStorageClear(request);
        await refreshPendingStatus();
      } else {
        maintenanceStatus = ack.status === "failed" ? "failed" : "pending";
      }
    } catch {
      maintenanceStatus = "failed";
    }
  }
</script>

<div class="dr-page">
  <main class="mx-auto flex max-w-2xl flex-col gap-8 p-6 sm:p-8">
    <header class="flex items-center gap-3">
      <BrandMark size={36} />
      <h1 class="dr-title">{strings.options.title}</h1>
    </header>

    <PrivacySummary />

    <section class="dr-group" aria-labelledby="dr-appearance-heading">
      <h2 id="dr-appearance-heading" class="dr-group-label">
        {strings.options.settingsHeading}
      </h2>
      <div class="dr-rows">
        <ThemeControl />
      </div>
    </section>

    <section class="dr-group" aria-labelledby="dr-data-heading">
      <h2 id="dr-data-heading" class="dr-group-label">
        {strings.options.privacyHeading}
      </h2>
      <div class="dr-rows">
        <SwitchRow
          label={strings.options.realIdentitiesLabel}
          help={strings.options.realIdentitiesHint}
          checked={showIdentities ?? true}
          onChange={onIdentities}
        />
        <SwitchRow
          label={strings.options.keepRawLabel}
          help={strings.options.keepRawHint}
          checked={keepRaw ?? true}
          onChange={onKeepRaw}
        />
      </div>
    </section>

    <section class="dr-group" aria-labelledby="dr-cache-heading">
      <h2 id="dr-cache-heading" class="dr-group-label">
        {strings.options.cacheHeading}
      </h2>
      <div class="dr-rows">
        <BudgetRow
          id="dr-per-document-cap"
          label={strings.options.perDocumentCapLabel}
          value={Math.round((budget?.perDocumentBytes ?? 0) / MIB)}
          onInput={(mib) => onBudget("perDocumentBytes", mib)}
        />
        <BudgetRow
          id="dr-global-cap"
          label={strings.options.globalCapLabel}
          value={Math.round((budget?.globalCapBytes ?? 0) / MIB)}
          onInput={(mib) => onBudget("globalCapBytes", mib)}
        />
      </div>

      <CacheControls
        {store}
        {docId}
        onClearDocument={clearDocumentCache}
        onClearAll={clearAllCaches}
      />
    </section>

    <DiagnosticsPreferences />

    {#if maintenanceStatus}
      {@const status = maintenanceStatus}
      <MaintenanceNote failed={status === "failed"} />
    {/if}
  </main>
</div>
