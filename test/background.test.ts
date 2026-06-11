// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Background wiring test (plan §1.5, Vitest tier). Runs the real background
// setup (`defineBackground` returns `{ main }`) so the typed messaging handlers
// register against the fakeBrowser, then proves `startRetrieval` resolves to the
// gated `endpoint-unavailable` error — the plumbing works WITHOUT a live fetch.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import background from "@/entrypoints/background";
import { asDocId } from "@/lib/domain/ids";
import { removeAllListeners, sendMessage } from "@/lib/messaging";

function runBackground(): void {
  // defineBackground(fn) => { main: fn }.
  background.main?.();
}

describe("background retrieval wiring", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    removeAllListeners();
  });

  it("startRetrieval returns the gated endpoint-unavailable error (no live fetch)", async () => {
    runBackground();
    const ack = await sendMessage("startRetrieval", {
      docId: asDocId("docBG"),
      userIndex: null,
    });
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.category).toBe("endpoint-unavailable");
      expect(ack.error.userMessage.length).toBeGreaterThan(0);
    }
  });

  it("getCheckpoint returns null for an untouched document", async () => {
    runBackground();
    const checkpoint = await sendMessage("getCheckpoint", { docId: asDocId("docNONE") });
    expect(checkpoint).toBeNull();
  });
});
