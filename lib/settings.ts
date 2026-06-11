// SPDX-License-Identifier: AGPL-3.0-or-later
//
// User settings (plan §1.1 / PRD §9.7, §9.8, §11.1). Settings ONLY — never bulk
// data, never `localStorage`. Each item is an area-prefixed `storage.defineItem`
// over `browser.storage.local` with an explicit, concrete fallback (no bare
// optionals: the repo runs `exactOptionalPropertyTypes`, so every field carries a
// real default). Bulk/queryable data lives in IndexedDB (lib/db.ts), not here.

import { storage } from "#imports";

/** Visual theme preference. `system` follows the OS setting. */
export type Theme = "light" | "dark" | "system";

/** Per-document and global byte budgets for the bulk cache (PRD §9.8). */
export interface StorageBudget {
  readonly perDocumentBytes: number;
  readonly globalCapBytes: number;
}

const MIB = 1024 * 1024;

/** Default cache budgets: ~50 MB per document, ~500 MB across all documents. */
export const DEFAULT_STORAGE_BUDGET: StorageBudget = {
  perDocumentBytes: 50 * MIB,
  globalCapBytes: 500 * MIB,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Versioned migrations for `storageBudget`. Keyed by the version migrated TO.
 * v1 builds stored only `perDocumentBytes`; v2 adds the global cap. Exported so
 * the migration path is directly unit-testable in addition to running through
 * WXT's storage layer on read.
 */
export const STORAGE_BUDGET_MIGRATIONS: Readonly<Record<number, (old: unknown) => StorageBudget>> =
  {
    2: (old: unknown): StorageBudget => {
      const perDocumentBytes =
        isRecord(old) && typeof old.perDocumentBytes === "number"
          ? old.perDocumentBytes
          : DEFAULT_STORAGE_BUDGET.perDocumentBytes;
      return { perDocumentBytes, globalCapBytes: DEFAULT_STORAGE_BUDGET.globalCapBytes };
    },
  };

/** Theme preference. */
export const theme = storage.defineItem<Theme>("local:theme", {
  fallback: "system",
});

/** Whether to retain raw chunks for re-decode (PRD §9.8). Default on. */
export const keepRawData = storage.defineItem<boolean>("local:keepRawData", {
  fallback: true,
});

/** Whether to surface real account identities vs. opaque ids (PRD §9.7). Default off. */
export const realIdentities = storage.defineItem<boolean>("local:realIdentities", {
  fallback: false,
});

/** Cache byte budgets, versioned so the shape can evolve without data loss. */
export const storageBudget = storage.defineItem<StorageBudget>("local:storageBudget", {
  fallback: DEFAULT_STORAGE_BUDGET,
  version: 2,
  migrations: STORAGE_BUDGET_MIGRATIONS,
});
