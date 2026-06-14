// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "./db.memory";
import { PARSER_VERSION } from "./decoder/version";
import { asDocId, asRevisionId } from "./domain/ids";
import type { DocId, RawPayload } from "./domain/model";
import { createModel } from "./reconstruction/model";
import {
  applyPostDecodeStoragePolicy,
  createStorageMaintenanceCoordinator,
  enforceStorageBudget,
  enforceStorageBudgetForAll,
  refreshCacheMeta,
} from "./storage-maintenance";
import type { RevisionStore } from "./store";

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

async function saveActivePublication(
  store: RevisionStore,
  docId: DocId,
  publicationId = "pub-maint",
): Promise<void> {
  await store.saveReplayPublication(docId, {
    publicationId,
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
    snapshots: [{ appliedCount: 0, model: createModel() }],
    timeline: [],
    publishedAt: 456,
  });
  await store.setActiveReplayPublication(docId, publicationId);
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

  it("applies keepRawData=false only after an active publication exists", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));
    await saveActivePublication(store, docId, "pub-maint");

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
    await saveActivePublication(store, docId);

    coordinator.beginDecodeLease(docId);
    const deferred = await coordinator.request({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
    });

    expect(deferred.status).toBe("deferred");
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
    await saveActivePublication(store, rawDocId);

    coordinator.beginDecodeLease(rawDocId);
    await coordinator.request({
      docId: rawDocId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
    });
    await coordinator.request({
      docId: rawDocId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
    });
    await coordinator.endDecodeLease(rawDocId);

    expect(deleteCalls).toBe(1);
    expect(await store.getRawChunks(rawDocId)).toEqual([]);
  });

  it("does not discard raw data for partial reconstruction maintenance", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));
    await saveActivePublication(store, docId, "older-active-publication");

    const coordinator = createStorageMaintenanceCoordinator(store);
    const ack = await coordinator.request({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "partial",
    });

    expect(ack.status).toBe("completed");
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect((await store.getCacheMeta(docId))?.reconstructionStatus).toBe("partial");
  });

  it("does not discard raw when cache metadata is complete but the active pointer is missing", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));
    await refreshCacheMeta(store, docId, { now: 1, reconstructionStatus: "complete" });

    const reclaimed = await enforceStorageBudget(store, docId, {
      perDocumentBytes: 0,
      globalCapBytes: 0,
    });

    expect(reclaimed).toBe(0);
    expect(await store.getRawChunks(docId)).toHaveLength(1);
  });

  it("does not discard raw when the active pointer is dangling", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));
    await store.setActiveReplayPublication(docId, "missing-publication");

    const reclaimed = await enforceStorageBudget(store, docId, {
      perDocumentBytes: 0,
      globalCapBytes: 0,
    });

    expect(reclaimed).toBe(0);
    expect(await store.getRawChunks(docId)).toHaveLength(1);
  });

  it("global maintenance prunes only documents already marked complete", async () => {
    const store = createMemoryStore();
    const completeDoc = asDocId("completeMaintDoc");
    const partialDoc = asDocId("partialMaintDoc");
    await store.saveRawChunk({ ...raw("complete"), docId: completeDoc });
    await store.saveRawChunk({ ...raw("partial"), docId: partialDoc });
    await saveActivePublication(store, completeDoc);
    await saveActivePublication(store, partialDoc, "older-partial-active-publication");
    await refreshCacheMeta(store, completeDoc, { now: 1, reconstructionStatus: "complete" });
    await refreshCacheMeta(store, partialDoc, { now: 2, reconstructionStatus: "partial" });

    const reclaimed = await enforceStorageBudgetForAll(store, {
      perDocumentBytes: 0,
      globalCapBytes: 0,
    });

    expect(reclaimed).toBeGreaterThan(0);
    expect(await store.getRawChunks(completeDoc)).toEqual([]);
    expect(await store.getRawChunks(partialDoc)).toHaveLength(1);
  });

  it("defers destructive document clear until the scoped lease is safe", async () => {
    const store = createMemoryStore();
    const coordinator = createStorageMaintenanceCoordinator(store);
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("body"));

    coordinator.beginDecodeLease(docId);
    const deferred = await coordinator.requestDestructiveClear({ kind: "document", docId });

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(docId)).toHaveLength(1);

    const released = await coordinator.endDecodeLease(docId);

    expect(released.status).toBe("completed");
    expect(await store.getRawChunks(docId)).toEqual([]);
  });

  it("enforces per-document raw budget on the normal maintenance path", async () => {
    const store = createMemoryStore();
    const docId = asDocId("maintDoc");
    await store.saveRawChunk(raw("x".repeat(100)));
    await saveActivePublication(store, docId);
    await refreshCacheMeta(store, docId, { now: 1, reconstructionStatus: "complete" });

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
    await saveActivePublication(store, docId, "pub-maint-a");
    await saveActivePublication(store, otherDoc, "pub-maint-b");
    await refreshCacheMeta(store, docId, { now: 1, reconstructionStatus: "complete" });
    await refreshCacheMeta(store, otherDoc, { now: 2, reconstructionStatus: "complete" });

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
