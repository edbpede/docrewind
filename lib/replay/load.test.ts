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
import { createModel, type DocumentModel } from "../reconstruction/model";
import { modelAtRevisionIndex, SNAPSHOT_CADENCE } from "../reconstruction/snapshot";
import { currentText } from "../reconstruction/text";
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

  test("a late stale publication cannot overwrite the active publication", async () => {
    const store = createMemoryStore();
    await publishDerivedData(
      store,
      DOC,
      { revisions: [revision(2)], snapshots: [snapshot(0, createModel())], timeline: [] },
      { publicationId: "pub-current", now: () => 2 },
    );
    await publishDerivedData(
      store,
      DOC,
      { revisions: [revision(1)], snapshots: [snapshot(0, createModel())], timeline: [] },
      { publicationId: "pub-stale", now: () => 1 },
    );

    const current = await loadReplayData(store, DOC, "pub-current");
    const stale = await loadReplayData(store, DOC, "pub-stale");

    expect(current.kind).toBe("ok");
    expect(stale.kind).toBe("ok");
    if (current.kind !== "ok" || stale.kind !== "ok") {
      throw new Error("expected both publications to exist under exact ids");
    }
    expect(current.data.revisions[0]?.revisionId).toBe(asRevisionId(2));
    expect(stale.data.revisions[0]?.revisionId).toBe(asRevisionId(1));
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
});
