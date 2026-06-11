// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared RevisionStore contract (plan §1.2 / PRD §10.2). ONE behavioral suite
// run against BOTH the `idb` backend and the in-memory twin, so the two
// implementations are provably interchangeable. Imported and invoked from
// lib/db.test.ts (Vitest tier); not a standalone test file.

import { beforeEach, describe, expect, it } from "vitest";
import { asDocId, asRevisionId } from "./domain/ids";
import type {
  CacheRecord,
  DecodedRevision,
  DocId,
  LargeEditEvent,
  RawPayload,
  RevisionId,
} from "./domain/model";
import { createModel } from "./reconstruction/model";
import type { RetrievalCheckpoint, RevisionStore, StoredSnapshot } from "./store";

/** A store plus a way to reopen the same backing data at a new parser version. */
export interface StoreHarness {
  readonly store: RevisionStore;
  reopen(parserVersion: number): RevisionStore;
}

const rev = (n: number): RevisionId => asRevisionId(n);

function rangeOf(start: number, end: number) {
  const span = { start: rev(start), end: rev(end) };
  return { requested: span, received: span };
}

function rawChunk(docId: DocId, start: number, end: number, body: unknown): RawPayload {
  return { docId, range: rangeOf(start, end), receivedAt: 0, body };
}

function decodedRev(id: number): DecodedRevision {
  return { revisionId: rev(id), userId: null, sessionId: null, time: null, operations: [] };
}

function largeEdit(at: number): LargeEditEvent {
  return {
    kind: "large-insertion",
    atRevision: rev(at),
    charDelta: 10,
    confidence: 0.7,
    provenance: "test",
  };
}

function snapshot(appliedCount: number): StoredSnapshot {
  return { appliedCount, model: createModel() };
}

function cacheRec(docId: DocId, lastAccessedAt: number): CacheRecord {
  return {
    docId,
    createdAt: 0,
    lastAccessedAt,
    parserVersion: 1,
    estimatedBytes: 0,
    reconstructionStatus: "none",
    rawRetained: true,
  };
}

/**
 * Register the full contract under `describe(label)`.
 * @param makeHarness fresh, isolated backing on each call
 * @param setMockUsage drives the mocked `navigator.storage.estimate()` usage
 */
