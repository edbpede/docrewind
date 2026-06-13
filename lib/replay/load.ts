// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay-page data loading (plan Phase 5 Seam B / Step 4). The page's load
// orchestration as PURE, Bun-testable functions over the `RevisionStore`
// interface — no DOM, no `browser.*`, no idb import. The replay App is a thin
// reactive view over these.
//
// ONE read path for both the Worker and the same-thread fallback: whichever path
// runs the pipeline publishes a single atomic replay-publication record, and the
// page then re-reads via `loadReplayData`. Legacy split decoded/snapshots/timeline
// stores are compatibility-only and are deliberately not consulted here.

import { PARSER_VERSION } from "../decoder/version";
import type { DecodedRevision, DocId, TimelineEvent } from "../domain/model";
import type { DocumentModel } from "../reconstruction/model";
import { type ReplayIndex, SNAPSHOT_CADENCE } from "../reconstruction/snapshot";
import type { ReplayPublication, RevisionStore, StoredSnapshot } from "../store";
import { runPipelineOverBodies } from "../worker/pipeline";

/** Everything the replay surface needs after a successful load. */
export interface ReplayData {
  readonly revisions: readonly DecodedRevision[];
  readonly timeline: readonly TimelineEvent[];
  readonly replayIndex: ReplayIndex;
}

export type ReplayLoadResult =
  | { readonly kind: "ok"; readonly data: ReplayData }
  | { readonly kind: "missing-publication" };

/** Plain structured-cloneable derived data ready for store publication. */
export interface ReplayDerivedData {
  readonly revisions: readonly DecodedRevision[];
  readonly snapshots: readonly StoredSnapshot[];
  readonly timeline: readonly TimelineEvent[];
}

export interface ReplayPublishOptions {
  readonly publicationId: string;
  readonly shouldPublish?: () => boolean;
  readonly now?: () => number;
}

export type DecodeOutcome =
  | { readonly kind: "published"; readonly revisionCount: number }
  | { readonly kind: "empty" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed" }
  | { readonly kind: "stale" };

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

/** Read one matching atomic replay publication and rebuild its replay index. */
export async function loadReplayData(
  store: RevisionStore,
  docId: DocId,
  expectedPublicationId: string,
): Promise<ReplayLoadResult> {
  const publication = await store.getReplayPublication(docId, expectedPublicationId);
  if (publication === null) {
    return { kind: "missing-publication" };
  }
  return {
    kind: "ok",
    data: {
      revisions: publication.revisions,
      timeline: publication.timeline,
      replayIndex: rebuildReplayIndex(publication.revisions, publication.snapshots),
    },
  };
}

/**
 * Persist the full replay artifact as one atomic publication after the caller
 * has proven the producing run is still current. The gate is checked immediately
 * before the single store write so stale same-thread work cannot publish after a
 * retry.
 */
export async function publishDerivedData(
  store: RevisionStore,
  docId: DocId,
  data: ReplayDerivedData,
  options: ReplayPublishOptions,
): Promise<boolean> {
  const shouldPublish = options.shouldPublish ?? (() => true);
  if (!shouldPublish()) return false;
  const publication: ReplayPublication = {
    publicationId: options.publicationId,
    parserVersion: PARSER_VERSION,
    revisions: data.revisions,
    snapshots: data.snapshots,
    timeline: data.timeline,
    publishedAt: options.now?.() ?? Date.now(),
  };
  await store.saveReplayPublication(docId, publication);
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
  options: ReplayPublishOptions,
): Promise<DecodeOutcome> {
  try {
    const chunks = await store.getRawChunks(docId);
    if (chunks.length === 0) {
      return { kind: "empty" };
    }
    const result = runPipelineOverBodies(chunks.map((chunk) => chunk.body));
    if (result.kind !== "ok") {
      return { kind: "unsupported" };
    }
    const snapshots: StoredSnapshot[] = [...result.replayIndex.snapshots.entries()].map(
      ([appliedCount, model]) => ({ appliedCount, model }),
    );
    const published = await publishDerivedData(
      store,
      docId,
      { revisions: result.revisions, snapshots, timeline: result.timeline },
      options,
    );
    return published
      ? { kind: "published", revisionCount: result.revisions.length }
      : { kind: "stale" };
  } catch {
    return { kind: "failed" };
  }
}
