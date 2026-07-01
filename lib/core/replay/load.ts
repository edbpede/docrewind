// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay-page data loading (plan Phase 5 Seam B / Step 4). The page's load
// orchestration as PURE, Bun-testable functions over the `RevisionStore`
// interface — no DOM, no `browser.*`, no idb import. The replay App is a thin
// reactive view over these.
//
// ONE read path for both the Worker and the same-thread fallback: whichever path
// runs the pipeline publishes a single atomic replay-publication record, and the
// page then re-reads via `loadReplayData`. Legacy split decoded/snapshots/timeline
// stores are compatibility-only and are deliberately not consulted here.

import { PARSER_VERSION } from "@/lib/core/docs/decoder/version";
import type { DocumentModel } from "@/lib/core/docs/reconstruction/model";
import { type ReplayIndex, SNAPSHOT_CADENCE } from "@/lib/core/docs/reconstruction/snapshot";
import type { DecodedRevision, DocId, TimelineEvent } from "@/lib/core/domain/model";
import type { SheetsDecodedRevision } from "@/lib/core/sheets/decoder/types";
import { SHEETS_PARSER_VERSION } from "@/lib/core/sheets/decoder/version";
import type { GridModel } from "@/lib/core/sheets/reconstruction/model";
import {
  SHEETS_SNAPSHOT_CADENCE,
  type SheetsReplayIndex,
} from "@/lib/core/sheets/reconstruction/snapshot";
import type { SlidesDecodedRevision } from "@/lib/core/slides/decoder/types";
import { SLIDES_PARSER_VERSION } from "@/lib/core/slides/decoder/version";
import type { PresentationModel } from "@/lib/core/slides/reconstruction/model";
import {
  SLIDES_SNAPSHOT_CADENCE,
  type SlidesReplayIndex,
} from "@/lib/core/slides/reconstruction/snapshot";
import type {
  ReplayPublication,
  RevisionStore,
  SheetReplayPublication,
  SlideReplayPublication,
  StoredGridSnapshot,
  StoredSlidesSnapshot,
  StoredSnapshot,
} from "@/lib/core/store";
import {
  runPipelineOverBodies,
  runSheetsPipelineOverBodies,
  runSlidesPipelineOverBodies,
} from "@/lib/core/worker/pipeline";

/** Everything the DOCS replay surface needs after a successful load (unchanged). */
export interface ReplayData {
  readonly revisions: readonly DecodedRevision[];
  readonly timeline: readonly TimelineEvent[];
  readonly replayIndex: ReplayIndex;
}

/** Everything the SHEETS replay surface needs after a successful load. */
export interface SheetReplayData {
  readonly revisions: readonly SheetsDecodedRevision[];
  readonly timeline: readonly TimelineEvent[];
  readonly replayIndex: SheetsReplayIndex;
  /** True for the P0 stub publication (recognized Sheet, not yet replayable). */
  readonly placeholder: boolean;
}

/** Everything the SLIDES replay surface needs after a successful load. */
export interface SlideReplayData {
  readonly revisions: readonly SlidesDecodedRevision[];
  readonly timeline: readonly TimelineEvent[];
  readonly replayIndex: SlidesReplayIndex;
  /** True for the P0 stub publication (recognized Slides, not yet replayable). */
  readonly placeholder: boolean;
}

export type ReplayLoadResult =
  | { readonly kind: "ok"; readonly data: ReplayData }
  | { readonly kind: "ok-sheet"; readonly data: SheetReplayData }
  | { readonly kind: "ok-slides"; readonly data: SlideReplayData }
  | { readonly kind: "missing-publication" };

/** Plain structured-cloneable derived data ready for store publication. */
export interface ReplayDerivedData {
  readonly revisions: readonly DecodedRevision[];
  readonly snapshots: readonly StoredSnapshot[];
  readonly timeline: readonly TimelineEvent[];
}

export interface ReplayPublishOptions {
  readonly publicationId: string;
  readonly shouldPublish?: () => boolean;
  readonly now?: () => number;
}

