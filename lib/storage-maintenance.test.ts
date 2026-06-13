// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from "vitest";
import { PARSER_VERSION } from "./decoder/version";
import { createMemoryStore } from "./db.memory";
import { asDocId, asRevisionId } from "./domain/ids";
import type { RawPayload } from "./domain/model";
import {
  applyPostDecodeStoragePolicy,
  createStorageMaintenanceCoordinator,
  enforceStorageBudget,
  enforceStorageBudgetForAll,
  refreshCacheMeta,
} from "./storage-maintenance";

function raw(body: unknown): RawPayload {
  const docId = asDocId("maintDoc");
  return {
    docId,
    range: {
      requested: { start: asRevisionId(1), end: asRevisionId(1) },
      received: { start: asRevisionId(1), end: asRevisionId(1) },
    },
    receivedAt: 0,
    body,
  };
}

describe("storage maintenance", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 0, quota: 0 }),
        persist: async () => true,
      },
    });
  });

  it("refreshes cache metadata from retained raw bytes", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));

    const meta = await refreshCacheMeta(store, docId, {
      now: 123,
      reconstructionStatus: "partial",
    });

    expect(meta.lastAccessedAt).toBe(123);
    expect(meta.estimatedBytes).toBeGreaterThan(0);
    expect(meta.rawRetained).toBe(true);
    expect(meta.reconstructionStatus).toBe("partial");
  });

  it("applies keepRawData=false only after decode data exists, preserving derived data", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));
    await store.saveReplayPublication(docId, {
      publicationId: "pub-maint",
      parserVersion: PARSER_VERSION,
      revisions: [
        {
          revisionId: asRevisionId(1),
          userId: null,
          sessionId: null,
          time: null,
          operations: [],
        },
      ],
      snapshots: [],
      timeline: [],
      publishedAt: 456,
    });

    await applyPostDecodeStoragePolicy(store, docId, {
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      now: 456,
    });

    expect(await store.getRawChunks(docId)).toEqual([]);
    expect(await store.getReplayPublication(docId, "pub-maint")).not.toBeNull();
    expect((await store.getCacheMeta(docId))?.rawRetained).toBe(false);
    expect((await store.getCacheMeta(docId))?.reconstructionStatus).toBe("complete");
  });

  it("defers keepRaw=false cleanup while a decode lease is active", async () => {
    const store = createMemoryStore();
    const coordinator = createStorageMaintenanceCoordinator(store);
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));

    coordinator.beginDecodeLease(docId);
    const deferred = await coordinator.request({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
    });

    expect(deferred.deferred).toBe(true);
    expect(await store.getRawChunks(docId)).toHaveLength(1);

    const released = await coordinator.endDecodeLease(docId);

    expect(released.reclaimedBytes).toBeGreaterThan(0);
    expect(await store.getRawChunks(docId)).toEqual([]);
  });

  it("coalesces repeated deferred maintenance requests until the lease is safe", async () => {
    const base = createMemoryStore();
    const rawDocId = asDocId("maintDoc");
    let deleteCalls = 0;
    const store = {
      ...base,
      deleteRawForDoc: async (docId: typeof rawDocId): Promise<number> => {
        deleteCalls += 1;
        return base.deleteRawForDoc(docId);
      },
    };
    const coordinator = createStorageMaintenanceCoordinator(store);
    await store.saveRawChunk(raw("body"));

    coordinator.beginDecodeLease(rawDocId);
    await coordinator.request({
      docId: rawDocId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
    });
    await coordinator.request({
      docId: rawDocId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
    });
    await coordinator.endDecodeLease(rawDocId);

    expect(deleteCalls).toBe(1);
    expect(await store.getRawChunks(rawDocId)).toEqual([]);
  });

  it("enforces per-document raw budget on the normal maintenance path", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("x".repeat(100)));
    await refreshCacheMeta(store, docId, { now: 1 });

    const retained = await store.estimateRawBytes(docId);
    const reclaimed = await enforceStorageBudget(store, docId, {
      perDocumentBytes: retained - 1,
      globalCapBytes: Number.MAX_SAFE_INTEGER,
    });

    expect(reclaimed).toBeGreaterThan(0);
    expect(await store.getRawChunks(docId)).toEqual([]);
  });

  it("enforces per-document raw budgets across all documents without an active doc scope", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    const otherDoc = asDocId("otherMaintDoc");
    await store.saveRawChunk(raw("x".repeat(100)));
    await store.saveRawChunk({
      ...raw("y".repeat(100)),
      docId: otherDoc,
    });
    await refreshCacheMeta(store, docId, { now: 1 });
    await refreshCacheMeta(store, otherDoc, { now: 2 });

    const retained = await store.estimateRawBytes(docId);
    const reclaimed = await enforceStorageBudgetForAll(store, {
      perDocumentBytes: retained - 1,
      globalCapBytes: Number.MAX_SAFE_INTEGER,
    });

    expect(reclaimed).toBeGreaterThan(0);
    expect(await store.getRawChunks(docId)).toEqual([]);
    expect(await store.getRawChunks(otherDoc)).toEqual([]);
  });
});
