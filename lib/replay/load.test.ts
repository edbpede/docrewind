// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit test for the pure replay loader (plan Phase 5 §3). Exercises the three
// functions against the in-memory `RevisionStore` twin: the snapshot-map keying,
// the seeded round-trip, and the same-thread pipeline → re-read single path.

import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../db.memory";
import { PARSER_VERSION } from "../decoder/version";
import { asDocId, asRevisionId } from "../domain/ids";
import type { DecodedRevision, RawPayload } from "../domain/model";
import type { RevisionRangeDiscovery } from "../protocol/discovery";
import { createModel, type DocumentModel } from "../reconstruction/model";
import { modelAtRevisionIndex, SNAPSHOT_CADENCE } from "../reconstruction/snapshot";
import { currentText } from "../reconstruction/text";
import { runRetrieval } from "../retrieval/orchestrator";
import type { ChunkFetcher } from "../retrieval/transport";
import type { StoredSnapshot } from "../store";
import {
  loadReplayData,
  publishDerivedData,
  type ReplayData,
  rebuildReplayIndex,
  runPipelineSameThread,
} from "./load";

const DOC = asDocId("DocLoadTest123");

function revision(id: number): DecodedRevision {
  return {
    revisionId: asRevisionId(id),
    userId: null,
    sessionId: null,
    time: null,
    operations: [{ ty: "is", s: "x", ibi: 1 }],
  };
}

function snapshot(appliedCount: number, model: DocumentModel): StoredSnapshot {
  return { appliedCount, model };
}

async function loadOk(publicationId: string, store = createMemoryStore()): Promise<ReplayData> {
  const result = await loadReplayData(store, DOC, publicationId);
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") {
    throw new Error("expected replay data");
  }
  return result.data;
}

