// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Snapshotting for efficient scrubbing (plan T4 / R3). A full linear replay is
// O(N) in revisions; to scrub to an arbitrary revision cheaply we cache a model
// snapshot every `SNAPSHOT_CADENCE` revisions and replay forward from the
// nearest one. The cadence is a fixed, deterministic constant here; cost-aware /
// adaptive snapshotting is deferred to a later perf pass.

import type { DecodedRevision } from "../domain/model";
import { applyRevision } from "./apply";
import { cloneModel, createModel, type DocumentModel } from "./model";
import { currentText } from "./text";

/** Revisions between snapshots. Tunable; fixed for deterministic test cost. */
export const SNAPSHOT_CADENCE = 100;

export interface ReplayIndex {
  readonly revisions: readonly DecodedRevision[];
  readonly cadence: number;
  // Keyed by the number of revisions applied (0 = empty doc).
  readonly snapshots: ReadonlyMap<number, DocumentModel>;
}

/**
 * Build a replay index: apply all revisions once, caching a model snapshot every
 * `cadence` revisions plus one at the end. O(N) to build.
 */
export function buildReplayIndex(
  revisions: readonly DecodedRevision[],
  cadence: number = SNAPSHOT_CADENCE,
): ReplayIndex {
  const model = createModel();
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
