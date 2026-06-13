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
import type {
  ReplayPublication,
  RetrievalCheckpoint,
  RevisionStore,
  StoredSnapshot,
} from "./store";

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

function replayPublication(publicationId: string, revisions = [decodedRev(1)]): ReplayPublication {
  return {
    publicationId,
    parserVersion: 1,
    revisions,
    snapshots: [snapshot(0), snapshot(revisions.length)],
    timeline: [largeEdit(1)],
    publishedAt: 123,
  };
}

function cacheRec(
  docId: DocId,
  lastAccessedAt: number,
  reconstructionStatus: CacheRecord["reconstructionStatus"] = "complete",
): CacheRecord {
  return {
    docId,
    createdAt: 0,
    lastAccessedAt,
    parserVersion: 1,
    estimatedBytes: 0,
    reconstructionStatus,
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

    it("estimates and deletes raw for one document without deleting derived data", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "raw-a"));
      await store.saveRawChunk(rawChunk(docB, 1, 4, "raw-b"));
      await store.saveDecoded(docA, [decodedRev(1)]);
      await store.saveSnapshots(docA, [snapshot(1)]);
      await store.saveTimeline(docA, [largeEdit(1)]);
      await store.saveReplayPublication(docA, replayPublication("pub-raw-one"));
      await store.putCacheMeta(cacheRec(docA, 10));
      await store.writeCheckpoint({
        docId: docA,
        upperBound: rev(4),
        nextStart: rev(5),
        completed: true,
        updatedAt: 0,
      });

      expect(await store.estimateRawBytes(docA)).toBeGreaterThan(0);
      const reclaimed = await store.deleteRawForDoc(docA);

      expect(reclaimed).toBeGreaterThan(0);
      expect(await store.estimateRawBytes(docA)).toBe(0);
      expect(await store.getRawChunks(docA)).toEqual([]);
      expect((await store.getRawChunks(docB)).map((c) => c.body)).toEqual(["raw-b"]);
      expect(await store.getDecoded(docA)).toHaveLength(1);
      expect(await store.getSnapshots(docA)).toHaveLength(1);
      expect(await store.getTimeline(docA)).toHaveLength(1);
      expect(await store.getReplayPublication(docA, "pub-raw-one")).not.toBeNull();
      expect(await store.readCheckpoint(docA)).not.toBeNull();
      expect((await store.getCacheMeta(docA))?.rawRetained).toBe(false);
      expect((await store.getCacheMeta(docA))?.estimatedBytes).toBe(0);
    });

    it("deletes all raw chunks without deleting derived data", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "raw-a"));
      await store.saveRawChunk(rawChunk(docB, 1, 4, "raw-b"));
      await store.saveDecoded(docA, [decodedRev(1)]);
      await store.saveReplayPublication(docA, replayPublication("pub-raw-all"));
      await store.putCacheMeta(cacheRec(docA, 1));
      await store.putCacheMeta(cacheRec(docB, 2));

      const reclaimed = await store.deleteRawAll();

      expect(reclaimed).toBeGreaterThan(0);
      expect(await store.getRawChunks(docA)).toEqual([]);
      expect(await store.getRawChunks(docB)).toEqual([]);
      expect(await store.getDecoded(docA)).toHaveLength(1);
      expect(await store.getReplayPublication(docA, "pub-raw-all")).not.toBeNull();
      expect((await store.getCacheMeta(docA))?.rawRetained).toBe(false);
      expect((await store.getCacheMeta(docB))?.rawRetained).toBe(false);
    });

    it("coarsely prunes one document when its raw bytes exceed the per-document cap", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "x".repeat(100)));
      await store.saveRawChunk(rawChunk(docB, 1, 4, "y"));
      await store.saveReplayPublication(docA, replayPublication("pub-prune-one"));
      await store.putCacheMeta(cacheRec(docA, 1));
      await store.putCacheMeta(cacheRec(docB, 2));

      const retained = await store.estimateRawBytes(docA);
      const reclaimed = await store.pruneRawToCap(docA, retained - 1);

      expect(reclaimed).toBeGreaterThan(0);
      expect(await store.getRawChunks(docA)).toEqual([]);
      expect(await store.getRawChunks(docB)).toHaveLength(1);
      expect(await store.getReplayPublication(docA, "pub-prune-one")).not.toBeNull();
      expect((await store.getCacheMeta(docA))?.rawRetained).toBe(false);
    });

    it("coarsely applies a per-document raw cap across all documents", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "x".repeat(100)));
      await store.saveRawChunk(rawChunk(docB, 1, 4, "y".repeat(100)));
      await store.saveReplayPublication(docA, replayPublication("pub-prune-all"));
      await store.putCacheMeta(cacheRec(docA, 1));
      await store.putCacheMeta(cacheRec(docB, 2));

      const retained = await store.estimateRawBytes(docA);
      const reclaimed = await store.pruneRawToCapAll(retained - 1);

      expect(reclaimed).toBeGreaterThan(0);
      expect(await store.getRawChunks(docA)).toEqual([]);
      expect(await store.getRawChunks(docB)).toEqual([]);
      expect(await store.getReplayPublication(docA, "pub-prune-all")).not.toBeNull();
      expect((await store.getCacheMeta(docA))?.rawRetained).toBe(false);
      expect((await store.getCacheMeta(docB))?.rawRetained).toBe(false);
    });

    it("round-trips decoded / snapshots / timeline", async () => {
      await store.saveDecoded(docA, [decodedRev(1), decodedRev(2)]);
      await store.saveSnapshots(docA, [snapshot(0), snapshot(2)]);
      await store.saveTimeline(docA, [largeEdit(1)]);
      expect((await store.getDecoded(docA)).map((r) => r.revisionId)).toEqual([rev(1), rev(2)]);
      expect((await store.getSnapshots(docA)).map((s) => s.appliedCount)).toEqual([0, 2]);
      expect(await store.getTimeline(docA)).toHaveLength(1);
    });

    it("round-trips replay publication and gates reads by publicationId", async () => {
      const publication = replayPublication("pub-a", [decodedRev(1), decodedRev(2)]);

      await store.saveReplayPublication(docA, publication);

      expect(await store.getReplayPublication(docA, "wrong-id")).toBeNull();
      const loaded = await store.getReplayPublication(docA, "pub-a");
      expect(loaded?.publicationId).toBe("pub-a");
      expect(loaded?.revisions.map((r) => r.revisionId)).toEqual([rev(1), rev(2)]);
      expect(loaded?.snapshots.map((s) => s.appliedCount)).toEqual([0, 2]);
      expect(loaded?.timeline).toHaveLength(1);
    });

    it("keeps multiple replay publication generations for the same document isolated", async () => {
      await store.saveReplayPublication(docA, replayPublication("pub-old", [decodedRev(1)]));
      await store.saveReplayPublication(docA, replayPublication("pub-current", [decodedRev(2)]));

      const oldPublication = await store.getReplayPublication(docA, "pub-old");
      const currentPublication = await store.getReplayPublication(docA, "pub-current");

      expect(oldPublication?.publicationId).toBe("pub-old");
      expect(oldPublication?.revisions.map((revision) => revision.revisionId)).toEqual([rev(1)]);
      expect(currentPublication?.publicationId).toBe("pub-current");
      expect(currentPublication?.revisions.map((revision) => revision.revisionId)).toEqual([
        rev(2),
      ]);
    });

    it("prunes only stale replay publications for the scoped document", async () => {
      await store.saveReplayPublication(docA, replayPublication("pub-old"));
      await store.saveReplayPublication(docA, replayPublication("pub-current"));
      await store.saveReplayPublication(docB, replayPublication("pub-other"));

      await store.pruneReplayPublicationsExcept(docA, "pub-current");

      expect(await store.getReplayPublication(docA, "pub-old")).toBeNull();
      expect(await store.getReplayPublication(docA, "pub-current")).not.toBeNull();
      expect(await store.getReplayPublication(docB, "pub-other")).not.toBeNull();
    });

    it("value-isolates replay publications across store boundaries", async () => {
      await store.saveReplayPublication(docA, replayPublication("pub-isolated"));
      const loaded = await store.getReplayPublication(docA, "pub-isolated");
      expect(loaded).not.toBeNull();

      (loaded?.revisions as DecodedRevision[]).push(decodedRev(99));
      (loaded?.snapshots as StoredSnapshot[]).push(snapshot(99));

      const reread = await store.getReplayPublication(docA, "pub-isolated");
      expect(reread?.revisions).toHaveLength(1);
      expect(reread?.snapshots.map((s) => s.appliedCount)).toEqual([0, 1]);
    });

    it("returns empty collections for an unknown document", async () => {
      expect(await store.getDecoded(docB)).toEqual([]);
      expect(await store.getSnapshots(docB)).toEqual([]);
      expect(await store.getTimeline(docB)).toEqual([]);
      expect(await store.getReplayPublication(docB, "missing")).toBeNull();
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
      await store.saveReplayPublication(docA, replayPublication("pub-parser"));

      const bumped = harness.reopen(2); // parser version 1 -> 2
      expect(await bumped.getDecoded(docA)).toEqual([]);
      expect(await bumped.getSnapshots(docA)).toEqual([]);
      expect(await bumped.getTimeline(docA)).toEqual([]);
      expect(await bumped.getReplayPublication(docA, "pub-parser")).toBeNull();
      // Raw is re-decodable and must survive the bump.
      expect((await bumped.getRawChunks(docA)).map((c) => c.body)).toEqual(["raw"]);
    });

    it("LRU prunes raw chunks first, oldest document first, preserving derived data", async () => {
      const body = "z".repeat(100); // ~102 bytes serialized
      await store.saveRawChunk(rawChunk(docA, 1, 4, body));
      await store.saveRawChunk(rawChunk(docB, 1, 4, body));
      await store.saveDecoded(docA, [decodedRev(1)]);
      await store.saveDecoded(docB, [decodedRev(1)]);
      await store.saveReplayPublication(docA, replayPublication("pub-lru"));
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
      expect(await store.getReplayPublication(docA, "pub-lru")).not.toBeNull();
      // Evicted doc is flagged for re-fetch.
      expect((await store.getCacheMeta(docA))?.rawRetained).toBe(false);
      expect((await store.getCacheMeta(docB))?.rawRetained).toBe(true);
    });

    it("deleteDocument removes every record for one document", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "raw"));
      await store.saveDecoded(docA, [decodedRev(1)]);
      await store.saveReplayPublication(docA, replayPublication("pub-delete-doc"));
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
      expect(await store.getReplayPublication(docA, "pub-delete-doc")).toBeNull();
      expect(await store.getCacheMeta(docA)).toBeNull();
      expect(await store.readCheckpoint(docA)).toBeNull();
      // The other document is untouched.
      expect((await store.getRawChunks(docB)).map((c) => c.body)).toEqual(["keep"]);
    });

    it("deleteAll clears every document", async () => {
      await store.saveRawChunk(rawChunk(docA, 1, 4, "a"));
      await store.saveRawChunk(rawChunk(docB, 1, 4, "b"));
      await store.saveReplayPublication(docA, replayPublication("pub-delete-all"));
      await store.deleteAll();
      expect(await store.getRawChunks(docA)).toEqual([]);
      expect(await store.getRawChunks(docB)).toEqual([]);
      expect(await store.getReplayPublication(docA, "pub-delete-all")).toBeNull();
    });
  });
}
