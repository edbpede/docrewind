// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay-page data loading (plan Phase 5 Seam B / Step 4). The page's load
// orchestration as PURE, Bun-testable functions over the `RevisionStore`
// interface — no DOM, no `browser.*`, no idb import. The replay App is a thin
// reactive view over these.
//
// ONE read path for both the Worker and the same-thread fallback: whichever path
// runs the pipeline WRITES decoded/snapshots/timeline to the store, and the page
// then re-reads via `loadReplayData`. `rebuildReplayIndex` reconstructs the
// in-memory `ReplayIndex` (snapshots array → `Map`) so `modelAtRevisionIndex`
// can scrub cheaply.

import type { DecodedRevision, DocId, TimelineEvent } from "../domain/model";
import type { DocumentModel } from "../reconstruction/model";
import { type ReplayIndex, SNAPSHOT_CADENCE } from "../reconstruction/snapshot";
import type { RevisionStore, StoredSnapshot } from "../store";
import { runPipelineOverBodies } from "../worker/pipeline";

/** Everything the replay surface needs after a successful load. */
export interface ReplayData {
  readonly revisions: readonly DecodedRevision[];
  readonly timeline: readonly TimelineEvent[];
  readonly replayIndex: ReplayIndex;
}

/** Plain structured-cloneable derived data ready for store publication. */
export interface ReplayDerivedData {
  readonly revisions: readonly DecodedRevision[];
  readonly snapshots: readonly StoredSnapshot[];
  readonly timeline: readonly TimelineEvent[];
}

/**
 * Rebuild a `ReplayIndex` from persisted decoded revisions + snapshots. The
 * snapshot map is keyed by applied-count (`StoredSnapshot.appliedCount → model`).
 *
 * NOTE: `cadence` is carried only to satisfy the `ReplayIndex` shape — lookup
 * (`modelAtRevisionIndex` / `nearestSnapshotAtOrBefore`) reads `snapshots.keys()`
 * only, never `cadence`. `StoredSnapshot` has no cadence field, so we never read
 * cadence "from snapshots"; we restate the build-time constant.
 */
export function rebuildReplayIndex(
  decoded: readonly DecodedRevision[],
  snapshots: readonly StoredSnapshot[],
): ReplayIndex {
  const map = new Map<number, DocumentModel>(snapshots.map((s) => [s.appliedCount, s.model]));
  return { revisions: decoded, cadence: SNAPSHOT_CADENCE, snapshots: map };
}

/** Read decoded/snapshots/timeline for a document and rebuild its replay index. */
export async function loadReplayData(store: RevisionStore, docId: DocId): Promise<ReplayData> {
  const [revisions, snapshots, timeline] = await Promise.all([
    store.getDecoded(docId),
    store.getSnapshots(docId),
    store.getTimeline(docId),
  ]);
  return { revisions, timeline, replayIndex: rebuildReplayIndex(revisions, snapshots) };
}

/**
 * Persist decoded/snapshots/timeline after a caller has proven the producing
 * run is still current. The optional gate is re-checked immediately before each
 * write so stale same-thread work cannot continue publishing after a retry.
 */
export async function publishDerivedData(
  store: RevisionStore,
  docId: DocId,
  data: ReplayDerivedData,
  shouldPublish: () => boolean = () => true,
): Promise<boolean> {
  if (!shouldPublish()) return false;
  await store.saveDecoded(docId, data.revisions);
  if (!shouldPublish()) return false;
  await store.saveSnapshots(docId, data.snapshots);
  if (!shouldPublish()) return false;
  await store.saveTimeline(docId, data.timeline);
  return shouldPublish();
}

/**
 * Same-thread fallback for when `Worker` is unavailable (or injected off in
 * tests): run the PURE pipeline over the stored raw chunk bodies and publish
 * decoded/snapshots/timeline only if the producing replay run is still current.
 * An unsupported/empty result writes nothing; the page then observes empty
 * decoded data and surfaces that.
 */
export async function runPipelineSameThread(
  store: RevisionStore,
  docId: DocId,
  options: { readonly shouldPublish?: () => boolean } = {},
): Promise<boolean> {
  const chunks = await store.getRawChunks(docId);
  const result = runPipelineOverBodies(chunks.map((chunk) => chunk.body));
  if (result.kind !== "ok") {
    return false;
  }
  const snapshots: StoredSnapshot[] = [...result.replayIndex.snapshots.entries()].map(
    ([appliedCount, model]) => ({ appliedCount, model }),
  );
  return publishDerivedData(
    store,
    docId,
    { revisions: result.revisions, snapshots, timeline: result.timeline },
    options.shouldPublish,
  );
}
