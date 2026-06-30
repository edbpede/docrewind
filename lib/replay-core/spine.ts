// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generic replay-index spine (plan §1 Chosen-option / ADR). The model-agnostic
// machinery shared by BOTH the Docs and Sheets reconstruction cores: build a
// snapshot-cached replay index once (O(N)) and reconstruct the model at any
// revision cheaply by cloning the nearest snapshot and replaying forward.
//
// The only thing that differs between Docs (a flat `CharElement[]`) and Sheets
// (a tabbed Map-of-Maps grid) is the model `M`, the revision `R`, and the three
// operations over them — so those are INJECTED via `deps`. The optional
// `baseSeed` hook seeds pre-history/base content (the Docs `chunkedSnapshot`
// `baseOps` analogue, and the Sheets base payload per CAPTURE P-iii) into a
// fresh model before the changelog is replayed, so `snapshot(0)` is the true
// base state.
//
// PURE: no browser / fetch / Worker / DOM. Each core's snapshot test pins its
// own output, and because both exercise THIS module, a spine change that breaks
// either core's pinned output fails CI (plan R8).

/** The kind-specific model operations the spine replays. Injected by each core. */
export interface ReplayDeps<M, R> {
  /** A fresh, empty base model (an empty document / empty grid). */
  createModel(): M;
  /** A deep copy that the caller may mutate without touching the original. */
  cloneModel(model: M): M;
  /** Apply one decoded revision to the model in place. */
  applyRevision(model: M, revision: R): void;
}

/**
 * A built replay index: the revisions plus model snapshots keyed by the number
 * of revisions applied (0 = the BASE model after `baseSeed`). Generic over the
 * model `M` and revision `R` so each core reuses one builder + lookup.
 */
export interface ReplayIndex<M, R> {
  readonly revisions: readonly R[];
  readonly cadence: number;
  readonly snapshots: ReadonlyMap<number, M>;
}

/**
 * Build a replay index: seed the base, then apply every revision once, caching
 * a model snapshot every `cadence` revisions plus one at index 0 and one at the
 * end. O(N) over revisions (the base seed is paid once).
 *
 * `baseSeed` seeds pre-existing content into the fresh model BEFORE the
 * changelog so `snapshot(0)` is the true base state and every changelog op's
 * position addresses the content it assumes is already present. Omitting it
 * reproduces the from-empty behaviour exactly.
 */
export function buildReplayIndex<M, R>(
  revisions: readonly R[],
  deps: ReplayDeps<M, R>,
  cadence: number,
  baseSeed?: (model: M) => void,
): ReplayIndex<M, R> {
  const model = deps.createModel();
  if (baseSeed !== undefined) {
    baseSeed(model);
  }
  const snapshots = new Map<number, M>();
  snapshots.set(0, deps.cloneModel(model));
  for (let i = 0; i < revisions.length; i++) {
    const revision = revisions[i];
    if (revision !== undefined) {
      deps.applyRevision(model, revision);
    }
    const applied = i + 1;
    if (applied % cadence === 0) {
      snapshots.set(applied, deps.cloneModel(model));
    }
  }
  snapshots.set(revisions.length, deps.cloneModel(model));
  return { revisions, cadence, snapshots };
}

/** Find the cached snapshot with the largest applied-count ≤ `n`. */
function nearestSnapshotAtOrBefore<M, R>(
  index: ReplayIndex<M, R>,
  n: number,
  deps: ReplayDeps<M, R>,
): { applied: number; model: M } {
  let bestApplied = 0;
  for (const applied of index.snapshots.keys()) {
    if (applied <= n && applied > bestApplied) {
      bestApplied = applied;
    }
  }
  const model = index.snapshots.get(bestApplied);
  if (model === undefined) {
    return { applied: 0, model: deps.createModel() };
  }
  return { applied: bestApplied, model };
}

/**
 * Reconstruct the model state after applying the first `n` revisions, starting
 * from the nearest snapshot and replaying forward. Returns a fresh model (the
 * cached snapshot is never mutated).
 */
export function modelAtRevisionIndex<M, R>(
  index: ReplayIndex<M, R>,
  n: number,
  deps: ReplayDeps<M, R>,
): M {
  const clamped = Math.max(0, Math.min(n, index.revisions.length));
  const base = nearestSnapshotAtOrBefore(index, clamped, deps);
  const model = deps.cloneModel(base.model);
  for (let i = base.applied; i < clamped; i++) {
    const revision = index.revisions[i];
    if (revision !== undefined) {
      deps.applyRevision(model, revision);
    }
  }
  return model;
}
