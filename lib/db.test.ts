// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bulk-store tests (plan §1.2, Vitest tier). Runs the shared RevisionStore
// contract against BOTH backends, plus idb-specific schema + quota-helper checks.
// `fake-indexeddb/auto` patches the global `indexedDB` (jsdom provides none).

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdbStore, isQuotaExceededError } from "./db";
import { runRevisionStoreContract, type StoreHarness } from "./db.contract";
import { createMemoryBackend, createMemoryStore } from "./db.memory";

// --- Mocked navigator.storage (estimate/persist) ----------------------------
let mockUsage = 0;
let mockQuota = 0;
function setMockUsage(usage: number, quota = 0): void {
  mockUsage = usage;
  mockQuota = quota;
}

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: {
      estimate: async () => ({ usage: mockUsage, quota: mockQuota }),
      persist: async () => true,
    },
  });
});

afterEach(() => {
  mockUsage = 0;
  mockQuota = 0;
});

// --- Contract across both implementations ------------------------------------
let dbCounter = 0;
function makeIdbHarness(): StoreHarness {
  const name = `docrewind-test-${dbCounter++}`;
  return {
    store: createIdbStore({ name, parserVersion: 1 }),
    reopen: (parserVersion: number) => createIdbStore({ name, parserVersion }),
  };
}

function makeMemoryHarness(): StoreHarness {
  const backend = createMemoryBackend();
  return {
    store: createMemoryStore({ backend, parserVersion: 1 }),
    reopen: (parserVersion: number) => createMemoryStore({ backend, parserVersion }),
  };
}

runRevisionStoreContract("RevisionStore (idb)", makeIdbHarness, setMockUsage);
runRevisionStoreContract("RevisionStore (in-memory)", makeMemoryHarness, setMockUsage);

// --- idb-specific: the upgrade path creates all stores + indexes -------------
describe("idb schema", () => {
  it("upgrade creates all object stores and indexes", async () => {
    const name = `docrewind-schema-${dbCounter++}`;
    // Trigger the upgrade by exercising the store.
    await createIdbStore({ name }).getRawChunks(
      // any DocId; getRawChunks opens the db
      "any" as never,
    );
    const db = await openDB(name, 1);
    expect([...db.objectStoreNames].sort()).toEqual([
      "cacheMeta",
      "checkpoints",
      "decoded",
      "rawChunks",
      "snapshots",
      "timeline",
    ]);
    expect([...db.transaction("rawChunks").store.indexNames]).toContain("by-doc");
    expect([...db.transaction("cacheMeta").store.indexNames]).toContain("by-last-accessed");
    db.close();
  });
});

// --- QuotaExceededError recognition ------------------------------------------
describe("isQuotaExceededError", () => {
  it("recognizes a QuotaExceededError DOMException", () => {
    expect(isQuotaExceededError(new DOMException("full", "QuotaExceededError"))).toBe(true);
  });
  it("rejects other errors", () => {
    expect(isQuotaExceededError(new DOMException("x", "AbortError"))).toBe(false);
    expect(isQuotaExceededError(new Error("nope"))).toBe(false);
    expect(isQuotaExceededError("string")).toBe(false);
  });
});
