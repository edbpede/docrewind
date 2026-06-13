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
import { createIdbStore } from "@/lib/db";
import { asDocId, asRevisionId } from "@/lib/domain/ids";
import type { RawPayload } from "@/lib/domain/model";
import { removeAllListeners, sendMessage } from "@/lib/messaging";

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

describe("background retrieval wiring", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    removeAllListeners();
  });

  afterEach(() => {
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

    runBackground();
    await sendMessage("beginDecodeLease", { docId });
    const deferred = await sendMessage("requestStorageMaintenance", {
      docId,
      keepRawData: false,
      budget: { perDocumentBytes: 1, globalCapBytes: 1 },
      reconstructionStatus: "partial",
    });

    expect(deferred.deferred).toBe(true);
    expect(await store.getRawChunks(docId)).toHaveLength(1);

    const released = await sendMessage("endDecodeLease", { docId });

    expect(released.deferred).toBe(false);
    expect(released.reclaimedBytes).toBeGreaterThan(0);
    expect(await store.getRawChunks(docId)).toEqual([]);
  });
});
