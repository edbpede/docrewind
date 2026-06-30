// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Docs snapshotting for efficient scrubbing (plan T4 / R3). A full linear replay
// is O(N) in revisions; to scrub to an arbitrary revision cheaply we cache a
// model snapshot every `SNAPSHOT_CADENCE` revisions and replay forward from the
// nearest one.
//
// The snapshot/replay MACHINERY itself is model-agnostic and now lives in the
// shared generic spine (`lib/replay-core/spine.ts`), consumed by both the Docs
// and Sheets cores. This module is the Docs ADAPTER over that spine: it binds
// the spine's injected deps to the Docs `DocumentModel` operations and KEEPS the
// historical public signatures (`buildReplayIndex(revisions, cadence?, baseOps?)`
// / `modelAtRevisionIndex(index, n)` / `textAtRevisionIndex(index, n)`) so every
// shipped call site (`App.tsx`, `replay/load.ts`) stays untouched.
// `snapshot.test.ts` pins the output byte-identical — the regression gate for
// the spine extraction.

import type { Operation } from "../decoder/types";
import type { DecodedRevision } from "../domain/model";
import {
  buildReplayIndex as buildSpineReplayIndex,
  modelAtRevisionIndex as modelAtSpineRevisionIndex,
  type ReplayDeps,
  type ReplayIndex as SpineReplayIndex,
} from "../replay-core/spine";
import { applyOperation, applyRevision } from "./apply";
import { BASE_REVISION, cloneModel, createModel, type DocumentModel } from "./model";
import { currentText } from "./text";

/** Revisions between snapshots. Tunable; fixed for deterministic test cost. */
export const SNAPSHOT_CADENCE = 100;

/**
 * The Docs replay index: the spine's generic index bound to the linear-text
 * `DocumentModel` + `DecodedRevision`. Structurally identical to the historical
 * interface (`{ revisions, cadence, snapshots }`), so existing consumers and
 * object literals are unchanged.
 */
export type ReplayIndex = SpineReplayIndex<DocumentModel, DecodedRevision>;

/** The Docs model operations injected into the shared spine. */
const DOCS_DEPS: ReplayDeps<DocumentModel, DecodedRevision> = {
  createModel,
  cloneModel,
  applyRevision,
};

/**
 * Build a Docs replay index by delegating to the shared spine with the Docs
 * deps. `baseOps` is the decoded `chunkedSnapshot` — pre-existing content that
 * predates the first changelog revision — applied under the pre-history revision
 * id as the spine's base seed, so `snapshot(0)` is the true base state. Empty
 * (the common case) reproduces the from-empty behaviour exactly.
 */
export function buildReplayIndex(
  revisions: readonly DecodedRevision[],
  cadence: number = SNAPSHOT_CADENCE,
  baseOps: readonly Operation[] = [],
): ReplayIndex {
  return buildSpineReplayIndex(revisions, DOCS_DEPS, cadence, (model) => {
    for (const op of baseOps) {
      applyOperation(model, op, BASE_REVISION);
    }
  });
}

/**
 * Reconstruct the model state after applying the first `n` revisions, starting
 * from the nearest snapshot and replaying forward. Returns a fresh model (the
 * cached snapshot is never mutated).
 */
export function modelAtRevisionIndex(index: ReplayIndex, n: number): DocumentModel {
  return modelAtSpineRevisionIndex(index, n, DOCS_DEPS);
}

/** The visible text after applying the first `n` revisions (snapshot-assisted). */
export function textAtRevisionIndex(index: ReplayIndex, n: number): string {
  return currentText(modelAtRevisionIndex(index, n));
}
