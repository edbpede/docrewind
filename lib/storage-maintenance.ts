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
  readonly status: "completed" | "deferred" | "failed";
  readonly reclaimedBytes: number;
}

export type DestructiveStorageRequest =
  | { readonly kind: "document"; readonly docId: DocId }
  | { readonly kind: "all" };

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
    // Global options requests are durable retry intents, not proof that every
    // document has a reconstructable replay publication. Keep them content-free
    // and idempotent; successful per-document replay terminal paths perform the
    // actual raw pruning once reconstruction is complete. For existing completed
    // documents, the store-level all-doc helpers skip incomplete cache metadata.
    return request.keepRawData
      ? enforceStorageBudgetForAll(store, request.budget)
      : enforceStorageBudgetForAll(store, { ...request.budget, perDocumentBytes: 0 });
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

  const canDiscardRaw = (await store.getActiveReplayPublication(request.docId)) !== null;

  if (canDiscardRaw) {
    reclaimed += request.keepRawData
      ? await enforceStorageBudget(store, request.docId, request.budget)
      : await store.deleteRawForDoc(request.docId);
  }

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
  const pendingDestructive = new Map<string, DestructiveStorageRequest>();

  const requestKey = (request: StorageMaintenanceRequest): string => request.docId ?? "*";
  const destructiveKey = (request: DestructiveStorageRequest): string =>
    request.kind === "all" ? "*" : request.docId;
  const isScopeBlocked = (docId: DocId | null): boolean =>
    docId === null ? activeLeaseCounts.size > 0 : (activeLeaseCounts.get(docId) ?? 0) > 0;
  const isBlocked = (request: StorageMaintenanceRequest): boolean => isScopeBlocked(request.docId);

  async function runDestructiveStorage(request: DestructiveStorageRequest): Promise<void> {
    if (request.kind === "all") {
      await store.deleteAll();
      return;
    }
    await store.deleteDocument(request.docId);
  }

  async function drainPending(): Promise<StorageMaintenanceResult> {
    let reclaimedBytes = 0;
    let failed = false;

    for (const [key, request] of [...pendingDestructive.entries()]) {
      const blockedScope = request.kind === "all" ? null : request.docId;
      if (isScopeBlocked(blockedScope)) {
        continue;
      }
      try {
        await runDestructiveStorage(request);
        pendingDestructive.delete(key);
      } catch {
        failed = true;
      }
    }

    for (const [key, request] of [...pending.entries()]) {
      if (isBlocked(request)) {
        continue;
      }
      try {
        reclaimedBytes += await runStorageMaintenance(store, request);
        pending.delete(key);
      } catch {
        failed = true;
      }
    }

    if (failed) {
      return { status: "failed", reclaimedBytes };
    }
    if (pending.size > 0 || pendingDestructive.size > 0) {
      return { status: "deferred", reclaimedBytes };
    }
    return { status: "completed", reclaimedBytes };
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
      return drainPending();
    },

    async request(request: StorageMaintenanceRequest): Promise<StorageMaintenanceResult> {
      if (isBlocked(request)) {
        pending.set(requestKey(request), request);
        return { status: "deferred", reclaimedBytes: 0 };
      }
      try {
        const reclaimedBytes = await runStorageMaintenance(store, request);
        return { status: "completed", reclaimedBytes };
      } catch {
        return { status: "failed", reclaimedBytes: 0 };
      }
    },

    async requestDestructiveClear(
      request: DestructiveStorageRequest,
    ): Promise<StorageMaintenanceResult> {
      const blockedScope = request.kind === "all" ? null : request.docId;
      if (isScopeBlocked(blockedScope)) {
        pendingDestructive.set(destructiveKey(request), request);
        return { status: "deferred", reclaimedBytes: 0 };
      }
      try {
        await runDestructiveStorage(request);
        return { status: "completed", reclaimedBytes: 0 };
      } catch {
        return { status: "failed", reclaimedBytes: 0 };
      }
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
