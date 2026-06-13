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
  const refreshOptions =
    options.now === undefined
      ? { reconstructionStatus: "complete" as const }
      : { now: options.now, reconstructionStatus: "complete" as const };
  await refreshCacheMeta(store, docId, refreshOptions);

  if (!options.keepRawData) {
    await store.deleteRawForDoc(docId);
  } else {
    await enforceStorageBudget(store, docId, options.budget);
  }

  await refreshCacheMeta(store, docId, refreshOptions);
}