export function runRevisionStoreContract(
  label: string,
  makeHarness: () => StoreHarness,
  setMockUsage: (usage: number, quota?: number) => void,
): void {
  describe(label, () => {
    let harness: StoreHarness;
    let store: RevisionStore;
    const docA = asDocId("docAAAA");
    const docB = asDocId("docBBBB");

    beforeEach(() => {
      setMockUsage(0, 0);
      harness = makeHarness();
      store = harness.store;
    });

    it("round-trips raw chunks sorted by received range", async () => {
      await store.saveRawChunk(rawChunk(docA, 5, 8, "second"));
      await store.saveRawChunk(rawChunk(docA, 1, 4, "first"));
      const chunks = await store.getRawChunks(docA);
      expect(chunks.map((c) => c.body)).toEqual(["first", "second"]);
      expect(await store.getRawChunks(docB)).toEqual([]);
    });

    it("overwrites a raw chunk re-saved at the same range", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "v1"));
      await store.saveRawChunk(rawChunk(docA, 1, 4, "v2"));
      const chunks = await store.getRawChunks(docA);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.body).toBe("v2");
    });

    it("round-trips decoded / snapshots / timeline", async () => {
      await store.saveDecoded(docA, [decodedRev(1), decodedRev(2)]);
      await store.saveSnapshots(docA, [snapshot(0), snapshot(2)]);
      await store.saveTimeline(docA, [largeEdit(1)]);
      expect((await store.getDecoded(docA)).map((r) => r.revisionId)).toEqual([rev(1), rev(2)]);
      expect((await store.getSnapshots(docA)).map((s) => s.appliedCount)).toEqual([0, 2]);
      expect(await store.getTimeline(docA)).toHaveLength(1);
    });

    it("returns empty collections for an unknown document", async () => {
      expect(await store.getDecoded(docB)).toEqual([]);
      expect(await store.getSnapshots(docB)).toEqual([]);
      expect(await store.getTimeline(docB)).toEqual([]);
      expect(await store.getCacheMeta(docB)).toBeNull();
      expect(await store.readCheckpoint(docB)).toBeNull();
    });

    it("round-trips cache metadata and touch() updates lastAccessedAt", async () => {
      await store.putCacheMeta(cacheRec(docA, 100));
      expect((await store.getCacheMeta(docA))?.lastAccessedAt).toBe(100);
      await store.touch(docA, 250);
      expect((await store.getCacheMeta(docA))?.lastAccessedAt).toBe(250);
      // touch on an absent doc is a no-op (does not throw / create).
      await store.touch(docB, 1);
      expect(await store.getCacheMeta(docB)).toBeNull();
    });

    it("round-trips retrieval checkpoints", async () => {
      const cp: RetrievalCheckpoint = {
        docId: docA,
        upperBound: rev(100),
        nextStart: rev(41),
        completed: false,
        updatedAt: 7,
      };
      await store.writeCheckpoint(cp);
      expect(await store.readCheckpoint(docA)).toEqual(cp);
    });

    it("invalidates decoded/snapshots/timeline on a parser-version bump but retains raw", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "raw"));
      await store.saveDecoded(docA, [decodedRev(1)]);
      await store.saveSnapshots(docA, [snapshot(1)]);
      await store.saveTimeline(docA, [largeEdit(1)]);

      const bumped = harness.reopen(2); // parser version 1 -> 2
      expect(await bumped.getDecoded(docA)).toEqual([]);
      expect(await bumped.getSnapshots(docA)).toEqual([]);
      expect(await bumped.getTimeline(docA)).toEqual([]);
      // Raw is re-decodable and must survive the bump.
      expect((await bumped.getRawChunks(docA)).map((c) => c.body)).toEqual(["raw"]);
    });

    it("LRU prunes raw chunks first, oldest document first, preserving derived data", async () => {
      const body = "z".repeat(100); // ~102 bytes serialized
      await store.saveRawChunk(rawChunk(docA, 1, 4, body));
      await store.saveRawChunk(rawChunk(docB, 1, 4, body));
      await store.saveDecoded(docA, [decodedRev(1)]);
      await store.saveDecoded(docB, [decodedRev(1)]);
      await store.putCacheMeta(cacheRec(docA, 1)); // older
      await store.putCacheMeta(cacheRec(docB, 2)); // newer

      // Report usage above target so exactly the oldest doc must be dropped.
      setMockUsage(200);
      const reclaimed = await store.pruneLRU(150);

      expect(reclaimed).toBeGreaterThan(0);
      expect(await store.getRawChunks(docA)).toEqual([]); // oldest raw evicted
      expect((await store.getRawChunks(docB)).length).toBe(1); // newer retained
      // Derived data is preserved for both.
      expect(await store.getDecoded(docA)).toHaveLength(1);
      expect(await store.getDecoded(docB)).toHaveLength(1);
      // Evicted doc is flagged for re-fetch.
      expect((await store.getCacheMeta(docA))?.rawRetained).toBe(false);
      expect((await store.getCacheMeta(docB))?.rawRetained).toBe(true);
    });

    it("deleteDocument removes every record for one document", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "raw"));
      await store.saveDecoded(docA, [decodedRev(1)]);
      await store.putCacheMeta(cacheRec(docA, 1));
      await store.writeCheckpoint({
        docId: docA,
        upperBound: rev(4),
        nextStart: rev(5),
        completed: true,
        updatedAt: 0,
      });
      await store.saveRawChunk(rawChunk(docB, 1, 4, "keep"));

      await store.deleteDocument(docA);

      expect(await store.getRawChunks(docA)).toEqual([]);
      expect(await store.getDecoded(docA)).toEqual([]);
      expect(await store.getCacheMeta(docA)).toBeNull();
      expect(await store.readCheckpoint(docA)).toBeNull();
      // The other document is untouched.
      expect((await store.getRawChunks(docB)).map((c) => c.body)).toEqual(["keep"]);
    });

    it("deleteAll clears every document", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "a"));
      await store.saveRawChunk(rawChunk(docB, 1, 4, "b"));
      await store.deleteAll();
      expect(await store.getRawChunks(docA)).toEqual([]);
      expect(await store.getRawChunks(docB)).toEqual([]);
    });
  });
}
