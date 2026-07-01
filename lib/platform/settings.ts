// SPDX-License-Identifier: AGPL-3.0-or-later
//
// User settings (plan §1.1 / PRD §9.7, §9.8, §11.1). Settings ONLY — never bulk
// data, never `localStorage`. Each item is an area-prefixed `storage.defineItem`
// over `browser.storage.local` with an explicit, concrete fallback (no bare
// optionals: the repo runs `exactOptionalPropertyTypes`, so every field carries a
// real default). Bulk/queryable data lives in IndexedDB (lib/platform/db.ts), not here.

import { storage } from "#imports";
import type { CacheRecord, DocId } from "@/lib/core/domain/model";
import type { IdentityMap } from "@/lib/core/identity/resolve";

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
export type PendingDestructiveStorageClearIdentity =
  | Pick<PendingDocumentStorageClear, "id" | "kind" | "docId" | "queuedAt">
  | Pick<PendingAllStorageClear, "id" | "kind" | "queuedAt">;

const MIB = 1024 * 1024;
export const STORAGE_LEASE_TTL_MS = 10 * 60 * 1000;
export const STORAGE_LEASE_REFRESH_MS = 60 * 1000;

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

/**
 * Whether to surface real account identities vs. opaque "Author N" labels (PRD §9.7).
 * Default ON: the names are data the viewer is already authorized to see (Docs' own
 * version history shows them) and resolution is same-origin and on-device. The opt-OUT
 * switch lets a privacy-conscious user fall back to opaque labels (and clears the cache).
 */
export const realIdentities = storage.defineItem<boolean>("local:realIdentities", {
  fallback: true,
});

/**
 * Cache of resolved author identities, keyed by the opaque author token (Gaia id).
 * SESSION-scoped (`storage.session`) on purpose: it is held in memory only, never
 * written to disk, and auto-cleared when the browsing session ends — so resolved
 * names are as transient as the live Docs UI. Populated from the version-history
 * `userMap` (background) and, as a best-effort bonus, the signed-in account label
 * (content script). Empty when `realIdentities` is off (resolution is skipped).
 */
