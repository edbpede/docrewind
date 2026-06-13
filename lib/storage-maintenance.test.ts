// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "./db.memory";
import { asDocId, asRevisionId } from "./domain/ids";
import type { DecodedRevision, RawPayload } from "./domain/model";
import {
  applyPostDecodeStoragePolicy,
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

function decoded(): DecodedRevision {
  return {
    revisionId: asRevisionId(1),
    userId: null,
    sessionId: null,
    time: null,
    operations: [],
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
    await store.saveDecoded(docId, [decoded()]);

    await applyPostDecodeStoragePolicy(store, docId, {
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      now: 456,
    });

    expect(await store.getRawChunks(docId)).toEqual([]);
    expect(await store.getDecoded(docId)).toHaveLength(1);
    expect((await store.getCacheMeta(docId))?.rawRetained).toBe(false);
    expect((await store.getCacheMeta(docId))?.reconstructionStatus).toBe("complete");
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
