// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Background wiring test (plan §1.5, Vitest tier). Runs the real background setup
// (`defineBackground` returns `{ main }`) so the typed messaging handlers register
// against the fakeBrowser, then drives `startRetrieval` against a MOCKED `fetch`
// to prove the post-§24 LIVE plumbing end-to-end: bootstrap revision-count
// discovery → credentialed chunked `revisions/load` → checkpoint — and that an
// auth failure maps to the typed `insufficient-permission` error.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import background from "@/entrypoints/background";
import { PARSER_VERSION } from "@/lib/core/docs/decoder/version";
import { asDocId, asRevisionId } from "@/lib/core/domain/ids";
import type { RawPayload } from "@/lib/core/domain/model";
import { createIdbStore } from "@/lib/platform/db";
import { removeAllListeners, sendMessage } from "@/lib/platform/messaging";
import {
  beginStorageLease,
  createPendingDestructiveStorageClear,
  createPendingStorageMaintenanceRequest,
  getPendingDestructiveStorageClears,
  getPendingStorageMaintenance,
  upsertPendingDestructiveStorageClear,
  upsertPendingStorageMaintenance,
} from "@/lib/platform/settings";

function runBackground(): void {
  // defineBackground(fn) => { main: fn }.
  background.main?.();
}

/** A minimal Response-shaped stub (the adapter uses `ok`/`status`/`text()`). */
function res(
  status: number,
  body: string,
): { ok: boolean; status: number; text: () => Promise<string> } {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) };
}

/** A `)]}'`-framed changelog body (live tuple envelope), opaque to the orchestrator. */
const FRAMED_CHUNK = `)]}'\n${JSON.stringify({
  chunkedSnapshot: [],
  changelog: [
    [{ ty: "is", s: "Hi", ibi: 1 }, 1_700_000_000_000, "sess", 1, "user", 0, null, null, false],
  ],
})}`;

async function saveActivePublication(
  store: ReturnType<typeof createIdbStore>,
  docId: ReturnType<typeof asDocId>,
): Promise<void> {
  await store.saveReplayPublication(docId, {
    publicationId: "pub-active",
    parserVersion: PARSER_VERSION,
    revisions: [],
    snapshots: [],
    timeline: [],
    publishedAt: 1,
  });
  await store.setActiveReplayPublication(docId, "pub-active");
}

async function saveCompleteRawDocument(
  store: ReturnType<typeof createIdbStore>,
  docId: ReturnType<typeof asDocId>,
  body = "raw-body",
  lastAccessedAt = 1,
): Promise<void> {
  await store.saveRawChunk({
    docId,
    range: {
      requested: { start: asRevisionId(1), end: asRevisionId(1) },
      received: { start: asRevisionId(1), end: asRevisionId(1) },
    },
    receivedAt: 0,
    body,
  } satisfies RawPayload);
  await saveActivePublication(store, docId);
  await store.putCacheMeta({
    docId,
    createdAt: 0,
    lastAccessedAt,
    parserVersion: PARSER_VERSION,
    estimatedBytes: 1,
    reconstructionStatus: "complete",
    rawRetained: true,
  });
}