describe("rebuildReplayIndex", () => {
  test("keys the snapshot map by appliedCount and carries the constant cadence", () => {
    const decoded = [revision(1), revision(2)];
    const snapshots = [snapshot(0, createModel()), snapshot(2, createModel())];
    const index = rebuildReplayIndex(decoded, snapshots);
    expect(index.revisions).toEqual(decoded);
    expect(index.cadence).toBe(SNAPSHOT_CADENCE);
    expect([...index.snapshots.keys()].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  test("rebuilt index scrubs to the same text as a from-scratch build", () => {
    const store = createMemoryStore();
    // Seed via the same-thread pipeline so decoded + snapshots are real.
    const body = { changelog: [{ ty: "is", s: "hello world", ibi: 1, revision_id: 1 }] };
    return (async () => {
      await store.saveRawChunk({
        docId: DOC,
        range: {
          requested: { start: asRevisionId(1), end: asRevisionId(1) },
          received: { start: asRevisionId(1), end: asRevisionId(1) },
        },
        receivedAt: 0,
        body,
      } satisfies RawPayload);
      await runPipelineSameThread(store, DOC, { publicationId: "pub-scrub" });
      const data = await loadOk("pub-scrub", store);
      const finalModel = modelAtRevisionIndex(data.replayIndex, data.revisions.length);
      expect(currentText(finalModel)).toBe("hello world");
    })();
  });
});

describe("loadReplayData", () => {
  test("reads the matching atomic replay publication", async () => {
    const store = createMemoryStore();
    await store.saveDecoded(DOC, [revision(99)]);
    await store.saveSnapshots(DOC, [snapshot(99, createModel())]);
    await store.saveTimeline(DOC, []);
    await store.saveReplayPublication(DOC, {
      publicationId: "pub-fresh",
      parserVersion: PARSER_VERSION,
      revisions: [revision(1)],
      snapshots: [snapshot(0, createModel())],
      timeline: [],
      publishedAt: 1,
    });

    const result = await loadReplayData(store, DOC, "pub-fresh");

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("expected replay data");
    }
    expect(result.data.revisions).toHaveLength(1);
    expect(result.data.revisions[0]?.revisionId).toBe(asRevisionId(1));
    expect(result.data.timeline).toEqual([]);
    expect(result.data.replayIndex.snapshots.has(0)).toBe(true);
  });

  test("resolves the active replay publication without an expected id", async () => {
    const store = createMemoryStore();
    await store.saveReplayPublication(DOC, {
      publicationId: "pub-old",
      parserVersion: PARSER_VERSION,
      revisions: [revision(1)],
      snapshots: [snapshot(0, createModel())],
      timeline: [],
      publishedAt: 1,
    });
    await store.saveReplayPublication(DOC, {
      publicationId: "pub-current",
      parserVersion: PARSER_VERSION,
      revisions: [revision(2)],
      snapshots: [snapshot(0, createModel())],
      timeline: [],
      publishedAt: 2,
    });
    await store.setActiveReplayPublication(DOC, "pub-current");

    const result = await loadReplayData(store, DOC);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("expected replay data");
    }
    expect(result.data.revisions[0]?.revisionId).toBe(asRevisionId(2));
    expect(await store.getReplayPublication(DOC, "pub-old")).not.toBeNull();
  });

  test("ignores legacy split stores when no matching publication exists", async () => {
    const store = createMemoryStore();
    await store.saveDecoded(DOC, [revision(1)]);
    await store.saveSnapshots(DOC, [snapshot(0, createModel())]);
    await store.saveTimeline(DOC, []);

    const data = await loadReplayData(store, DOC, "missing-pub");

    expect(data).toEqual({ kind: "missing-publication" });
  });

  test("returns a classified miss for the wrong publication id", async () => {
    const store = createMemoryStore();
    await store.saveReplayPublication(DOC, {
      publicationId: "pub-a",
      parserVersion: PARSER_VERSION,
      revisions: [revision(1)],
      snapshots: [snapshot(0, createModel())],
      timeline: [],
      publishedAt: 1,
    });

    const data = await loadReplayData(store, DOC, "pub-b");

    expect(data).toEqual({ kind: "missing-publication" });
  });

  test("returns a classified miss when nothing is published (never throws on a miss)", async () => {
    const store = createMemoryStore();
    const data = await loadReplayData(store, asDocId("EmptyDoc"), "missing-pub");
    expect(data).toEqual({ kind: "missing-publication" });
  });

  test("fails closed when the active pointer is missing or dangling", async () => {
    const store = createMemoryStore();
    await store.saveReplayPublication(DOC, {
      publicationId: "pub-unpointed",
      parserVersion: PARSER_VERSION,
      revisions: [revision(1)],
      snapshots: [snapshot(0, createModel())],
      timeline: [],
      publishedAt: 1,
    });

    expect(await loadReplayData(store, DOC)).toEqual({ kind: "missing-publication" });

    await store.setActiveReplayPublication(DOC, "missing-row");

    expect(await loadReplayData(store, DOC)).toEqual({ kind: "missing-publication" });
  });

  test("a stale publication cannot overwrite the active publication", async () => {
    const store = createMemoryStore();
    await publishDerivedData(
      store,
      DOC,
      { revisions: [revision(2)], snapshots: [snapshot(0, createModel())], timeline: [] },
      { publicationId: "pub-current", now: () => 2 },
    );
    let stillCurrent = true;
    const saveReplayPublication = store.saveReplayPublication.bind(store);
    store.saveReplayPublication = async (docId, publication) => {
      await saveReplayPublication(docId, publication);
      stillCurrent = false;
    };
    const published = await publishDerivedData(
      store,
      DOC,
      { revisions: [revision(1)], snapshots: [snapshot(0, createModel())], timeline: [] },
      { publicationId: "pub-stale", shouldPublish: () => stillCurrent, now: () => 1 },
    );

    const active = await loadReplayData(store, DOC);

    expect(published).toBe(false);
    expect(await store.getReplayPublication(DOC, "pub-stale")).toBeNull();
    expect(active.kind).toBe("ok");
    if (active.kind !== "ok") {
      throw new Error("expected active replay data");
    }
    expect(active.data.revisions[0]?.revisionId).toBe(asRevisionId(2));
  });

  test("stale rollback does not clear a newer active publication", async () => {
    const store = createMemoryStore();
    await store.saveReplayPublication(DOC, {
      publicationId: "pub-newer",
      parserVersion: PARSER_VERSION,
      revisions: [revision(3)],
      snapshots: [snapshot(0, createModel())],
      timeline: [],
      publishedAt: 3,
    });
    let stillCurrent = true;
    const setActiveReplayPublication = store.setActiveReplayPublication.bind(store);
    store.setActiveReplayPublication = async (docId, publicationId) => {
      await setActiveReplayPublication(docId, publicationId);
      if (publicationId === "pub-stale") {
        await setActiveReplayPublication(docId, "pub-newer");
        stillCurrent = false;
      }
    };

    const published = await publishDerivedData(
      store,
      DOC,
      { revisions: [revision(1)], snapshots: [snapshot(0, createModel())], timeline: [] },
      { publicationId: "pub-stale", shouldPublish: () => stillCurrent, now: () => 1 },
    );

    const active = await loadReplayData(store, DOC);

    expect(published).toBe(false);
    expect(await store.getReplayPublication(DOC, "pub-stale")).toBeNull();
    expect(active.kind).toBe("ok");
    if (active.kind !== "ok") {
      throw new Error("expected active replay data");
    }
    expect(active.data.revisions[0]?.revisionId).toBe(asRevisionId(3));
  });
});

describe("runPipelineSameThread", () => {
  test("writes one replay publication that loadReplayData then reads", async () => {
    const store = createMemoryStore();
    const body = { changelog: [{ ty: "is", s: "abc", ibi: 1, revision_id: 1 }] };
    await store.saveRawChunk({
      docId: DOC,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body,
    } satisfies RawPayload);

    const outcome = await runPipelineSameThread(store, DOC, { publicationId: "pub-pipeline" });

    expect(outcome.kind).toBe("published");
    expect(await store.getReplayPublication(DOC, "pub-pipeline")).not.toBeNull();
    expect(await store.getActiveReplayPublication(DOC)).not.toBeNull();
    expect(await store.getDecoded(DOC)).toEqual([]);
    const data = await loadOk("pub-pipeline", store);
    expect(data.revisions.length).toBeGreaterThan(0);
    const finalModel = modelAtRevisionIndex(data.replayIndex, data.revisions.length);
    expect(currentText(finalModel)).toBe("abc");
  });

  test("writes nothing and classifies an unsupported body", async () => {
    const store = createMemoryStore();
    await store.saveRawChunk({
      docId: DOC,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: { not_a_changelog: true },
    } satisfies RawPayload);

    const outcome = await runPipelineSameThread(store, DOC, { publicationId: "pub-unsupported" });

    expect(outcome).toEqual({ kind: "unsupported" });
    const data = await loadReplayData(store, DOC, "pub-unsupported");
    expect(data).toEqual({ kind: "missing-publication" });
    expect(await store.getReplayPublication(DOC, "pub-unsupported")).toBeNull();
  });

  test("classifies an empty raw-chunk set without publishing", async () => {
    const store = createMemoryStore();

    const outcome = await runPipelineSameThread(store, DOC, { publicationId: "pub-empty" });

    expect(outcome).toEqual({ kind: "empty" });
    expect(await store.getReplayPublication(DOC, "pub-empty")).toBeNull();
  });

  test("suppresses same-thread derived writes when the producing run is stale", async () => {
    const store = createMemoryStore();
    const body = { changelog: [{ ty: "is", s: "stale", ibi: 1, revision_id: 1 }] };
    await store.saveRawChunk({
      docId: DOC,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body,
    } satisfies RawPayload);

    const published = await runPipelineSameThread(store, DOC, {
      publicationId: "pub-stale",
      shouldPublish: () => false,
    });

    expect(published).toEqual({ kind: "stale" });
    expect(await store.getReplayPublication(DOC, "pub-stale")).toBeNull();
    expect(await store.getDecoded(DOC)).toEqual([]);
    expect(await store.getSnapshots(DOC)).toEqual([]);
    expect(await store.getTimeline(DOC)).toEqual([]);
  });

  test("raw deletion invalidates checkpoints so document growth re-fetches a complete replay", async () => {
    const store = createMemoryStore();
    const docId = asDocId("DocGrowthReplay");
    let upperBound = asRevisionId(2);
    const fetcher: ChunkFetcher = {
      async fetchChunk({ span }) {
        const changelog: Array<{ ty: "is"; s: string; ibi: number; revision_id: number }> = [];
        for (let revision = Number(span.start); revision <= Number(span.end); revision += 1) {
          changelog.push({ ty: "is", s: String(revision), ibi: revision, revision_id: revision });
        }
        return {
          ok: true as const,
          value: {
            docId,
            range: { requested: span, received: span },
            receivedAt: 0,
            body: { changelog },
          },
        };
      },
    };
    const discovery: RevisionRangeDiscovery = {
      strategy: "unconfirmed",
      async discoverUpperBound() {
        return upperBound;
      },
    };
    const deps = {
      fetcher,
      discovery,
      store,
      sleep: async () => {},
      now: () => 1,
    };

    await runRetrieval(deps, {
      docId,
      userIndex: null,
      cancellation: { isCancelled: () => false },
    });
    await runPipelineSameThread(store, docId, { publicationId: "pub-initial" });
    expect(
      (await store.getActiveReplayPublication(docId))?.revisions.map((r) => r.revisionId),
    ).toEqual([asRevisionId(1), asRevisionId(2)]);

    await store.deleteRawForDoc(docId);
    expect(await store.readCheckpoint(docId)).toBeNull();

    upperBound = asRevisionId(4);
    await runRetrieval(deps, {
      docId,
      userIndex: null,
      cancellation: { isCancelled: () => false },
    });
    const outcome = await runPipelineSameThread(store, docId, {
      publicationId: "pub-after-growth",
    });
    expect(outcome.kind).toBe("published");
    const loaded = await loadReplayData(store, docId);

    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") {
      throw new Error("expected active replay data");
    }
    expect(loaded.data.revisions.map((r) => r.revisionId)).toEqual([
      asRevisionId(1),
      asRevisionId(2),
      asRevisionId(3),
      asRevisionId(4),
    ]);
  });
});
