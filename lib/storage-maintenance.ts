// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Raw-cache maintenance helpers. These stay outside the pure retrieval
// orchestrator: wrappers (background/replay/options) read user settings, then
// call these storage-only helpers to keep cache metadata fresh and enforce raw
// retention/budget policy after it is safe to mutate raw chunks.

import { PARSER_VERSION } from "./decoder/version";
import type { CacheRecord, DocId } from "./domain/model";
import type { StorageBudget } from "./settings";
import type { RevisionStore } from "./store";

export type ReconstructionStatus = CacheRecord["reconstructionStatus"];

export interface StorageMaintenanceRequest {
  readonly docId: DocId | null;
  readonly keepRawData: boolean;
  readonly budget: StorageBudget;
  readonly reconstructionStatus?: ReconstructionStatus;
  readonly now?: number;
}

export interface StorageMaintenanceResult {
  readonly deferred: boolean;
  readonly reclaimedBytes: number;
}

/** Refresh LRU/cache metadata using byte counts only; never reads raw content. */
export async function refreshCacheMeta(
  store: RevisionStore,
  docId: DocId,
  options: {
    readonly now?: number;
    readonly reconstructionStatus?: ReconstructionStatus;
  } = {},
): Promise<CacheRecord> {
  const now = options.now ?? Date.now();
  const [existing, estimatedBytes] = await Promise.all([
    store.getCacheMeta(docId),
    store.estimateRawBytes(docId),
  ]);
  const record: CacheRecord = {
    docId,
    createdAt: existing?.createdAt ?? now,
    lastAccessedAt: now,
    parserVersion: PARSER_VERSION,
    estimatedBytes,
    reconstructionStatus: options.reconstructionStatus ?? existing?.reconstructionStatus ?? "none",
    rawRetained: estimatedBytes > 0,
  };
  await store.putCacheMeta(record);
  return record;
}

/** Enforce configured raw storage caps for one active document plus global LRU. */
export async function enforceStorageBudget(
  store: RevisionStore,
  docId: DocId,
  budget: StorageBudget,
): Promise<number> {
  let reclaimed = 0;
  reclaimed += await store.pruneRawToCap(docId, budget.perDocumentBytes);
  reclaimed += await store.pruneLRU(budget.globalCapBytes);
  return reclaimed;
}

/** Enforce configured raw storage caps when no single active document is scoped. */
export async function enforceStorageBudgetForAll(
  store: RevisionStore,
  budget: StorageBudget,
): Promise<number> {
  let reclaimed = 0;
  reclaimed += await store.pruneRawToCapAll(budget.perDocumentBytes);
  reclaimed += await store.pruneLRU(budget.globalCapBytes);
  return reclaimed;
}

/** Execute one raw-cache maintenance request. Callers must already know it is safe. */
export async function runStorageMaintenance(
  store: RevisionStore,
  request: StorageMaintenanceRequest,
): Promise<number> {
  if (request.docId === null) {
    return request.keepRawData
      ? enforceStorageBudgetForAll(store, request.budget)
      : store.deleteRawAll();
  }

  let reclaimed = 0;
  const refreshOptions =
    request.reconstructionStatus === undefined && request.now === undefined
      ? undefined
      : {
          ...(request.now === undefined ? {} : { now: request.now }),
          ...(request.reconstructionStatus === undefined
            ? {}
            : { reconstructionStatus: request.reconstructionStatus }),
        };

  if (refreshOptions !== undefined) {
    await refreshCacheMeta(store, request.docId, refreshOptions);
  }

  reclaimed += request.keepRawData
    ? await enforceStorageBudget(store, request.docId, request.budget)
    : await store.deleteRawForDoc(request.docId);

  if (refreshOptions !== undefined) {
    await refreshCacheMeta(store, request.docId, refreshOptions);
  }

  return reclaimed;
}

/**
 * Best-effort in-memory raw-maintenance guard. In MV3 this state can disappear
 * when the service worker restarts, so requests are idempotent and replay
 * terminal paths may safely retry them. The guard's only hard rule while alive:
 * no raw deletion/pruning runs for a doc whose retrieval/decode lease is active.
 */
export function createStorageMaintenanceCoordinator(store: RevisionStore) {
  const activeLeaseCounts = new Map<string, number>();
  const pending = new Map<string, StorageMaintenanceRequest>();

  const requestKey = (request: StorageMaintenanceRequest): string => request.docId ?? "*";
  const isBlocked = (request: StorageMaintenanceRequest): boolean =>
    request.docId === null
      ? activeLeaseCounts.size > 0
      : (activeLeaseCounts.get(request.docId) ?? 0) > 0;

  async function drainPending(): Promise<number> {
    let reclaimedBytes = 0;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [key, request] of [...pending.entries()]) {
        if (isBlocked(request)) {
          continue;
        }
        pending.delete(key);
        reclaimedBytes += await runStorageMaintenance(store, request);
        progressed = true;
      }
    }
    return reclaimedBytes;
  }

  return {
    beginDecodeLease(docId: DocId): void {
      activeLeaseCounts.set(docId, (activeLeaseCounts.get(docId) ?? 0) + 1);
    },

    async endDecodeLease(docId: DocId): Promise<StorageMaintenanceResult> {
      const count = activeLeaseCounts.get(docId) ?? 0;
      if (count <= 1) {
        activeLeaseCounts.delete(docId);
      } else {
        activeLeaseCounts.set(docId, count - 1);
      }
      return { deferred: false, reclaimedBytes: await drainPending() };
    },

    async request(request: StorageMaintenanceRequest): Promise<StorageMaintenanceResult> {
      if (isBlocked(request)) {
        pending.set(requestKey(request), request);
        return { deferred: true, reclaimedBytes: 0 };
      }
      const reclaimedBytes = await runStorageMaintenance(store, request);
      return { deferred: false, reclaimedBytes };
    },
  };
}

/**
 * Post-decode retention policy. Call only after decode/load succeeds, because
 * replay decode consumes raw chunks after retrieval completion.
 */
export async function applyPostDecodeStoragePolicy(
  store: RevisionStore,
  docId: DocId,
  options: {
    readonly keepRawData: boolean;
    readonly budget: StorageBudget;
    readonly now?: number;
  },
): Promise<void> {
  await runStorageMaintenance(store, {
    docId,
    keepRawData: options.keepRawData,
    budget: options.budget,
    reconstructionStatus: "complete",
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
