// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay decode pipeline (plan §1.7 / PRD §9.4, §10.9). PURE and browser/Worker-
// free: rawBody → parseFramed → detectSchema → (unknown ⇒ diagnostic, never
// throws) → decodeOperations → buildReplayIndex + deriveTimeline. All the heavy
// decode/reconstruct/timeline logic lives HERE so the Web Worker shell stays a
// thin transport wrapper and the logic is unit-testable under Bun.

import { decodeOperations, decodeSnapshot } from "../decoder/decode";
import type { Operation } from "../decoder/types";
import type { DecodedRevision, TimelineEvent } from "../domain/model";
import { parseFramed } from "../protocol/framing";
import { detectSchema } from "../protocol/schema-detect";
import { buildReplayIndex, type ReplayIndex, SNAPSHOT_CADENCE } from "../reconstruction/snapshot";
import { decodeSheetsOperations, decodeSheetsSnapshot } from "../sheets-decoder/decode";
import type { SheetsDecodedRevision, SheetsOperation } from "../sheets-decoder/types";
import { deriveSheetsTimeline } from "../sheets-reconstruction/derive";
import {
  buildSheetsReplayIndex,
  SHEETS_SNAPSHOT_CADENCE,
  type SheetsReplayIndex,
} from "../sheets-reconstruction/snapshot";
import { decodeSlidesOperations, decodeSlidesSnapshot } from "../slides-decoder/decode";
import type { SlidesDecodedRevision, SlidesOperation } from "../slides-decoder/types";
import { deriveSlidesTimeline } from "../slides-reconstruction/derive";
import {
  buildSlidesReplayIndex,
  SLIDES_SNAPSHOT_CADENCE,
  type SlidesReplayIndex,
} from "../slides-reconstruction/snapshot";
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

// --- Sheets pipeline (parallel to the Docs pipeline above) -------------------

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
 * Mirrors {@link runPipelineOverBodies}: unsupported chunks are skipped, the
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

// --- Slides pipeline (parallel to the Docs pipeline above) -------------------

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
 * Mirrors {@link runPipelineOverBodies}: unsupported chunks are skipped, the
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
