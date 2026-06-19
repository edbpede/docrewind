// SPDX-License-Identifier: AGPL-3.0-or-later
//
// OptionsApp (plan Phase 5 Step 8). The settings + privacy surface. It mounts the
// SAME theme applier as the replay App (so changing the theme here restyles both
// pages live), parses an optional `?doc=` for per-document cache clearing, and
// wires every `lib/settings.ts` item through `createResource` (read) + `setValue`
// (write). Never displays raw document data.
//
// Visual register: iOS-Settings — a warm canvas, a reassuring privacy banner, then
// quiet group labels over grouped-row cards. Boolean settings are friendly switches
// (a native checkbox kept for a11y + tests, styled as a switch via `peer-checked:`);
// the theme is a segmented control; storage caps are unit-suffixed number fields.

import type { Component, JSX } from "solid-js";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import BrandMark from "@/components/BrandMark";
import CacheControls from "@/components/CacheControls";
import DiagnosticsPreferences from "@/components/DiagnosticsPreferences";
import { IconAlert, IconInfo } from "@/components/icons";
import PrivacySummary from "@/components/PrivacySummary";
import { useThemeSync } from "@/components/theme-sync";
import { createIdbStore } from "@/lib/db";
import { asDocId } from "@/lib/domain/ids";
import type { DocId } from "@/lib/domain/model";
import { strings } from "@/lib/i18n/strings";
import { sendMessage } from "@/lib/messaging";
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
  type Theme,
  theme,
  upsertPendingDestructiveStorageClear,
  upsertPendingStorageMaintenance,
} from "@/lib/settings";

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

/**
 * A grouped settings row carrying a boolean as a friendly switch. A real
 * `<input type="checkbox">` is kept (visually-hidden via `sr-only peer`) so the
 * label association, `checked` state, and the existing tests/e2e selectors stay
 * intact; the switch track + knob are painted with `peer-checked:` utilities. The
 * one-line help sits OUTSIDE the `<label>` so the input's accessible name remains
 * exactly the title text.
 */
const SwitchRow: Component<{
  readonly label: string;
  readonly help: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}> = (props) => {
  return (
    <div class="dr-row-stack">
      <label class="flex cursor-pointer items-center justify-between gap-4">
        <span class="dr-row-label">{props.label}</span>
        <span class="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            checked={props.checked}
            onChange={(event) => props.onChange(event.currentTarget.checked)}
          />
          <span
            class="block h-[1.6rem] w-[2.75rem] rounded-full bg-hairline-strong transition-colors duration-200 ease-[var(--dr-ease-out)] peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface"
            aria-hidden="true"
          />
          <span
            class="pointer-events-none absolute left-[0.2rem] size-[1.2rem] rounded-full bg-white shadow-[var(--dr-shadow-sm)] transition-transform duration-200 ease-[var(--dr-ease-out)] peer-checked:translate-x-[1.15rem]"
            aria-hidden="true"
          />
        </span>
      </label>
      <p class="dr-row-help">{props.help}</p>
    </div>
  );
};

/**
 * A grouped settings row carrying a byte budget as a unit-suffixed number field.
 * Keeps `type="number"` + `min` and the original label association (a `<label>`
 * wrapping the title + input) so `findByLabelText` and `.value` stay stable.
 */