export const resolvedIdentities = storage.defineItem<IdentityMap>("session:resolvedIdentities", {
  fallback: {},
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

/**
 * Content-free, durable lease marker for raw-cache maintenance safety. This is
 * intentionally scoped to doc ids + counts only; it never stores raw content or
 * reconstructed text. The in-memory coordinator is still the fast path, but this
 * survives MV3 service-worker restarts so startup retry drains cannot prune raw
 * chunks while a replay page is still decoding.
 */
export interface ActiveStorageLease {
  readonly id: string;
  readonly docId: DocId;
  readonly count: number;
  readonly updatedAt: number;
}

export const activeStorageLeases = storage.defineItem<readonly ActiveStorageLease[]>(
  "local:activeStorageLeases",
  { fallback: [] },
);

/**
 * Cold-start work marker (background wake cost). MV3 re-executes the whole
 * background body on EVERY wake, so the wake path must learn from ONE cheap read
 * whether any startup work exists at all. This marker carries the one-shot
 * legacy on-disk `resolvedIdentities` cleanup flag; the durable-intent drain
 * hint is tracked SEPARATELY by the {@link durableIntentsEnqueueSeq} /
 * {@link durableIntentsDrainedSeq} generation counters (see there). Both are
 * batched into a SINGLE `storage.getItems` read at wake (see
 * {@link readBackgroundStartupState}), so the steady-state wake still pays one
 * round-trip, never a storage write plus two queue reads to service a trivial
 * `getCheckpoint`.
 *
 * The `legacyIdentityKeyCleared` fallback is `false`, so a user upgrading from a
 * build without the marker still gets the one-time cleanup.
 */
export interface BackgroundStartupMarker {
  readonly legacyIdentityKeyCleared: boolean;
}

export const backgroundStartupMarker = storage.defineItem<BackgroundStartupMarker>(
  "local:backgroundStartupMarker",
  { fallback: { legacyIdentityKeyCleared: false } },
);

/**
 * Durable-intent drain hint, held as a pair of monotonic generation counters in
 * TWO separate single-purpose keys. Pending ⟺ `enqueueSeq !== drainedSeq`.
 *
 *  • `durableIntentsEnqueueSeq` — bumped by the queue upserts below, strictly
 *    AFTER their durable-queue write lands (see {@link bumpDurableIntentsEnqueueSeq}).
 *  • `durableIntentsDrainedSeq` — advanced ONLY by the background drain, to the
 *    enqueueSeq value it observed AT DRAIN START, and ONLY on a full drain.
 *
 * Why two keys and not one boolean blob: the drain and enqueue paths must never
 * read-modify-write a SHARED value, or a drain's stale snapshot could clobber a
 * concurrent enqueue's raise (the bug this scheme replaces). Each key has ONE
 * writer role — enqueue only ever increments enqueueSeq; drain only ever sets
 * drainedSeq to a value it captured BEFORE processing anything, never a re-read.
 * So the two interleave without a lost signal:
 *
 *  • A concurrent enqueue during a drain bumps enqueueSeq past the drain's start
 *    snapshot, so after the drain sets drainedSeq to that snapshot the two stay
 *    unequal → the next wake re-drains. The drain's write cannot catch up to the
 *    enqueue because it commits an OLD (pre-processing) value.
 *  • An MV3 kill anywhere before the drain's single terminal drainedSeq write
 *    leaves drainedSeq stale (still < enqueueSeq) → pending stays true → the next
 *    wake re-drains. The crash always leaves the hint in the SAFE direction.
 *  • enqueueSeq only ever rises, so even a lost cross-realm increment is safe: a
 *    queue entry the drain didn't see was enqueued after the drain's snapshot, so
 *    its bump still left enqueueSeq strictly above that snapshot.
 *
 * The fallbacks are unequal (1 ≠ 0), so a fresh or upgrading user drains once on
 * first wake, mirroring the old work-pending default.
 */
export const durableIntentsEnqueueSeq = storage.defineItem<number>(
  "local:durableIntentsEnqueueSeq",
  { fallback: 1 },
);

export const durableIntentsDrainedSeq = storage.defineItem<number>(
  "local:durableIntentsDrainedSeq",
  { fallback: 0 },
);

export async function readBackgroundStartupMarker(): Promise<BackgroundStartupMarker> {
  return backgroundStartupMarker.getValue();
}

/** Combined cold-start / wake state, fetched in ONE `storage.local` round-trip. */
export interface BackgroundStartupState {
  readonly legacyIdentityKeyCleared: boolean;
  readonly enqueueSeq: number;
  readonly drainedSeq: number;
}

export async function readBackgroundStartupState(): Promise<BackgroundStartupState> {
  const results = await storage.getItems([
    backgroundStartupMarker,
    durableIntentsEnqueueSeq,
    durableIntentsDrainedSeq,
  ]);
  const marker = results[0]?.value as BackgroundStartupMarker | undefined;
  const enqueueSeq = results[1]?.value as number | undefined;
  const drainedSeq = results[2]?.value as number | undefined;
  // Fall back to the item defaults if a result is somehow absent — these mirror
  // the `defineItem` fallbacks, keeping pending TRUE (1 ≠ 0) when unset.
  return {
    legacyIdentityKeyCleared: marker?.legacyIdentityKeyCleared ?? false,
    enqueueSeq: enqueueSeq ?? 1,
    drainedSeq: drainedSeq ?? 0,
  };
}

// Serialize backgroundStartupMarker read-modify-writes through one queue so the
// one-shot legacy-cleanup mark can't race a concurrent RMW of the blob. (The
// durable-intent counters use their own single-writer keys, below.)
let backgroundStartupMarkerMutationQueue: Promise<void> = Promise.resolve();

function enqueueBackgroundStartupMarkerMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = backgroundStartupMarkerMutationQueue.then(mutation, mutation);
  backgroundStartupMarkerMutationQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function patchBackgroundStartupMarker(
  patch: Partial<BackgroundStartupMarker>,
): Promise<void> {
  await enqueueBackgroundStartupMarkerMutation(async () => {
    const current = await backgroundStartupMarker.getValue();
    const next = { ...current, ...patch };
    if (next.legacyIdentityKeyCleared !== current.legacyIdentityKeyCleared) {
      await backgroundStartupMarker.setValue(next);
    }
  });
}

/** Record that the one-shot legacy `resolvedIdentities` on-disk cleanup ran. */
export async function markLegacyIdentityKeyCleared(): Promise<void> {
  await patchBackgroundStartupMarker({ legacyIdentityKeyCleared: true });
}

// Serialize the enqueueSeq read-modify-write within a realm so two same-realm
// upserts (a maintenance and a destructive clear can be in flight at once) never
// lose a bump. Cross-realm bumps are NOT serialized, but a lost cross-realm
// increment is still safe — see the safety argument on {@link durableIntentsEnqueueSeq}.
let enqueueSeqMutationQueue: Promise<void> = Promise.resolve();

function enqueueEnqueueSeqMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = enqueueSeqMutationQueue.then(mutation, mutation);
  enqueueSeqMutationQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * Bump the enqueue generation. Called by the queue upserts below AFTER their
 * durable-queue write lands — the ordering that keeps the drain hint safe (see
 * {@link durableIntentsEnqueueSeq}).
 */
export async function bumpDurableIntentsEnqueueSeq(): Promise<void> {
  await enqueueEnqueueSeqMutation(async () => {
    const current = await durableIntentsEnqueueSeq.getValue();
    await durableIntentsEnqueueSeq.setValue(current + 1);
  });
}

/** The enqueue generation, captured by the drain as its `seqAtStart`. */
export async function getDurableIntentsEnqueueSeq(): Promise<number> {
  return durableIntentsEnqueueSeq.getValue();
}

/**
 * Advance the drained generation to the value {@link getDurableIntentsEnqueueSeq}
 * returned at drain start. The drain's SINGLE terminal write, made only on a full
 * drain; a kill before it leaves the hint pending (see {@link durableIntentsEnqueueSeq}).
 */
export async function advanceDurableIntentsDrainedSeq(seq: number): Promise<void> {
  await durableIntentsDrainedSeq.setValue(seq);
}

let storageLeaseMutationQueue: Promise<void> = Promise.resolve();
let pendingStorageMaintenanceMutationQueue: Promise<void> = Promise.resolve();
let pendingDestructiveStorageClearMutationQueue: Promise<void> = Promise.resolve();

function enqueueStorageLeaseMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = storageLeaseMutationQueue.then(mutation, mutation);
  storageLeaseMutationQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function enqueuePendingStorageMaintenanceMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = pendingStorageMaintenanceMutationQueue.then(mutation, mutation);
  pendingStorageMaintenanceMutationQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function enqueuePendingDestructiveStorageClearMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = pendingDestructiveStorageClearMutationQueue.then(mutation, mutation);
  pendingDestructiveStorageClearMutationQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function storageLeaseId(docId: DocId): string {
  return `storage-lease:${docId}`;
}

function isFreshLease(lease: ActiveStorageLease, now: number): boolean {
  return lease.updatedAt > now - STORAGE_LEASE_TTL_MS;
}

async function getFreshStorageLeases(now = Date.now()): Promise<readonly ActiveStorageLease[]> {
  const current = await activeStorageLeases.getValue();
  const fresh = current.filter((lease) => lease.count > 0 && isFreshLease(lease, now));
  if (fresh.length !== current.length) {
    await activeStorageLeases.setValue(fresh);
  }
  return fresh;
}

export async function beginStorageLease(docId: DocId, now = Date.now()): Promise<void> {
  await enqueueStorageLeaseMutation(async () => {
    const id = storageLeaseId(docId);
    const current = await getFreshStorageLeases(now);
    const existing = current.find((lease) => lease.id === id);
    const next: ActiveStorageLease = {
      id,
      docId,
      count: (existing?.count ?? 0) + 1,
      updatedAt: now,
    };
    await activeStorageLeases.setValue([...current.filter((lease) => lease.id !== id), next]);
  });
}

export async function endStorageLease(docId: DocId, now = Date.now()): Promise<void> {
  await enqueueStorageLeaseMutation(async () => {
    const id = storageLeaseId(docId);
    const current = await getFreshStorageLeases(now);
    const existing = current.find((lease) => lease.id === id);
    if (existing === undefined) {
      return;
    }
    const remaining = existing.count - 1;
    await activeStorageLeases.setValue(
      remaining > 0
        ? [
            ...current.filter((lease) => lease.id !== id),
            { ...existing, count: remaining, updatedAt: now },
          ]
        : current.filter((lease) => lease.id !== id),
    );
  });
}

export async function refreshStorageLease(docId: DocId, now = Date.now()): Promise<void> {
  await enqueueStorageLeaseMutation(async () => {
    const id = storageLeaseId(docId);
    const current = await getFreshStorageLeases(now);
    const existing = current.find((lease) => lease.id === id);
    if (existing === undefined) {
      return;
    }
    await activeStorageLeases.setValue([
      ...current.filter((lease) => lease.id !== id),
      { ...existing, updatedAt: now },
    ]);
  });
}

export async function hasActiveStorageLease(
  docId: DocId | null,
  now = Date.now(),
): Promise<boolean> {
  const current = await getFreshStorageLeases(now);
  return docId === null ? current.length > 0 : current.some((lease) => lease.docId === docId);
}

function pendingMaintenanceId(input: PendingStorageMaintenanceInput): string {
  const scope = input.docId ?? "*";
  const status = input.reconstructionStatus ?? "policy";
  const rawPolicy = input.keepRawData ? "keep-raw" : "discard-raw";
  const perDoc = Math.max(0, Math.floor(input.budget.perDocumentBytes));
  const global = Math.max(0, Math.floor(input.budget.globalCapBytes));
  return `storage-maintenance:${scope}:${status}:${rawPolicy}:${perDoc}:${global}`;
}

function pendingMaintenanceScopeKey(
  request: Pick<PendingStorageMaintenanceRequest, "docId">,
): string {
  return request.docId ?? "*";
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

export async function isCurrentPendingStorageMaintenance(
  request: Pick<PendingStorageMaintenanceRequest, "docId" | "id" | "queuedAt">,
): Promise<boolean> {
  return enqueuePendingStorageMaintenanceMutation(async () => {
    const scope = pendingMaintenanceScopeKey(request);
    const current = await pendingStorageMaintenance.getValue();
    return current.some(
      (item) =>
        pendingMaintenanceScopeKey(item) === scope &&
        item.id === request.id &&
        item.queuedAt === request.queuedAt,
    );
  });
}

export async function runIfCurrentPendingStorageMaintenance<T>(
  request: Pick<PendingStorageMaintenanceRequest, "docId" | "id" | "queuedAt">,
  operation: () => Promise<T>,
): Promise<{ readonly current: true; readonly value: T } | { readonly current: false }> {
  return enqueuePendingStorageMaintenanceMutation(async () => {
    const scope = pendingMaintenanceScopeKey(request);
    const current = await pendingStorageMaintenance.getValue();
    const isCurrent = current.some(
      (item) =>
        pendingMaintenanceScopeKey(item) === scope &&
        item.id === request.id &&
        item.queuedAt === request.queuedAt,
    );
    if (!isCurrent) {
      return { current: false };
    }
    return { current: true, value: await operation() };
  });
}

export async function upsertPendingStorageMaintenance(
  request: PendingStorageMaintenanceRequest,
): Promise<void> {
  await enqueuePendingStorageMaintenanceMutation(async () => {
    const scope = pendingMaintenanceScopeKey(request);
    const current = await pendingStorageMaintenance.getValue();
    await pendingStorageMaintenance.setValue([
      ...current.filter((item) => pendingMaintenanceScopeKey(item) !== scope),
      request,
    ]);
    // Bump the enqueue generation strictly AFTER the queue write — the ordering
    // that keeps the drain hint safe (see durableIntentsEnqueueSeq).
    await bumpDurableIntentsEnqueueSeq();
  });
}

export async function removePendingStorageMaintenance(id: string, queuedAt: number): Promise<void> {
  await enqueuePendingStorageMaintenanceMutation(async () => {
    const current = await pendingStorageMaintenance.getValue();
    await pendingStorageMaintenance.setValue(
      current.filter((item) => item.id !== id || item.queuedAt !== queuedAt),
    );
  });
}

export async function removePendingStorageMaintenanceForScope(docId: DocId | null): Promise<void> {
  await enqueuePendingStorageMaintenanceMutation(async () => {
    const current = await pendingStorageMaintenance.getValue();
    await pendingStorageMaintenance.setValue(
      docId === null ? [] : current.filter((item) => pendingMaintenanceScopeKey(item) !== docId),
    );
  });
}

function destructiveClearId(input: PendingDestructiveStorageClearInput): string {
  return input.kind === "all" ? "destructive-clear:*" : `destructive-clear:document:${input.docId}`;
}

function sameDestructiveStorageClear(
  item: PendingDestructiveStorageClear,
  request: PendingDestructiveStorageClearIdentity,
): boolean {
  if (item.id !== request.id || item.queuedAt !== request.queuedAt || item.kind !== request.kind) {
    return false;
  }
  if (item.kind === "all") {
    return true;
  }
  return request.kind === "document" && item.docId === request.docId;
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

export async function isCurrentPendingDestructiveStorageClear(
  request: PendingDestructiveStorageClearIdentity,
): Promise<boolean> {
  return enqueuePendingDestructiveStorageClearMutation(async () => {
    const current = await pendingDestructiveStorageClears.getValue();
    return current.some((item) => sameDestructiveStorageClear(item, request));
  });
}

export async function runIfCurrentPendingDestructiveStorageClear<T>(
  request: PendingDestructiveStorageClearIdentity,
  operation: () => Promise<T>,
): Promise<{ readonly current: true; readonly value: T } | { readonly current: false }> {
  return enqueuePendingDestructiveStorageClearMutation(async () => {
    const current = await pendingDestructiveStorageClears.getValue();
    const isCurrent = current.some((item) => sameDestructiveStorageClear(item, request));
    if (!isCurrent) {
      return { current: false };
    }
    return { current: true, value: await operation() };
  });
}

export async function upsertPendingDestructiveStorageClear(
  request: PendingDestructiveStorageClear,
): Promise<void> {
  await enqueuePendingDestructiveStorageClearMutation(async () => {
    const current = await pendingDestructiveStorageClears.getValue();
    await pendingDestructiveStorageClears.setValue([
      ...current.filter((item) => item.id !== request.id),
      request,
    ]);
    // Bump the enqueue generation strictly AFTER the queue write — the ordering
    // that keeps the drain hint safe (see durableIntentsEnqueueSeq).
    await bumpDurableIntentsEnqueueSeq();
  });
}

export async function removePendingDestructiveStorageClear(
  request: PendingDestructiveStorageClearIdentity,
): Promise<void> {
  await enqueuePendingDestructiveStorageClearMutation(async () => {
    const current = await pendingDestructiveStorageClears.getValue();
    await pendingDestructiveStorageClears.setValue(
      current.filter((item) => !sameDestructiveStorageClear(item, request)),
    );
  });
}
