// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Snapshotting for efficient scrubbing (plan T4 / R3). A full linear replay is
// O(N) in revisions; to scrub to an arbitrary revision cheaply we cache a model
// snapshot every `SNAPSHOT_CADENCE` revisions and replay forward from the
// nearest one. The cadence is a fixed, deterministic constant here; cost-aware /
// adaptive snapshotting is deferred to a later perf pass.

import type { Operation } from "../decoder/types";
import type { DecodedRevision } from "../domain/model";
import { applyOperation, applyRevision } from "./apply";
import { BASE_REVISION, cloneModel, createModel, type DocumentModel } from "./model";
import { currentText } from "./text";

/** Revisions between snapshots. Tunable; fixed for deterministic test cost. */
export const SNAPSHOT_CADENCE = 100;

export interface ReplayIndex {
  readonly revisions: readonly DecodedRevision[];
  readonly cadence: number;
  // Keyed by the number of revisions applied (0 = the BASE document — empty for a
  // doc authored from scratch, or the pre-existing template/base content when the
  // payload carried a chunkedSnapshot).
  readonly snapshots: ReadonlyMap<number, DocumentModel>;
}

/**
 * Build a replay index: apply all revisions once, caching a model snapshot every
 * `cadence` revisions plus one at the end. O(N) to build (the one-time base seed
 * is O(base size), paid once).
 *
 * `baseOps` is the decoded `chunkedSnapshot` — pre-existing content that predates
 * the first changelog revision (a template, a pre-filled assignment, or the
 * accumulated state when retrieval resumed mid-document). It is applied under the
 * pre-history revision id BEFORE the changelog, so `snapshot(0)` is the true base
 * state and every changelog op's 1-indexed live position addresses the content it
 * assumes is already present. Empty (the common case) reproduces the old behaviour
 * exactly. NOTE: a revision-1 `rplc` op (the live template-load shape) carries its
 * own base content in-band and seeds via the normal apply path, so base content
 * arrives through whichever channel the wire used.
 */
export function buildReplayIndex(
  revisions: readonly DecodedRevision[],
  cadence: number = SNAPSHOT_CADENCE,
  baseOps: readonly Operation[] = [],
): ReplayIndex {
  const model = createModel();
  for (const op of baseOps) {
    applyOperation(model, op, BASE_REVISION);
  }
  const snapshots = new Map<number, DocumentModel>();
  snapshots.set(0, cloneModel(model));
  for (let i = 0; i < revisions.length; i++) {
    const revision = revisions[i];
    if (revision !== undefined) {
      applyRevision(model, revision);
    }
    const applied = i + 1;
    if (applied % cadence === 0) {
      snapshots.set(applied, cloneModel(model));
    }
  }
  snapshots.set(revisions.length, cloneModel(model));
  return { revisions, cadence, snapshots };
}

/** Find the cached snapshot with the largest applied-count ≤ `n`. */
function nearestSnapshotAtOrBefore(
  index: ReplayIndex,
  n: number,
): { applied: number; model: DocumentModel } {
  let bestApplied = 0;
  for (const applied of index.snapshots.keys()) {
    if (applied <= n && applied > bestApplied) {
      bestApplied = applied;
    }
  }
  const model = index.snapshots.get(bestApplied);
  if (model === undefined) {
    return { applied: 0, model: createModel() };
  }
  return { applied: bestApplied, model };
}

/**
 * Reconstruct the model state after applying the first `n` revisions, starting
 * from the nearest snapshot and replaying forward. Returns a fresh model (the
 * cached snapshot is never mutated).
 */
export function modelAtRevisionIndex(index: ReplayIndex, n: number): DocumentModel {
  const clamped = Math.max(0, Math.min(n, index.revisions.length));
  const base = nearestSnapshotAtOrBefore(index, clamped);
  const model = cloneModel(base.model);
  for (let i = base.applied; i < clamped; i++) {
    const revision = index.revisions[i];
    if (revision !== undefined) {
      applyRevision(model, revision);
    }
  }
  return model;
}

/** The visible text after applying the first `n` revisions (snapshot-assisted). */
export function textAtRevisionIndex(index: ReplayIndex, n: number): string {
  return currentText(modelAtRevisionIndex(index, n));
}