export type DecodeOutcome =
  | { readonly kind: "published"; readonly revisionCount: number }
  | { readonly kind: "empty" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed" }
  | { readonly kind: "stale" };

/**
 * Rebuild a `ReplayIndex` from persisted decoded revisions + snapshots. The
 * snapshot map is keyed by applied-count (`StoredSnapshot.appliedCount → model`).
 *
 * NOTE: `cadence` is carried only to satisfy the `ReplayIndex` shape — lookup
 * (`modelAtRevisionIndex` / `nearestSnapshotAtOrBefore`) reads `snapshots.keys()`
 * only, never `cadence`. `StoredSnapshot` has no cadence field, so we never read
 * cadence "from snapshots"; we restate the build-time constant.
 */
export function rebuildReplayIndex(
  decoded: readonly DecodedRevision[],
  snapshots: readonly StoredSnapshot[],
): ReplayIndex {
  const map = new Map<number, DocumentModel>(snapshots.map((s) => [s.appliedCount, s.model]));
  return { revisions: decoded, cadence: SNAPSHOT_CADENCE, snapshots: map };
}

/** Rebuild a Sheets replay index from persisted grid revisions + grid snapshots. */
export function rebuildSheetsReplayIndex(
  decoded: readonly SheetsDecodedRevision[],
  snapshots: readonly StoredGridSnapshot[],
): SheetsReplayIndex {
  const map = new Map<number, GridModel>(snapshots.map((s) => [s.appliedCount, s.model]));
  return { revisions: decoded, cadence: SHEETS_SNAPSHOT_CADENCE, snapshots: map };
}

/** Rebuild a Slides replay index from persisted presentation revisions + snapshots. */
export function rebuildSlidesReplayIndex(
  decoded: readonly SlidesDecodedRevision[],
  snapshots: readonly StoredSlidesSnapshot[],
): SlidesReplayIndex {
  const map = new Map<number, PresentationModel>(snapshots.map((s) => [s.appliedCount, s.model]));
  return { revisions: decoded, cadence: SLIDES_SNAPSHOT_CADENCE, snapshots: map };
}

function docReplayData(publication: ReplayPublication): ReplayData {
  // Narrowed by the caller (publicationKind === "doc"); legacy/missing kind → doc.
  const doc = publication as Exclude<
    ReplayPublication,
    SheetReplayPublication | SlideReplayPublication
  >;
  return {
    revisions: doc.revisions,
    timeline: doc.timeline,
    replayIndex: rebuildReplayIndex(doc.revisions, doc.snapshots),
  };
}

function sheetReplayData(publication: SheetReplayPublication): SheetReplayData {
  return {
    revisions: publication.revisions,
    timeline: publication.timeline,
    replayIndex: rebuildSheetsReplayIndex(publication.revisions, publication.snapshots),
    placeholder: publication.placeholder === true,
  };
}

function slideReplayData(publication: SlideReplayPublication): SlideReplayData {
  return {
    revisions: publication.revisions,
    timeline: publication.timeline,
    replayIndex: rebuildSlidesReplayIndex(publication.revisions, publication.snapshots),
    placeholder: publication.placeholder === true,
  };
}

/**
 * Read replay data and rebuild its replay index, branching on the publication's
 * kind. By default this resolves the document's explicit active-publication
 * pointer; an expected id keeps the exact-id legacy/test path available without
 * falling back to latest-row scans.
 */
export async function loadReplayData(
  store: RevisionStore,
  docId: DocId,
  expectedPublicationId?: string,
): Promise<ReplayLoadResult> {
  const publication =
    expectedPublicationId === undefined
      ? await store.getActiveReplayPublication(docId)
      : await store.getReplayPublication(docId, expectedPublicationId);
  if (publication === null) {
    return { kind: "missing-publication" };
  }
  if (publication.kind === "sheet") {
    return { kind: "ok-sheet", data: sheetReplayData(publication) };
  }
  if (publication.kind === "slides") {
    return { kind: "ok-slides", data: slideReplayData(publication) };
  }
  return { kind: "ok", data: docReplayData(publication) };
}

/**
 * Persist the full replay artifact, then promote it to the document's active
 * publication only while the caller still owns the current run. A stale row may
 * be saved transiently if ownership flips during the async write, but stale rows
 * are rolled back and never remain reachable through active-pointer loading.
 */
export async function publishDerivedData(
  store: RevisionStore,
  docId: DocId,
  data: ReplayDerivedData,
  options: ReplayPublishOptions,
): Promise<boolean> {
  const shouldPublish = options.shouldPublish ?? (() => true);
  if (!shouldPublish()) return false;
  const publication: ReplayPublication = {
    kind: "doc",
    publicationId: options.publicationId,
    parserVersion: PARSER_VERSION,
    revisions: data.revisions,
    snapshots: data.snapshots,
    timeline: data.timeline,
    publishedAt: options.now?.() ?? Date.now(),
  };
  await store.saveReplayPublication(docId, publication);
  if (!shouldPublish()) {
    await store.deleteReplayPublication(docId, publication.publicationId);
    return false;
  }
  await store.setActiveReplayPublication(docId, publication.publicationId, "doc");
  if (!shouldPublish()) {
    await store.deleteReplayPublication(docId, publication.publicationId);
    return false;
  }
  return true;
}

/**
 * Same-thread fallback for when `Worker` is unavailable (or injected off in
 * tests): run the PURE pipeline over the stored raw chunk bodies and publish
 * decoded/snapshots/timeline only if the producing replay run is still current.
 * An unsupported/empty result writes nothing; the page then observes empty
 * decoded data and surfaces that.
 */
export async function runPipelineSameThread(
  store: RevisionStore,
  docId: DocId,
  options: ReplayPublishOptions,
): Promise<DecodeOutcome> {
  try {
    const chunks = await store.getRawChunks(docId);
    if (chunks.length === 0) {
      return { kind: "empty" };
    }
    const result = runPipelineOverBodies(chunks.map((chunk) => chunk.body));
    if (result.kind !== "ok") {
      return { kind: "unsupported" };
    }
    const snapshots: StoredSnapshot[] = [...result.replayIndex.snapshots.entries()].map(
      ([appliedCount, model]) => ({ appliedCount, model }),
    );
    const published = await publishDerivedData(
      store,
      docId,
      { revisions: result.revisions, snapshots, timeline: result.timeline },
      options,
    );
    return published
      ? { kind: "published", revisionCount: result.revisions.length }
      : { kind: "stale" };
  } catch {
    return { kind: "failed" };
  }
}

// --- Sheets publish + same-thread fallback (parallel to the Docs path) --------

/** Plain structured-cloneable Sheets derived data ready for store publication. */
export interface SheetReplayDerivedData {
  readonly revisions: readonly SheetsDecodedRevision[];
  readonly snapshots: readonly StoredGridSnapshot[];
  readonly timeline: readonly TimelineEvent[];
  readonly placeholder?: boolean;
}

/**
 * Persist a Sheets replay artifact and promote it active (mirrors
 * {@link publishDerivedData}). Used for both the P0 stub publication (empty +
 * `placeholder:true`) and the full grid publication.
 */
export async function publishSheetsDerivedData(
  store: RevisionStore,
  docId: DocId,
  data: SheetReplayDerivedData,
  options: ReplayPublishOptions,
): Promise<boolean> {
  const shouldPublish = options.shouldPublish ?? (() => true);
  if (!shouldPublish()) return false;
  const publication: SheetReplayPublication = {
    kind: "sheet",
    publicationId: options.publicationId,
    sheetsParserVersion: SHEETS_PARSER_VERSION,
    revisions: data.revisions,
    snapshots: data.snapshots,
    timeline: data.timeline,
    publishedAt: options.now?.() ?? Date.now(),
    ...(data.placeholder === true ? { placeholder: true } : {}),
  };
  await store.saveReplayPublication(docId, publication);
  if (!shouldPublish()) {
    await store.deleteReplayPublication(docId, publication.publicationId);
    return false;
  }
  await store.setActiveReplayPublication(docId, publication.publicationId, "sheet");
  if (!shouldPublish()) {
    await store.deleteReplayPublication(docId, publication.publicationId);
    return false;
  }
  return true;
}

/**
 * Same-thread Sheets fallback: run the PURE Sheets pipeline over the stored raw
 * chunk bodies and publish the grid artifact only while the run is still current.
 */
export async function runSheetsPipelineSameThread(
  store: RevisionStore,
  docId: DocId,
  options: ReplayPublishOptions,
): Promise<DecodeOutcome> {
  try {
    const chunks = await store.getRawChunks(docId);
    if (chunks.length === 0) {
      return { kind: "empty" };
    }
    const result = runSheetsPipelineOverBodies(chunks.map((chunk) => chunk.body));
    if (result.kind !== "ok") {
      return { kind: "unsupported" };
    }
    const snapshots: StoredGridSnapshot[] = [...result.replayIndex.snapshots.entries()].map(
      ([appliedCount, model]) => ({ appliedCount, model }),
    );
    const published = await publishSheetsDerivedData(
      store,
      docId,
      { revisions: result.revisions, snapshots, timeline: result.timeline },
      options,
    );
    return published
      ? { kind: "published", revisionCount: result.revisions.length }
      : { kind: "stale" };
  } catch {
    return { kind: "failed" };
  }
}

// --- Slides publish + same-thread fallback (parallel to the Docs path) --------

/** Plain structured-cloneable Slides derived data ready for store publication. */
export interface SlideReplayDerivedData {
  readonly revisions: readonly SlidesDecodedRevision[];
  readonly snapshots: readonly StoredSlidesSnapshot[];
  readonly timeline: readonly TimelineEvent[];
  readonly placeholder?: boolean;
}

/**
 * Persist a Slides replay artifact and promote it active (mirrors
 * {@link publishDerivedData}). Used for both the P0 stub publication (empty +
 * `placeholder:true`) and the full presentation publication.
 */
export async function publishSlidesDerivedData(
  store: RevisionStore,
  docId: DocId,
  data: SlideReplayDerivedData,
  options: ReplayPublishOptions,
): Promise<boolean> {
  const shouldPublish = options.shouldPublish ?? (() => true);
  if (!shouldPublish()) return false;
  const publication: SlideReplayPublication = {
    kind: "slides",
    publicationId: options.publicationId,
    slidesParserVersion: SLIDES_PARSER_VERSION,
    revisions: data.revisions,
    snapshots: data.snapshots,
    timeline: data.timeline,
    publishedAt: options.now?.() ?? Date.now(),
    ...(data.placeholder === true ? { placeholder: true } : {}),
  };
  await store.saveReplayPublication(docId, publication);
  if (!shouldPublish()) {
    await store.deleteReplayPublication(docId, publication.publicationId);
    return false;
  }
  await store.setActiveReplayPublication(docId, publication.publicationId, "slides");
  if (!shouldPublish()) {
    await store.deleteReplayPublication(docId, publication.publicationId);
    return false;
  }
  return true;
}

/**
 * Same-thread Slides fallback: run the PURE Slides pipeline over the stored raw
 * chunk bodies and publish the presentation artifact only while the run is still
 * current.
 */
export async function runSlidesPipelineSameThread(
  store: RevisionStore,
  docId: DocId,
  options: ReplayPublishOptions,
): Promise<DecodeOutcome> {
  try {
    const chunks = await store.getRawChunks(docId);
    if (chunks.length === 0) {
      return { kind: "empty" };
    }
    const result = runSlidesPipelineOverBodies(chunks.map((chunk) => chunk.body));
    if (result.kind !== "ok") {
      return { kind: "unsupported" };
    }
    const snapshots: StoredSlidesSnapshot[] = [...result.replayIndex.snapshots.entries()].map(
      ([appliedCount, model]) => ({ appliedCount, model }),
    );
    const published = await publishSlidesDerivedData(
      store,
      docId,
      { revisions: result.revisions, snapshots, timeline: result.timeline },
      options,
    );
    return published
      ? { kind: "published", revisionCount: result.revisions.length }
      : { kind: "stale" };
  } catch {
    return { kind: "failed" };
  }
}
