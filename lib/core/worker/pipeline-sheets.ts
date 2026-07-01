// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay decode pipeline — SHEETS core (parallel to pipeline-docs.ts; see the
// module note there). PURE and browser/Worker-free; kept in its own module so
// kind-routed consumers load only the Sheets editor core.

import type { TimelineEvent } from "@/lib/core/domain/model";
import { parseFramed } from "@/lib/core/protocol/framing";
import { detectSchema } from "@/lib/core/protocol/schema-detect";
import { decodeSheetsOperations, decodeSheetsSnapshot } from "@/lib/core/sheets/decoder/decode";
import type { SheetsDecodedRevision, SheetsOperation } from "@/lib/core/sheets/decoder/types";
import { deriveSheetsTimeline } from "@/lib/core/sheets/reconstruction/derive";
import {
  buildSheetsReplayIndex,
  SHEETS_SNAPSHOT_CADENCE,
  type SheetsReplayIndex,
} from "@/lib/core/sheets/reconstruction/snapshot";
import type { PipelineUnsupported, UnsupportedReason } from "./pipeline-shared";

/** A fully decoded Sheets pipeline result, ready to persist + render. */
export interface SheetsPipelineSuccess {
  readonly kind: "ok";
  readonly revisions: readonly SheetsDecodedRevision[];
  readonly replayIndex: SheetsReplayIndex;
  readonly timeline: readonly TimelineEvent[];
  readonly skippedChunks: number;
}

export type SheetsPipelineResult = SheetsPipelineSuccess | PipelineUnsupported;

/** One decodable Sheets body: its changelog revisions + base-state snapshot ops. */
interface DecodedSheetsBody {
  readonly revisions: readonly SheetsDecodedRevision[];
  readonly snapshotOps: readonly SheetsOperation[];
}

function decodeSheetsBody(
  rawBody: unknown,
  withSnapshot: boolean,
): DecodedSheetsBody | UnsupportedReason {
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
    revisions: decodeSheetsOperations(parsed),
    snapshotOps: withSnapshot ? decodeSheetsSnapshot(parsed) : [],
  };
}

/**
 * Run the full Sheets pipeline over several raw chunk bodies (document order).
 * Mirrors the Docs `runPipelineOverBodies`: unsupported chunks are skipped, the
 * first decodable body's `chunkedSnapshot` seeds the base, and the result carries
 * one grid replay index + timeline. Never throws.
 */
export function runSheetsPipelineOverBodies(bodies: readonly unknown[]): SheetsPipelineResult {
  const revisions: SheetsDecodedRevision[] = [];
  let baseOps: readonly SheetsOperation[] = [];
  let baseCaptured = false;
  let decodedAny = false;
  let skippedChunks = 0;
  let firstReason: UnsupportedReason | null = null;

  for (const body of bodies) {
    const decoded = decodeSheetsBody(body, !baseCaptured);
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
    replayIndex: buildSheetsReplayIndex(revisions, SHEETS_SNAPSHOT_CADENCE, baseOps),
    timeline: deriveSheetsTimeline(revisions),
    skippedChunks,
  };
}

/** Run the Sheets pipeline over a single raw chunk body. Never throws. */
export function runSheetsPipeline(rawBody: unknown): SheetsPipelineResult {
  return runSheetsPipelineOverBodies([rawBody]);
}
