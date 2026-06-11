// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay decode pipeline (plan §1.7 / PRD §9.4, §10.9). PURE and browser/Worker-
// free: rawBody → parseFramed → detectSchema → (unknown ⇒ diagnostic, never
// throws) → decodeOperations → buildReplayIndex + deriveTimeline. All the heavy
// decode/reconstruct/timeline logic lives HERE so the Web Worker shell stays a
// thin transport wrapper and the logic is unit-testable under Bun.

import { decodeOperations } from "../decoder/decode";
import type { DecodedRevision, TimelineEvent } from "../domain/model";
import { parseFramed } from "../protocol/framing";
import { detectSchema } from "../protocol/schema-detect";
import { buildReplayIndex, type ReplayIndex } from "../reconstruction/snapshot";
import { deriveTimeline } from "../timeline/derive";

/** Why a body could not be decoded (content-free, privacy-safe). */
export type UnsupportedReason = "parse-error" | "unknown-schema";

/** A fully decoded pipeline result, ready to persist + render. */
export interface PipelineSuccess {
  readonly kind: "ok";
  readonly revisions: readonly DecodedRevision[];
  readonly replayIndex: ReplayIndex;
  readonly timeline: readonly TimelineEvent[];
  /** Count of chunks that failed to decode and were skipped (0 for a single body). */
  readonly skippedChunks: number;
}

/** The body/bodies could not be decoded at all. */
export interface PipelineUnsupported {
  readonly kind: "unsupported";
  readonly reason: UnsupportedReason;
}

export type PipelineResult = PipelineSuccess | PipelineUnsupported;

/** Parse + schema-gate one raw body into revisions, or an unsupported reason. */
function decodeBody(rawBody: unknown): readonly DecodedRevision[] | UnsupportedReason {
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
  return decodeOperations(parsed);
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
  let skippedChunks = 0;
  let firstReason: UnsupportedReason | null = null;

  for (const body of bodies) {
    const decoded = decodeBody(body);
    if (decoded === "parse-error" || decoded === "unknown-schema") {
      skippedChunks += 1;
      firstReason ??= decoded;
      continue;
    }
    revisions.push(...decoded);
  }

  if (revisions.length === 0 && firstReason !== null) {
    return { kind: "unsupported", reason: firstReason };
  }

  return {
    kind: "ok",
    revisions,
    replayIndex: buildReplayIndex(revisions),
    timeline: deriveTimeline(revisions),
    skippedChunks,
  };
}
