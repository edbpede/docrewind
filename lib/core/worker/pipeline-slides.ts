// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay decode pipeline — SLIDES core (parallel to pipeline-docs.ts; see the
// module note there). PURE and browser/Worker-free; kept in its own module so
// kind-routed consumers load only the Slides editor core.

import type { TimelineEvent } from "@/lib/core/domain/model";
import { parseFramed } from "@/lib/core/protocol/framing";
import { detectSchema } from "@/lib/core/protocol/schema-detect";
import { decodeSlidesOperations, decodeSlidesSnapshot } from "@/lib/core/slides/decoder/decode";
import type { SlidesDecodedRevision, SlidesOperation } from "@/lib/core/slides/decoder/types";
import { deriveSlidesTimeline } from "@/lib/core/slides/reconstruction/derive";
import {
  buildSlidesReplayIndex,
  SLIDES_SNAPSHOT_CADENCE,
  type SlidesReplayIndex,
} from "@/lib/core/slides/reconstruction/snapshot";
import type { PipelineUnsupported, UnsupportedReason } from "./pipeline-shared";

/** A fully decoded Slides pipeline result, ready to persist + render. */
export interface SlidesPipelineSuccess {
  readonly kind: "ok";
  readonly revisions: readonly SlidesDecodedRevision[];
  readonly replayIndex: SlidesReplayIndex;
  readonly timeline: readonly TimelineEvent[];
  readonly skippedChunks: number;
}

export type SlidesPipelineResult = SlidesPipelineSuccess | PipelineUnsupported;

/** One decodable Slides body: its changelog revisions + base-state snapshot ops. */
interface DecodedSlidesBody {
  readonly revisions: readonly SlidesDecodedRevision[];
  readonly snapshotOps: readonly SlidesOperation[];
}

function decodeSlidesBody(
  rawBody: unknown,
  withSnapshot: boolean,
): DecodedSlidesBody | UnsupportedReason {
  let parsed: unknown;
  try {
    parsed = typeof rawBody === "string" ? parseFramed(rawBody) : rawBody;
  } catch {
    return "parse-error";
  }
  if (detectSchema(parsed).kind === "unknown") {
    return "unknown-schema";
  }
  return {
    revisions: decodeSlidesOperations(parsed),
    snapshotOps: withSnapshot ? decodeSlidesSnapshot(parsed) : [],
  };
}

/**
 * Run the full Slides pipeline over several raw chunk bodies (document order).
 * Mirrors the Docs `runPipelineOverBodies`: unsupported chunks are skipped, the
 * first decodable body's `chunkedSnapshot` seeds the base, and the result carries
 * one presentation replay index + timeline. Never throws.
 */
export function runSlidesPipelineOverBodies(bodies: readonly unknown[]): SlidesPipelineResult {
  const revisions: SlidesDecodedRevision[] = [];
  let baseOps: readonly SlidesOperation[] = [];
  let baseCaptured = false;
  let decodedAny = false;
  let skippedChunks = 0;
  let firstReason: UnsupportedReason | null = null;

  for (const body of bodies) {
    const decoded = decodeSlidesBody(body, !baseCaptured);
    if (decoded === "parse-error" || decoded === "unknown-schema") {
      skippedChunks += 1;
      firstReason ??= decoded;
      continue;
    }
    decodedAny = true;
    if (!baseCaptured) {
      baseOps = decoded.snapshotOps;
      baseCaptured = true;
    }
    revisions.push(...decoded.revisions);
  }

  if (!decodedAny && firstReason !== null) {
    return { kind: "unsupported", reason: firstReason };
  }

  return {
    kind: "ok",
    revisions,
    replayIndex: buildSlidesReplayIndex(revisions, SLIDES_SNAPSHOT_CADENCE, baseOps),
    timeline: deriveSlidesTimeline(revisions),
    skippedChunks,
  };
}

/** Run the Slides pipeline over a single raw chunk body. Never throws. */
export function runSlidesPipeline(rawBody: unknown): SlidesPipelineResult {
  return runSlidesPipelineOverBodies([rawBody]);
}
