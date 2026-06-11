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
});