describe("background retrieval wiring", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    removeAllListeners();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("drives the live revisions/load adapter end-to-end against a mocked fetch", async () => {
    const calls: Array<{ url: string; credentials: string | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: { credentials?: string }) => {
        calls.push({ url: input, credentials: init?.credentials });
        if (input.includes("/revisions/load")) return Promise.resolve(res(200, FRAMED_CHUNK));
        if (input.includes("/edit")) return Promise.resolve(res(200, 'x="y","revision":2,z')); // bootstrap metadata
        return Promise.resolve(res(404, ""));
      }),
    );

    runBackground();
    const ack = await sendMessage("startRetrieval", { docId: asDocId("docBG"), userIndex: null });

    expect(ack).toEqual({ ok: true });
    // Discovery read the bootstrap; the chunk fetch carried first-party cookies.
    expect(calls.some((c) => c.url.includes("/document/d/docBG/edit"))).toBe(true);
    const loadCall = calls.find((c) => c.url.includes("/revisions/load"));
    expect(loadCall?.url).toContain("start=1");
    expect(loadCall?.url).toContain("end=2");
    expect(loadCall?.credentials).toBe("include");
    // A completed checkpoint was persisted at the discovered upper bound (2).
    const checkpoint = await sendMessage("getCheckpoint", { docId: asDocId("docBG") });
    expect(checkpoint?.completed).toBe(true);
    expect(Number(checkpoint?.upperBound)).toBe(2);
  });

  it("uses the live document/u/{N}/d path order for multi-account retrieval", async () => {
    const calls: Array<{ url: string; credentials: string | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: { credentials?: string }) => {
        calls.push({ url: input, credentials: init?.credentials });
        if (input.includes("/revisions/load")) return Promise.resolve(res(200, FRAMED_CHUNK));
        if (input.includes("/edit")) return Promise.resolve(res(200, 'x="y","revision":1,z'));
        return Promise.resolve(res(404, ""));
      }),
    );

    runBackground();
    const ack = await sendMessage("startRetrieval", { docId: asDocId("docMulti"), userIndex: 1 });

    expect(ack.ok).toBe(true);
    expect(calls.some((c) => c.url.includes("/document/u/1/d/docMulti/edit"))).toBe(true);
    const loadCall = calls.find((c) => c.url.includes("/revisions/load"));
    expect(loadCall?.url).toContain("/document/u/1/d/docMulti/revisions/load");
    expect(loadCall?.credentials).toBe("include");
  });

  it("maps an auth failure on the read to insufficient-permission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        if (input.includes("/revisions/load")) return Promise.resolve(res(403, ""));
        if (input.includes("/edit")) return Promise.resolve(res(200, '"revision":3'));
        return Promise.resolve(res(404, ""));
      }),
    );

    runBackground();
    const ack = await sendMessage("startRetrieval", { docId: asDocId("docAUTH"), userIndex: null });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.category).toBe("insufficient-permission");
      expect(ack.error.recoverable).toBe(false);
    }
  });

  it("getCheckpoint returns null for an untouched document", async () => {
    runBackground();
    const checkpoint = await sendMessage("getCheckpoint", { docId: asDocId("docNONE") });
    expect(checkpoint).toBeNull();
  });

  it("defers guarded raw maintenance while a decode lease is active", async () => {
    const docId = asDocId("docLease");
    const store = createIdbStore();
    await store.saveRawChunk({
      docId,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: "raw-body",
    } satisfies RawPayload);
    await saveActivePublication(store, docId);

    runBackground();
    await sendMessage("beginDecodeLease", { docId });
    const deferred = await sendMessage("requestStorageMaintenance", {
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
    });

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(docId)).toHaveLength(1);

    const released = await sendMessage("endDecodeLease", { docId });

    expect(released.status).toBe("completed");
    expect(released.reclaimedBytes).toBeGreaterThan(0);
    expect(await store.getRawChunks(docId)).toEqual([]);
  });

  it("makes the live decode lease visible before durable lease persistence resolves", async () => {
    const docId = asDocId("docBeginLeaseRaceMaintenanceBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId);
    const originalSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    let releaseLeaseWrite: (() => void) | undefined;
    let delayed = false;
    vi.spyOn(fakeBrowser.storage.local, "set").mockImplementation(
      async (items: Record<string, unknown>) => {
        if (!delayed && Object.hasOwn(items, "activeStorageLeases")) {
          delayed = true;
          await new Promise<void>((resolve) => {
            releaseLeaseWrite = resolve;
          });
        }
        await originalSet(items);
      },
    );

    runBackground();
    const begin = sendMessage("beginDecodeLease", { docId });
    await vi.waitFor(() => expect(releaseLeaseWrite).toBeTypeOf("function"));

    const deferred = await sendMessage("requestStorageMaintenance", {
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
    });

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(docId)).toHaveLength(1);

    releaseLeaseWrite?.();
    await begin;
    await sendMessage("endDecodeLease", { docId });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
    });
  });

  it("blocks destructive clear while durable lease persistence is still pending", async () => {
    const docId = asDocId("docBeginLeaseRaceClearBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId);
    const originalSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    let releaseLeaseWrite: (() => void) | undefined;
    let delayed = false;
    vi.spyOn(fakeBrowser.storage.local, "set").mockImplementation(
      async (items: Record<string, unknown>) => {
        if (!delayed && Object.hasOwn(items, "activeStorageLeases")) {
          delayed = true;
          await new Promise<void>((resolve) => {
            releaseLeaseWrite = resolve;
          });
        }
        await originalSet(items);
      },
    );

    runBackground();
    const begin = sendMessage("beginDecodeLease", { docId });
    await vi.waitFor(() => expect(releaseLeaseWrite).toBeTypeOf("function"));

    const deferred = await sendMessage("clearDocumentCache", { docId });

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(docId)).toHaveLength(1);

    releaseLeaseWrite?.();
    await begin;
    await sendMessage("endDecodeLease", { docId });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
    });
  });

  it("routes destructive document clear through the lease-aware background coordinator", async () => {
    const docId = asDocId("docClearBG");
    const store = createIdbStore();
    await store.saveRawChunk({
      docId,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: "raw-body",
    } satisfies RawPayload);
    await saveActivePublication(store, docId);

    runBackground();
    await sendMessage("beginDecodeLease", { docId });
    const deferred = await sendMessage("clearDocumentCache", { docId });

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(docId)).toHaveLength(1);

    const released = await sendMessage("endDecodeLease", { docId });

    expect(released.status).toBe("completed");
    expect(await store.getRawChunks(docId)).toEqual([]);
    expect(await store.readCheckpoint(docId)).toBeNull();
  });

  it("drains persisted pending maintenance on background startup", async () => {
    const docId = asDocId("docPendingBG");
    const store = createIdbStore();
    await store.saveRawChunk({
      docId,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: "raw-body",
    } satisfies RawPayload);
    await saveActivePublication(store, docId);
    const request = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 1,
    });
    await upsertPendingStorageMaintenance(request);

    runBackground();

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });
  });

  it("ignores stale coalesced persisted maintenance after a newer policy wins", async () => {
    const docId = asDocId("docStalePolicyBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId, "raw-body", 1);
    const stale = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 1,
    });
    const latest = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: true,
      budget: {
        perDocumentBytes: Number.MAX_SAFE_INTEGER,
        globalCapBytes: Number.MAX_SAFE_INTEGER,
      },
      reconstructionStatus: "complete",
      queuedAt: 2,
    });
    await upsertPendingStorageMaintenance(stale);
    await upsertPendingStorageMaintenance(latest);

    runBackground();

    await vi.waitFor(async () => {
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });
    const ack = await sendMessage("requestStorageMaintenance", stale);

    expect(ack).toEqual({ status: "completed", reclaimedBytes: 0 });
    expect(await store.getRawChunks(docId)).toHaveLength(1);
  });

  it("does not let stale or malformed maintenance acks remove a newer pending request", async () => {
    const docId = asDocId("docStaleAckPolicyBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId, "raw-body", 1);
    const stale = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 1,
    });
    const latest = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 2,
    });
    await upsertPendingStorageMaintenance(latest);
    await beginStorageLease(docId, Date.now());

    runBackground();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingStorageMaintenance()).toEqual([latest]);

    expect(await sendMessage("requestStorageMaintenance", stale)).toEqual({
      status: "completed",
      reclaimedBytes: 0,
    });
    expect(await getPendingStorageMaintenance()).toEqual([latest]);

    expect(
      await sendMessage("requestStorageMaintenance", {
        id: latest.id,
        docId,
        keepRawData: false,
        budget: { perDocumentBytes: 1, globalCapBytes: 1 },
        reconstructionStatus: "complete",
      }),
    ).toEqual({ status: "completed", reclaimedBytes: 0 });
    expect(await getPendingStorageMaintenance()).toEqual([latest]);
    expect(await store.getRawChunks(docId)).toHaveLength(1);
  });

  it("drops matching pending maintenance when a destructive document clear completes", async () => {
    const docId = asDocId("docClearCancelsMaintenanceBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId, "raw-body", 1);
    const maintenance = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 1,
    });
    const clear = createPendingDestructiveStorageClear({
      kind: "document",
      docId,
      queuedAt: 1,
    });
    await upsertPendingStorageMaintenance(maintenance);
    await upsertPendingDestructiveStorageClear(clear);

    runBackground();

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
      expect(await store.getCacheMeta(docId)).toBeNull();
      expect(await getPendingDestructiveStorageClears()).toEqual([]);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });
  });

  it("does not drain persisted maintenance on startup while a durable lease is active", async () => {
    const docId = asDocId("docPendingLeaseBG");
    const store = createIdbStore();
    await store.saveRawChunk({
      docId,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: "raw-body",
    } satisfies RawPayload);
    await saveActivePublication(store, docId);
    const request = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 1,
    });
    await upsertPendingStorageMaintenance(request);
    await beginStorageLease(docId, Date.now());

    runBackground();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingStorageMaintenance()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });
  });

  it("drains persisted destructive clear requests on background startup", async () => {
    const docId = asDocId("docPendingClearBG");
    const store = createIdbStore();
    await store.saveRawChunk({
      docId,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: "raw-body",
    } satisfies RawPayload);
    const request = createPendingDestructiveStorageClear({
      kind: "document",
      docId,
      queuedAt: 1,
    });
    await upsertPendingDestructiveStorageClear(request);

    runBackground();

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
      expect(await getPendingDestructiveStorageClears()).toEqual([]);
    });
  });

  it("does not drain persisted destructive clear on startup while a durable lease is active", async () => {
    const docId = asDocId("docPendingClearLeaseBG");
    const store = createIdbStore();
    await store.saveRawChunk({
      docId,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: "raw-body",
    } satisfies RawPayload);
    const request = createPendingDestructiveStorageClear({
      kind: "document",
      docId,
      queuedAt: 1,
    });
    await upsertPendingDestructiveStorageClear(request);
    await beginStorageLease(docId, Date.now());

    runBackground();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
      expect(await getPendingDestructiveStorageClears()).toEqual([]);
    });
  });

  it("does not let stale or malformed destructive clear acks remove a newer pending clear", async () => {
    const docId = asDocId("docStaleClearAckBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId);
    const stale = createPendingDestructiveStorageClear({
      kind: "document",
      docId,
      queuedAt: 1,
    });
    const latest = createPendingDestructiveStorageClear({
      kind: "document",
      docId,
      queuedAt: 2,
    });
    await upsertPendingDestructiveStorageClear(latest);
    await beginStorageLease(docId, Date.now());

    runBackground();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([latest]);

    expect(await sendMessage("clearDocumentCache", stale)).toEqual({
      status: "completed",
      reclaimedBytes: 0,
    });
    expect(await getPendingDestructiveStorageClears()).toEqual([latest]);

    expect(await sendMessage("clearDocumentCache", { id: latest.id, docId })).toEqual({
      status: "completed",
      reclaimedBytes: 0,
    });
    expect(await getPendingDestructiveStorageClears()).toEqual([latest]);
    expect(await store.getRawChunks(docId)).toHaveLength(1);
  });

  it("does not treat a document clear token as current for clear-all", async () => {
    const docId = asDocId("docWrongClearAllTokenBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId);
    const request = createPendingDestructiveStorageClear({
      kind: "document",
      docId,
      queuedAt: 1,
    });
    await upsertPendingDestructiveStorageClear(request);
    await beginStorageLease(docId, Date.now());

    runBackground();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);

    expect(
      await sendMessage("clearAllCaches", { id: request.id, queuedAt: request.queuedAt }),
    ).toEqual({
      status: "completed",
      reclaimedBytes: 0,
    });

    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);
  });

  it("does not treat a clear-all token as current for a document clear", async () => {
    const docId = asDocId("docWrongDocumentTokenBG");
    const otherDocId = asDocId("docWrongDocumentTokenOtherBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId, "raw-a", 1);
    await saveCompleteRawDocument(store, otherDocId, "raw-b", 2);
    const request = createPendingDestructiveStorageClear({
      kind: "all",
      queuedAt: 1,
    });
    await upsertPendingDestructiveStorageClear(request);
    await beginStorageLease(docId, Date.now());

    runBackground();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);

    expect(
      await sendMessage("clearDocumentCache", {
        id: request.id,
        docId,
        queuedAt: request.queuedAt,
      }),
    ).toEqual({ status: "completed", reclaimedBytes: 0 });

    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await store.getRawChunks(otherDocId)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);
  });

  it("keeps persisted document maintenance deferred when durable leases outlive the current worker lease", async () => {
    const docId = asDocId("docDocumentDurableCountMaintenanceBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId);
    const request = createPendingStorageMaintenanceRequest({
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 1,
    });
    await upsertPendingStorageMaintenance(request);
    await beginStorageLease(docId, Date.now());

    runBackground();
    await sendMessage("beginDecodeLease", { docId });
    const deferred = await sendMessage("requestStorageMaintenance", request);

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingStorageMaintenance()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingStorageMaintenance()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });
  });

  it("keeps persisted document clears deferred when durable leases outlive the current worker lease", async () => {
    const docId = asDocId("docDocumentDurableCountClearBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, docId);
    const request = createPendingDestructiveStorageClear({
      kind: "document",
      docId,
      queuedAt: 1,
    });
    await upsertPendingDestructiveStorageClear(request);
    await beginStorageLease(docId, Date.now());

    runBackground();
    await sendMessage("beginDecodeLease", { docId });
    const deferred = await sendMessage("clearDocumentCache", request);

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(docId)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(docId)).toEqual([]);
      expect(await getPendingDestructiveStorageClears()).toEqual([]);
    });
  });

  it("does not run global maintenance while an unrelated durable-only lease remains active", async () => {
    const durableDoc = asDocId("docGlobalDurableMaintenanceBG");
    const memoryDoc = asDocId("docGlobalMemoryMaintenanceBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, durableDoc, "durable-raw", 1);
    await saveCompleteRawDocument(store, memoryDoc, "memory-raw", 2);
    const request = createPendingStorageMaintenanceRequest({
      docId: null,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "complete",
      queuedAt: 1,
    });
    await upsertPendingStorageMaintenance(request);
    await beginStorageLease(durableDoc, Date.now());

    runBackground();
    await sendMessage("beginDecodeLease", { docId: memoryDoc });
    const deferred = await sendMessage("requestStorageMaintenance", request);

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(durableDoc)).toHaveLength(1);
    expect(await store.getRawChunks(memoryDoc)).toHaveLength(1);
    expect(await getPendingStorageMaintenance()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId: memoryDoc });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(durableDoc)).toHaveLength(1);
    expect(await store.getRawChunks(memoryDoc)).toHaveLength(1);
    expect(await getPendingStorageMaintenance()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId: durableDoc });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(durableDoc)).toEqual([]);
      expect(await store.getRawChunks(memoryDoc)).toEqual([]);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });
  });

  it("does not run global destructive clear while an unrelated durable-only lease remains active", async () => {
    const durableDoc = asDocId("docGlobalDurableClearBG");
    const memoryDoc = asDocId("docGlobalMemoryClearBG");
    const store = createIdbStore();
    await saveCompleteRawDocument(store, durableDoc, "durable-raw", 1);
    await saveCompleteRawDocument(store, memoryDoc, "memory-raw", 2);
    const request = createPendingDestructiveStorageClear({
      kind: "all",
      queuedAt: 1,
    });
    await upsertPendingDestructiveStorageClear(request);
    await beginStorageLease(durableDoc, Date.now());

    runBackground();
    await sendMessage("beginDecodeLease", { docId: memoryDoc });
    const deferred = await sendMessage("clearAllCaches", request);

    expect(deferred.status).toBe("deferred");
    expect(await store.getRawChunks(durableDoc)).toHaveLength(1);
    expect(await store.getRawChunks(memoryDoc)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId: memoryDoc });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.getRawChunks(durableDoc)).toHaveLength(1);
    expect(await store.getRawChunks(memoryDoc)).toHaveLength(1);
    expect(await getPendingDestructiveStorageClears()).toEqual([request]);

    await sendMessage("endDecodeLease", { docId: durableDoc });

    await vi.waitFor(async () => {
      expect(await store.getRawChunks(durableDoc)).toEqual([]);
      expect(await store.getRawChunks(memoryDoc)).toEqual([]);
      expect(await getPendingDestructiveStorageClears()).toEqual([]);
    });
  });
});
