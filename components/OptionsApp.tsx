// SPDX-License-Identifier: AGPL-3.0-or-later
//
// OptionsApp (plan Phase 5 Step 8). The settings + privacy surface. It mounts the
// SAME theme applier as the replay App (so changing the theme here restyles both
// pages live), parses an optional `?doc=` for per-document cache clearing, and
// wires every `lib/settings.ts` item through `createResource` (read) + `setValue`
// (write). Never displays raw document data.

import type { Component } from "solid-js";
import { createResource, For } from "solid-js";
import CacheControls from "@/components/CacheControls";
import DiagnosticsPreferences from "@/components/DiagnosticsPreferences";
import PrivacySummary from "@/components/PrivacySummary";
import { useThemeSync } from "@/components/theme-sync";
import { createIdbStore } from "@/lib/db";
import { asDocId } from "@/lib/domain/ids";
import type { DocId } from "@/lib/domain/model";
import { strings } from "@/lib/i18n/strings";
import { keepRawData, realIdentities, storageBudget, type Theme, theme } from "@/lib/settings";
import { enforceStorageBudget, enforceStorageBudgetForAll } from "@/lib/storage-maintenance";

const MIB = 1024 * 1024;

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: strings.options.themeSystem },
  { value: "light", label: strings.options.themeLight },
  { value: "dark", label: strings.options.themeDark },
];

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

const OptionsApp: Component = () => {
  useThemeSync();

  const store = createIdbStore();
  const docId = parseDocId(window.location.search);

  const [themeValue, { mutate: mutateTheme }] = createResource(() => theme.getValue());
  const [keepRaw, { mutate: mutateKeepRaw }] = createResource(() => keepRawData.getValue());
  const [showIdentities, { mutate: mutateIdentities }] = createResource(() =>
    realIdentities.getValue(),
  );
  const [budget, { mutate: mutateBudget }] = createResource(() => storageBudget.getValue());

  function onTheme(next: Theme): void {
    mutateTheme(next);
    void theme.setValue(next);
  }

  function onKeepRaw(next: boolean): void {
    mutateKeepRaw(next);
    void keepRawData.setValue(next);
    if (!next) {
      void store.deleteRawAll();
    }
  }

  function onIdentities(next: boolean): void {
    mutateIdentities(next);
    void realIdentities.setValue(next);
  }

  function onBudget(field: "perDocumentBytes" | "globalCapBytes", mib: number): void {
    const current = budget();
    if (current === undefined || !Number.isFinite(mib) || mib <= 0) {
      return;
    }
    const next = { ...current, [field]: Math.round(mib * MIB) };
    mutateBudget(next);
    void storageBudget.setValue(next);
    void (docId === null
      ? enforceStorageBudgetForAll(store, next)
      : enforceStorageBudget(store, docId, next));
  }

  return (
    <div class="dr-page">
      <main class="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h1 class="text-xl font-semibold">{strings.options.title}</h1>

        <PrivacySummary />

        <section class="dr-card flex flex-col gap-3" aria-labelledby="dr-prefs-heading">
          <h2 id="dr-prefs-heading" class="font-medium">
            {strings.options.settingsHeading}
          </h2>

          <label class="flex items-center justify-between gap-3">
            <span>{strings.options.themeLabel}</span>
            <select
              class="dr-panel px-2 py-1"
              value={themeValue() ?? "system"}
              onChange={(event) => onTheme(event.currentTarget.value as Theme)}
            >
              <For each={THEME_OPTIONS}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
          </label>

          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={keepRaw() ?? true}
              onChange={(event) => onKeepRaw(event.currentTarget.checked)}
            />
            <span>{strings.options.keepRawLabel}</span>
          </label>

          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showIdentities() ?? false}
              onChange={(event) => onIdentities(event.currentTarget.checked)}
            />
            <span>{strings.options.realIdentitiesLabel}</span>
          </label>

          <label class="flex items-center justify-between gap-3">
            <span>Per-document cap (MB)</span>
            <input
              type="number"
              min={1}
              class="dr-panel w-28 px-2 py-1 text-right tabular-nums"
              value={Math.round((budget()?.perDocumentBytes ?? 0) / MIB)}
              onChange={(event) => onBudget("perDocumentBytes", Number(event.currentTarget.value))}
            />
          </label>

          <label class="flex items-center justify-between gap-3">
            <span>Global cap (MB)</span>
            <input
              type="number"
              min={1}
              class="dr-panel w-28 px-2 py-1 text-right tabular-nums"
              value={Math.round((budget()?.globalCapBytes ?? 0) / MIB)}
              onChange={(event) => onBudget("globalCapBytes", Number(event.currentTarget.value))}
            />
          </label>
        </section>

        <CacheControls store={store} docId={docId} />
        <DiagnosticsPreferences />
      </main>
    </div>
  );
};

export default OptionsApp;
