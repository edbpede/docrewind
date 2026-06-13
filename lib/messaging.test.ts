// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed messaging round-trip (plan §1.3, Vitest tier). Uses WXT's fakeBrowser,
// which provides in-memory runtime messaging so a registered handler receives a
// sent message with its typed payload.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { asDocId } from "./domain/ids";
import { onMessage, removeAllListeners, sendMessage } from "./messaging";
import { retrievalError } from "./retrieval/errors";

describe("messaging ProtocolMap", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });
  afterEach(() => {
    removeAllListeners();
  });

  it("round-trips startRetrieval with a typed ack", async () => {
    const docId = asDocId("docMSG");
    let received: { docId: string; userIndex: number | null } | null = null;
    onMessage("startRetrieval", ({ data }) => {
      received = { docId: data.docId, userIndex: data.userIndex };
      return { ok: false, error: retrievalError("endpoint-unavailable") };
    });

    const ack = await sendMessage("startRetrieval", { docId, userIndex: 1 });

    expect(received).toEqual({ docId: "docMSG", userIndex: 1 });
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error.category).toBe("endpoint-unavailable");
  });

  it("round-trips getCheckpoint returning null for an unknown document", async () => {
    const docId = asDocId("docNONE");
    onMessage("getCheckpoint", () => null);
    expect(await sendMessage("getCheckpoint", { docId })).toBeNull();
  });

  it("delivers a retrievalProgress broadcast payload", async () => {
    const docId = asDocId("docPROG");
    let phase: string | null = null;
    onMessage("retrievalProgress", ({ data }) => {
      phase = data.phase;
    });
    await sendMessage("retrievalProgress", {
      docId,
      phase: "fetching",
      chunksFetched: 3,
      upperBound: 100,
      error: null,
    });
    expect(phase).toBe("fetching");
  });

  it("round-trips guarded storage maintenance messages", async () => {
    const docId = asDocId("docMAINT");
    onMessage("beginDecodeLease", ({ data }) => {
      expect(data.docId).toBe(docId);
    });
    onMessage("endDecodeLease", ({ data }) => ({
      status: "completed",
      reclaimedBytes: data.docId === docId ? 1 : 0,
    }));
    onMessage("requestStorageMaintenance", ({ data }) => ({
      status: data.docId === docId ? "deferred" : "completed",
      reclaimedBytes: data.keepRawData ? 0 : 2,
    }));

    await sendMessage("beginDecodeLease", { docId });
    expect(await sendMessage("endDecodeLease", { docId })).toEqual({
      status: "completed",
      reclaimedBytes: 1,
    });
    expect(
      await sendMessage("requestStorageMaintenance", {
        docId,
        keepRawData: false,
        budget: { perDocumentBytes: 1, globalCapBytes: 2 },
        reconstructionStatus: "partial",
      }),
    ).toEqual({ status: "deferred", reclaimedBytes: 2 });
  });

  it("round-trips destructive cache clear messages", async () => {
    const docId = asDocId("docCLEAR");
    onMessage("clearDocumentCache", ({ data }) => ({
      status: data.docId === docId ? "completed" : "failed",
      reclaimedBytes: 0,
    }));
    onMessage("clearAllCaches", () => ({ status: "deferred", reclaimedBytes: 0 }));

    expect(await sendMessage("clearDocumentCache", { docId })).toEqual({
      status: "completed",
      reclaimedBytes: 0,
    });
    expect(await sendMessage("clearAllCaches", {})).toEqual({
      status: "deferred",
      reclaimedBytes: 0,
    });
  });
});
