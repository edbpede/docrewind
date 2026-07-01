// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides snapshotting for efficient scrubbing. The Slides ADAPTER over the shared
// generic spine (`lib/core/replay-core/spine.ts`) — the SAME machinery the Docs and
// Sheets cores use, so a spine change that breaks any core's pinned snapshot output
// fails CI.
//
// PURE: no browser / fetch / Worker.

import {
  buildReplayIndex as buildSpineReplayIndex,
  modelAtRevisionIndex as modelAtSpineRevisionIndex,
  type ReplayDeps,
  type ReplayIndex as SpineReplayIndex,
} from "@/lib/core/replay-core/spine";
import type { SlidesDecodedRevision, SlidesOperation } from "@/lib/core/slides/decoder/types";
import { applySlidesOperation, applySlidesRevision } from "./apply";
import { cloneModel, createModel, type PresentationModel } from "./model";

/** Revisions between snapshots. Slides decks are small; a low cadence is cheap. */
export const SLIDES_SNAPSHOT_CADENCE = 20;

/** The Slides replay index: the spine's generic index bound to the presentation model. */
export type SlidesReplayIndex = SpineReplayIndex<PresentationModel, SlidesDecodedRevision>;

/** The presentation model operations injected into the shared spine. */
const SLIDES_DEPS: ReplayDeps<PresentationModel, SlidesDecodedRevision> = {
  createModel,
  cloneModel,
  applyRevision: applySlidesRevision,
};

/**
 * Build a Slides replay index by delegating to the shared spine with the
 * presentation deps. `baseOps` is the decoded `chunkedSnapshot`, seeded under the
 * pre-history revision id so `snapshot(0)` is the true base presentation state
 * (the initial slide/master/layout pages).
 */
export function buildSlidesReplayIndex(
  revisions: readonly SlidesDecodedRevision[],
  cadence: number = SLIDES_SNAPSHOT_CADENCE,
  baseOps: readonly SlidesOperation[] = [],
): SlidesReplayIndex {
  return buildSpineReplayIndex(revisions, SLIDES_DEPS, cadence, (model) => {
    for (const op of baseOps) {
      applySlidesOperation(model, op);
    }
  });
}

/**
 * Reconstruct the presentation state after applying the first `n` revisions,
 * starting from the nearest snapshot and replaying forward. Returns a fresh model
 * (the cached snapshot is never mutated).
 */
export function presentationAtRevisionIndex(
  index: SlidesReplayIndex,
  n: number,
): PresentationModel {
  return modelAtSpineRevisionIndex(index, n, SLIDES_DEPS);
}
