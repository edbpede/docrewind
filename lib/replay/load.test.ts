// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit test for the pure replay loader (plan Phase 5 §3). Exercises the three
// functions against the in-memory `RevisionStore` twin: the snapshot-map keying,
// the seeded round-trip, and the same-thread pipeline → re-read single path.

import { describe, expect, test } from "bun:test";
import { PARSER_VERSION } from "../decoder/version";
import { createMemoryStore } from "../db.memory";
import { asDocId, asRevisionId } from "../domain/ids";
import type { DecodedRevision, RawPayload } from "../domain/model";
import { createModel, type DocumentModel } from "../reconstruction/model";
import { modelAtRevisionIndex, SNAPSHOT_CADENCE } from "../reconstruction/snapshot";
import { currentText } from "../reconstruction/text";
import type { StoredSnapshot } from "../store";
import { loadReplayData, rebuildReplayIndex, runPipelineSameThread } from "./load";

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
      const data = await loadReplayData(store, DOC, "pub-scrub");
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

    const data = await loadReplayData(store, DOC, "pub-fresh");

    expect(data.revisions).toHaveLength(1);
    expect(data.revisions[0]?.revisionId).toBe(asRevisionId(1));
    expect(data.timeline).toEqual([]);
    expect(data.replayIndex.snapshots.has(0)).toBe(true);
  });

  test("ignores legacy split stores when no matching publication exists", async () => {
    const store = createMemoryStore();
    await store.saveDecoded(DOC, [revision(1)]);
    await store.saveSnapshots(DOC, [snapshot(0, createModel())]);
    await store.saveTimeline(DOC, []);

    const data = await loadReplayData(store, DOC, "missing-pub");

    expect(data.revisions).toEqual([]);
    expect(data.timeline).toEqual([]);
    expect(data.replayIndex.revisions).toEqual([]);
  });

  test("returns empty data for the wrong publication id", async () => {
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

    expect(data.revisions).toEqual([]);
    expect(data.replayIndex.revisions).toEqual([]);
  });

  test("returns empty data when nothing is published (never throws on a miss)", async () => {
    const store = createMemoryStore();
    const data = await loadReplayData(store, asDocId("EmptyDoc"), "missing-pub");
    expect(data.revisions).toEqual([]);
    expect(data.replayIndex.revisions).toEqual([]);
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

    await runPipelineSameThread(store, DOC, { publicationId: "pub-pipeline" });

    expect(await store.getReplayPublication(DOC, "pub-pipeline")).not.toBeNull();
    expect(await store.getDecoded(DOC)).toEqual([]);
    const data = await loadReplayData(store, DOC, "pub-pipeline");
    expect(data.revisions.length).toBeGreaterThan(0);
    const finalModel = modelAtRevisionIndex(data.replayIndex, data.revisions.length);
    expect(currentText(finalModel)).toBe("abc");
  });

  test("writes nothing for an unsupported body (page then sees empty data)", async () => {
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

    await runPipelineSameThread(store, DOC, { publicationId: "pub-unsupported" });

    const data = await loadReplayData(store, DOC, "pub-unsupported");
    expect(data.revisions).toEqual([]);
    expect(await store.getReplayPublication(DOC, "pub-unsupported")).toBeNull();
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

    expect(published).toBe(false);
    expect(await store.getReplayPublication(DOC, "pub-stale")).toBeNull();
    expect(await store.getDecoded(DOC)).toEqual([]);
    expect(await store.getSnapshots(DOC)).toEqual([]);
    expect(await store.getTimeline(DOC)).toEqual([]);
  });
});
