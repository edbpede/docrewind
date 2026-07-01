// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sheets snapshotting for efficient scrubbing (plan P1 / §7). The Sheets ADAPTER
// over the shared generic spine (`lib/core/replay-core/spine.ts`) — the SAME
// machinery the Docs core uses, so a spine change that breaks either core's
// pinned snapshot output fails CI (R8).
//
// The cadence is tuned INDEPENDENTLY of the linear-text `SNAPSHOT_CADENCE` (100):
// cloning a Map-of-Maps grid is heavier than cloning a flat `CharElement[]`, so
// `SHEETS_SNAPSHOT_CADENCE` starts smaller. Revisit after a real large-sheet
// perf pass.
//
// PURE: no browser / fetch / Worker.

import { PRE_HISTORY_REVISION } from "@/lib/core/domain/ids";
import {
  buildReplayIndex as buildSpineReplayIndex,
  modelAtRevisionIndex as modelAtSpineRevisionIndex,
  type ReplayDeps,
  type ReplayIndex as SpineReplayIndex,
} from "@/lib/core/replay-core/spine";
import type { SheetsDecodedRevision, SheetsOperation } from "@/lib/core/sheets/decoder/types";
import { applySheetsOperation, applySheetsRevision } from "./apply";
import { cloneModel, createModel, type GridModel } from "./model";

/** Revisions between grid snapshots. Smaller than the Docs cadence (heavier clone). */
export const SHEETS_SNAPSHOT_CADENCE = 25;

/** The Sheets replay index: the spine's generic index bound to the grid model. */
export type SheetsReplayIndex = SpineReplayIndex<GridModel, SheetsDecodedRevision>;

/** The grid model operations injected into the shared spine. */
const SHEETS_DEPS: ReplayDeps<GridModel, SheetsDecodedRevision> = {
  createModel,
  cloneModel,
  applyRevision: applySheetsRevision,
};

/**
 * Build a Sheets replay index by delegating to the shared spine with the grid
 * deps. `baseOps` is the decoded `chunkedSnapshot` (CAPTURE P-iii), seeded under
 * the pre-history revision id so `snapshot(0)` is the true base grid state.
 */
export function buildSheetsReplayIndex(
  revisions: readonly SheetsDecodedRevision[],
  cadence: number = SHEETS_SNAPSHOT_CADENCE,
  baseOps: readonly SheetsOperation[] = [],
): SheetsReplayIndex {
  return buildSpineReplayIndex(revisions, SHEETS_DEPS, cadence, (model) => {
    for (const op of baseOps) {
      applySheetsOperation(model, op, PRE_HISTORY_REVISION);
    }
  });
}

/**
 * Reconstruct the grid state after applying the first `n` revisions, starting
 * from the nearest snapshot and replaying forward. Returns a fresh grid (the
 * cached snapshot is never mutated).
 */
export function gridAtRevisionIndex(index: SheetsReplayIndex, n: number): GridModel {
  return modelAtSpineRevisionIndex(index, n, SHEETS_DEPS);
}