const BudgetRow: Component<{
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly onInput: (mib: number) => void;
}> = (props) => {
  // Explicit `for`/`id` association (not a wrapping label) so the input's
  // accessible name is EXACTLY the title — the friendly "MB" suffix must not leak
  // into it (tests query `findByLabelText("Global cap (MB)")` etc.).
  return (
    <div class="dr-row">
      <label for={props.id} class="dr-row-label">
        {props.label}
      </label>
      <span class="dr-field">
        <input
          id={props.id}
          type="number"
          min={1}
          class="dr-field-input"
          value={props.value}
          onChange={(event) => props.onInput(Number(event.currentTarget.value))}
        />
        <span class="dr-field-suffix" aria-hidden="true">
          MB
        </span>
      </span>
    </div>
  );
};

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
  const [maintenanceStatus, setMaintenanceStatus] = createSignal<"pending" | "failed" | null>(null);

  onMount(() => {
    void refreshPendingStatus();
  });

  function onTheme(next: Theme): void {
    mutateTheme(next);
    void theme.setValue(next);
  }

  function onKeepRaw(next: boolean): void {
    mutateKeepRaw(next);
    void keepRawData.setValue(next);
    const currentBudget = budget();
    void (async () => {
      const resolvedBudget = currentBudget ?? (await storageBudget.getValue());
      await sendDurableMaintenance({
        docId,
        keepRawData: next,
        budget: resolvedBudget,
      });
    })().catch(() => setMaintenanceStatus("failed"));
  }

  function onIdentities(next: boolean): void {
    mutateIdentities(next);
    void realIdentities.setValue(next);
    // Opting out falls back to opaque labels: drop the resolved-name cache so the
    // privacy promise is instantaneous, not deferred to session end (lib/settings.ts).
    if (!next) {
      void resolvedIdentities.removeValue();
    }
  }

  function onBudget(field: "perDocumentBytes" | "globalCapBytes", mib: number): void {
    const current = budget();
    if (current === undefined || !Number.isFinite(mib) || mib <= 0) {
      return;
    }
    const next = { ...current, [field]: Math.round(mib * MIB) };
    mutateBudget(next);
    void storageBudget.setValue(next);
    void sendDurableMaintenance({
      docId,
      keepRawData: keepRaw() ?? true,
      budget: next,
    }).catch(() => setMaintenanceStatus("failed"));
  }

  async function sendDurableMaintenance(input: {
    readonly docId: DocId | null;
    readonly keepRawData: boolean;
    readonly budget: StorageBudget;
  }): Promise<void> {
    const request = createPendingStorageMaintenanceRequest(input);
    await upsertPendingStorageMaintenance(request);
    setMaintenanceStatus("pending");
    try {
      const ack = await sendMessage("requestStorageMaintenance", request);
      if (ack.status === "completed") {
        await removePendingStorageMaintenance(request.id, request.queuedAt);
        await refreshPendingStatus();
      } else {
        setMaintenanceStatus(ack.status === "failed" ? "failed" : "pending");
      }
    } catch {
      setMaintenanceStatus("failed");
    }
  }

  async function refreshPendingStatus(): Promise<void> {
    const [pendingMaintenance, pendingClears] = await Promise.all([
      getPendingStorageMaintenance(),
      getPendingDestructiveStorageClears(),
    ]);
    setMaintenanceStatus(
      pendingMaintenance.length > 0 || pendingClears.length > 0 ? "pending" : null,
    );
  }

  async function clearDocumentCache(targetDocId: DocId): Promise<void> {
    const request = createPendingDestructiveStorageClear({
      kind: "document",
      docId: targetDocId,
    });
    await upsertPendingDestructiveStorageClear(request);
    setMaintenanceStatus("pending");
    try {
      const ack = await sendMessage("clearDocumentCache", request);
      if (ack.status === "completed") {
        await removePendingDestructiveStorageClear(request);
        await refreshPendingStatus();
      } else {
        setMaintenanceStatus(ack.status === "failed" ? "failed" : "pending");
      }
    } catch {
      setMaintenanceStatus("failed");
    }
  }

  async function clearAllCaches(): Promise<void> {
    const request = createPendingDestructiveStorageClear({ kind: "all" });
    await upsertPendingDestructiveStorageClear(request);
    setMaintenanceStatus("pending");
    try {
      const ack = await sendMessage("clearAllCaches", request);
      if (ack.status === "completed") {
        await removePendingDestructiveStorageClear(request);
        await refreshPendingStatus();
      } else {
        setMaintenanceStatus(ack.status === "failed" ? "failed" : "pending");
      }
    } catch {
      setMaintenanceStatus("failed");
    }
  }

  return (
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
            <div class="dr-row">
              <span class="dr-row-label">{strings.options.themeLabel}</span>
              <fieldset class="seg m-0 border-0">
                <legend class="sr-only">{strings.options.themeLabel}</legend>
                <For each={THEME_OPTIONS}>
                  {(option) => (
                    <button
                      type="button"
                      class={
                        (themeValue() ?? "system") === option.value
                          ? "seg-item seg-item-active"
                          : "seg-item"
                      }
                      aria-pressed={(themeValue() ?? "system") === option.value}
                      onClick={() => onTheme(option.value)}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </fieldset>
            </div>
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
              checked={showIdentities() ?? true}
              onChange={onIdentities}
            />
            <SwitchRow
              label={strings.options.keepRawLabel}
              help={strings.options.keepRawHint}
              checked={keepRaw() ?? true}
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
              value={Math.round((budget()?.perDocumentBytes ?? 0) / MIB)}
              onInput={(mib) => onBudget("perDocumentBytes", mib)}
            />
            <BudgetRow
              id="dr-global-cap"
              label={strings.options.globalCapLabel}
              value={Math.round((budget()?.globalCapBytes ?? 0) / MIB)}
              onInput={(mib) => onBudget("globalCapBytes", mib)}
            />
          </div>

          <CacheControls
            store={store}
            docId={docId}
            onClearDocument={clearDocumentCache}
            onClearAll={clearAllCaches}
          />
        </section>

        <DiagnosticsPreferences />

        <Show when={maintenanceStatus()}>
          {(status) => <MaintenanceNote failed={status() === "failed"} />}
        </Show>
      </main>
    </div>
  );
};

const MaintenanceNote: Component<{ readonly failed: boolean }> = (props): JSX.Element => {
  return (
    <p class={props.failed ? "note-warning" : "note-info"} role="status">
      <Show when={props.failed} fallback={<IconInfo size={18} class="note-icon" />}>
        <IconAlert size={18} class="note-icon" />
      </Show>
      <span>
        {props.failed ? strings.options.maintenanceFailed : strings.options.maintenancePending}
      </span>
    </p>
  );
};

export default OptionsApp;
