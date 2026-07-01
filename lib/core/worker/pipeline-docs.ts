// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay decode pipeline — DOCS core (plan §1.7 / PRD §9.4, §10.9). PURE and
// browser/Worker-free: rawBody → parseFramed → detectSchema → (unknown ⇒
// diagnostic, never throws) → decodeOperations → buildReplayIndex +
// deriveTimeline. All the heavy decode/reconstruct/timeline logic lives HERE so
// the Web Worker shell stays a thin transport wrapper and the logic is
// unit-testable under Bun. Kept in its own module (not the pipeline barrel) so
// kind-routed consumers load only this editor core.

import { decodeOperations, decodeSnapshot } from "@/lib/core/docs/decoder/decode";
import type { Operation } from "@/lib/core/docs/decoder/types";
import {
  buildReplayIndex,
  type ReplayIndex,
  SNAPSHOT_CADENCE,
} from "@/lib/core/docs/reconstruction/snapshot";
import type { DecodedRevision, TimelineEvent } from "@/lib/core/domain/model";
import { parseFramed } from "@/lib/core/protocol/framing";
import { detectSchema } from "@/lib/core/protocol/schema-detect";
import { deriveTimeline } from "@/lib/core/timeline/derive";
import type { PipelineUnsupported, UnsupportedReason } from "./pipeline-shared";

/** A fully decoded pipeline result, ready to persist + render. */
export interface PipelineSuccess {
  readonly kind: "ok";
  readonly revisions: readonly DecodedRevision[];
  readonly replayIndex: ReplayIndex;
  readonly timeline: readonly TimelineEvent[];
  /** Count of chunks that failed to decode and were skipped (0 for a single body). */
  readonly skippedChunks: number;
}

export type PipelineResult = PipelineSuccess | PipelineUnsupported;

/** One decodable body: its changelog revisions plus its base-state snapshot ops. */
interface DecodedBody {
  readonly revisions: readonly DecodedRevision[];
  readonly snapshotOps: readonly Operation[];
}

/**
 * Parse + schema-gate one raw body into revisions + snapshot, or a reason.
 * The snapshot is decoded only when `withSnapshot` is set; the caller seeds the
 * base from the first decodable body alone, so decoding later snapshots would do
 * a full `chunkedSnapshot` traversal whose result is immediately discarded.
 */
function decodeBody(rawBody: unknown, withSnapshot: boolean): DecodedBody | UnsupportedReason {
  let parsed: unknown;
  try {
    // A string body is `)]}'`-framed wire text; an object body is already JSON.
    parsed = typeof rawBody === "string" ? parseFramed(rawBody) : rawBody;
  } catch {
    return "parse-error";
  }
  if (detectSchema(parsed).kind === "unknown") {
    return "unknown-schema";
  }
  return {
    revisions: decodeOperations(parsed),
    snapshotOps: withSnapshot ? decodeSnapshot(parsed) : [],
  };
}

/** Run the full pipeline over a single raw chunk body. Never throws. */
export function runPipeline(rawBody: unknown): PipelineResult {
  return runPipelineOverBodies([rawBody]);
}

/**
 * Run the full pipeline over several raw chunk bodies (document order),
 * concatenating decoded revisions and building one replay index + timeline.
 * Unsupported chunks are skipped, not fatal; if EVERY chunk is unsupported the
 * result is `unsupported` carrying the first reason seen. Never throws.
 */
export function runPipelineOverBodies(bodies: readonly unknown[]): PipelineResult {
  const revisions: DecodedRevision[] = [];
  let baseOps: readonly Operation[] = [];
  let baseCaptured = false;
  let decodedAny = false;
  let skippedChunks = 0;
  let firstReason: UnsupportedReason | null = null;

  for (const body of bodies) {
    // Only the first decodable body's snapshot is kept (see below), so skip the
    // redundant snapshot decode for the rest.
    const decoded = decodeBody(body, !baseCaptured);
    if (decoded === "parse-error" || decoded === "unknown-schema") {
      skippedChunks += 1;
      firstReason ??= decoded;
      continue;
    }
    decodedAny = true;
    // The FIRST decodable body's chunkedSnapshot is the base for the whole run:
    // it is the state before that body's first changelog revision. Later bodies'
    // snapshots are redundant with earlier bodies' changelogs, so seeding from
    // every body would double-count the base — seed from the first one only.
    if (!baseCaptured) {
      baseOps = decoded.snapshotOps;
      baseCaptured = true;
    }
    revisions.push(...decoded.revisions);
  }

  // Unsupported only when NOTHING decoded — a body that decodes to an empty
  // changelog is still a success, so gate on `decodedAny`, not revision count.
  if (!decodedAny && firstReason !== null) {
    return { kind: "unsupported", reason: firstReason };
  }

  return {
    kind: "ok",
    revisions,
    replayIndex: buildReplayIndex(revisions, SNAPSHOT_CADENCE, baseOps),
    timeline: deriveTimeline(revisions),
    skippedChunks,
  };
}
