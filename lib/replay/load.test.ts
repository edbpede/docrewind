// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit test for the pure replay loader (plan Phase 5 §3). Exercises the three
// functions against the in-memory `RevisionStore` twin: the snapshot-map keying,
// the seeded round-trip, and the same-thread pipeline → re-read single path.

import { describe, expect, test } from "bun:test";
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
      await runPipelineSameThread(store, DOC);
      const data = await loadReplayData(store, DOC);
      const finalModel = modelAtRevisionIndex(data.replayIndex, data.revisions.length);
      expect(currentText(finalModel)).toBe("hello world");
    })();
  });
});

describe("loadReplayData", () => {
  test("round-trips seeded decoded/snapshots/timeline", async () => {
    const store = createMemoryStore();
    const decoded = [revision(1)];
    await store.saveDecoded(DOC, decoded);
    await store.saveSnapshots(DOC, [snapshot(0, createModel())]);
    await store.saveTimeline(DOC, []);
    const data = await loadReplayData(store, DOC);
    expect(data.revisions).toHaveLength(1);
    expect(data.timeline).toEqual([]);
    expect(data.replayIndex.snapshots.has(0)).toBe(true);
  });

  test("returns empty data when nothing is stored (never throws on a miss)", async () => {
    const store = createMemoryStore();
    const data = await loadReplayData(store, asDocId("EmptyDoc"));
    expect(data.revisions).toEqual([]);
    expect(data.replayIndex.revisions).toEqual([]);
  });
});

describe("runPipelineSameThread", () => {
  test("writes decoded/snapshots/timeline that loadReplayData then reads (one path)", async () => {
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

    await runPipelineSameThread(store, DOC);

    const data = await loadReplayData(store, DOC);
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

    await runPipelineSameThread(store, DOC);

    const data = await loadReplayData(store, DOC);
    expect(data.revisions).toEqual([]);
  });
});
