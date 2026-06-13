// SPDX-License-Identifier: AGPL-3.0-or-later
//
// User settings (plan §1.1 / PRD §9.7, §9.8, §11.1). Settings ONLY — never bulk
// data, never `localStorage`. Each item is an area-prefixed `storage.defineItem`
// over `browser.storage.local` with an explicit, concrete fallback (no bare
// optionals: the repo runs `exactOptionalPropertyTypes`, so every field carries a
// real default). Bulk/queryable data lives in IndexedDB (lib/db.ts), not here.

import { storage } from "#imports";
import type { CacheRecord, DocId } from "./domain/model";

/** Visual theme preference. `system` follows the OS setting. */
export type Theme = "light" | "dark" | "system";

/**
 * Diagnostics verbosity (PRD §10.8). `default` records only what decoding needs;
 * `structural` additionally records length-only structural notes. Both stay
 * privacy-safe (never verbatim text). Phase 5 ships the setting toggle only —
 * diagnostic-report rendering is deferred to Phase 6.
 */
export type DiagnosticsMode = "default" | "structural";

/** Per-document and global byte budgets for the bulk cache (PRD §9.8). */
export interface StorageBudget {
  readonly perDocumentBytes: number;
  readonly globalCapBytes: number;
}

/** Durable, content-free retry item for background-owned raw-cache maintenance. */
export interface PendingStorageMaintenanceRequest {
  readonly id: string;
  readonly docId: DocId | null;
  readonly keepRawData: boolean;
  readonly budget: StorageBudget;
  readonly reconstructionStatus?: CacheRecord["reconstructionStatus"];
  readonly now?: number;
  readonly queuedAt: number;
}

export interface PendingStorageMaintenanceInput {
  readonly docId: DocId | null;
  readonly keepRawData: boolean;
  readonly budget: StorageBudget;
  readonly reconstructionStatus?: CacheRecord["reconstructionStatus"];
  readonly now?: number;
  readonly queuedAt?: number;
}

export type PendingDestructiveStorageClear =
  | {
      readonly id: string;
      readonly kind: "document";
      readonly docId: DocId;
      readonly queuedAt: number;
    }
  | {
      readonly id: string;
      readonly kind: "all";
      readonly queuedAt: number;
    };

export type PendingDestructiveStorageClearInput =
  | {
      readonly kind: "document";
      readonly docId: DocId;
      readonly queuedAt?: number;
    }
  | {
      readonly kind: "all";
      readonly queuedAt?: number;
    };

export type PendingDocumentStorageClear = Extract<
  PendingDestructiveStorageClear,
  { readonly kind: "document" }
>;
export type PendingAllStorageClear = Extract<
  PendingDestructiveStorageClear,
  { readonly kind: "all" }
>;
export type PendingDocumentStorageClearInput = Extract<
  PendingDestructiveStorageClearInput,
  { readonly kind: "document" }
>;
export type PendingAllStorageClearInput = Extract<
  PendingDestructiveStorageClearInput,
  { readonly kind: "all" }
>;

const MIB = 1024 * 1024;

/** Default cache budgets: ~50 MB per document, ~500 MB across all documents. */
export const DEFAULT_STORAGE_BUDGET: StorageBudget = {
  perDocumentBytes: 50 * MIB,
  globalCapBytes: 500 * MIB,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidByteCap(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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
        isRecord(old) && isValidByteCap(old.perDocumentBytes)
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

/** Diagnostics verbosity mode (PRD §10.8). Default records the minimum. */
export const diagnosticsMode = storage.defineItem<DiagnosticsMode>("local:diagnosticsMode", {
  fallback: "default",
});

/** Retryable maintenance intents that must survive MV3 service-worker restarts. */
export const pendingStorageMaintenance = storage.defineItem<
  readonly PendingStorageMaintenanceRequest[]
>("local:pendingStorageMaintenance", {
  fallback: [],
});

/** Retryable destructive clear intents, persisted before the UI sends them. */
export const pendingDestructiveStorageClears = storage.defineItem<
  readonly PendingDestructiveStorageClear[]
>("local:pendingDestructiveStorageClears", {
  fallback: [],
});

function pendingMaintenanceId(input: PendingStorageMaintenanceInput): string {
  const scope = input.docId ?? "*";
  const status = input.reconstructionStatus ?? "policy";
  const rawPolicy = input.keepRawData ? "keep-raw" : "discard-raw";
  const perDoc = Math.max(0, Math.floor(input.budget.perDocumentBytes));
  const global = Math.max(0, Math.floor(input.budget.globalCapBytes));
  return `storage-maintenance:${scope}:${status}:${rawPolicy}:${perDoc}:${global}`;
}

export function createPendingStorageMaintenanceRequest(
  input: PendingStorageMaintenanceInput,
): PendingStorageMaintenanceRequest {
  return {
    id: pendingMaintenanceId(input),
    docId: input.docId,
    keepRawData: input.keepRawData,
    budget: input.budget,
    ...(input.reconstructionStatus === undefined
      ? {}
      : { reconstructionStatus: input.reconstructionStatus }),
    ...(input.now === undefined ? {} : { now: input.now }),
    queuedAt: input.queuedAt ?? Date.now(),
  };
}

export async function getPendingStorageMaintenance(): Promise<
  readonly PendingStorageMaintenanceRequest[]
> {
  return pendingStorageMaintenance.getValue();
}

export async function upsertPendingStorageMaintenance(
  request: PendingStorageMaintenanceRequest,
): Promise<void> {
  const current = await pendingStorageMaintenance.getValue();
  await pendingStorageMaintenance.setValue([
    ...current.filter((item) => item.id !== request.id),
    request,
  ]);
}

export async function removePendingStorageMaintenance(id: string): Promise<void> {
  const current = await pendingStorageMaintenance.getValue();
  await pendingStorageMaintenance.setValue(current.filter((item) => item.id !== id));
}

function destructiveClearId(input: PendingDestructiveStorageClearInput): string {
  return input.kind === "all" ? "destructive-clear:*" : `destructive-clear:document:${input.docId}`;
}

export function createPendingDestructiveStorageClear(
  input: PendingDocumentStorageClearInput,
): PendingDocumentStorageClear;
export function createPendingDestructiveStorageClear(
  input: PendingAllStorageClearInput,
): PendingAllStorageClear;
export function createPendingDestructiveStorageClear(
  input: PendingDestructiveStorageClearInput,
): PendingDestructiveStorageClear {
  if (input.kind === "all") {
    return {
      id: destructiveClearId(input),
      kind: "all",
      queuedAt: input.queuedAt ?? Date.now(),
    };
  }
  return {
    id: destructiveClearId(input),
    kind: "document",
    docId: input.docId,
    queuedAt: input.queuedAt ?? Date.now(),
  };
}

export async function getPendingDestructiveStorageClears(): Promise<
  readonly PendingDestructiveStorageClear[]
> {
  return pendingDestructiveStorageClears.getValue();
}

export async function upsertPendingDestructiveStorageClear(
  request: PendingDestructiveStorageClear,
): Promise<void> {
  const current = await pendingDestructiveStorageClears.getValue();
  await pendingDestructiveStorageClears.setValue([
    ...current.filter((item) => item.id !== request.id),
    request,
  ]);
}

export async function removePendingDestructiveStorageClear(id: string): Promise<void> {
  const current = await pendingDestructiveStorageClears.getValue();
  await pendingDestructiveStorageClears.setValue(current.filter((item) => item.id !== id));
}
