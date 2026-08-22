// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure helpers and shared types for the replay page orchestrator. They live in a
// plain `.ts` rather than a `<script module>` because a `.svelte` file has no named
// exports outside one, they are shared by `App.svelte` and `ReplaySurface.svelte`,
// and `parseUserIndex` is imported directly by `test/replay.app.test.ts` for its
// own unit assertions.
//
// Nothing here touches the DOM or the reactive graph — it is the framework-free
// half of the orchestrator.
//
// Scale-safety: `buildMarkers` projects timeline events onto the APPLIED-COUNT
// axis that the Timeline scrubber uses. Nothing here passes an applied-count as a
// wire `RevisionId` `t`.

import type { TimelineMarker } from "@/components/replay/timeline-markers";
import type { TimelineEvent } from "@/lib/core/domain/model";
import {
  type EditUnit,
  largeEditDetail,
  pauseDetail,
  sessionDetail,
  strings,
} from "@/lib/core/i18n/strings";
import type {
  ReplayData,
  ReplayDerivedData,
  ReplayLoadResult,
  SheetReplayData,
  SheetReplayDerivedData,
  SlideReplayData,
  SlideReplayDerivedData,
} from "@/lib/core/replay/load";
import type { RevisionMeta } from "@/lib/core/replay-core/meta";

export type WorkerDecodeMessage =
  | ({
      readonly kind: "done";
      readonly docKind: "doc";
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: number;
    } & ReplayDerivedData)
  | ({
      readonly kind: "done";
      readonly docKind: "sheet";
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: number;
    } & SheetReplayDerivedData)
  | ({
      readonly kind: "done";
      readonly docKind: "slides";
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: number;
    } & SlideReplayDerivedData)
  | {
      readonly kind: "unsupported" | "empty" | "failed";
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: 0;
    };

export type NonReplayState = "empty" | "unsupported" | "failed" | "missing-publication";

/** Loaded replay data, discriminated by document kind (doc viewport / grid / deck). */
export type LoadedReplay =
  | { readonly kind: "doc"; readonly data: ReplayData }
  | { readonly kind: "sheet"; readonly data: SheetReplayData }
  | { readonly kind: "slides"; readonly data: SlideReplayData };

// Poll cadence + liveness thresholds (Seam C1 + F1). Stall/timeout resolve to an
// error state with Retry/Cancel — never an infinite "discovering".
export const POLL_MS = 750;
export const STALL_POLLS = 16; // ~12s with no checkpoint advance
export const NO_CHECKPOINT_MS = 20_000; // no first checkpoint at all
export const TICK_MS = 120; // playback frame budget (throttled)
export const TICK_MS_REDUCED = 320; // calmer cadence under reduced motion
let pageSessionSequence = 0;

// A manuscript carries the date it was written. The dateline formatter renders
// the CURRENT frame's revision time (metadata, never content) as an archival
// dateline. Built once at module scope so the playback tick never reallocates it.
export const datelineFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function createPageSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  pageSessionSequence += 1;
  return `page-${Date.now().toString(36)}-${pageSessionSequence.toString(36)}`;
}

/** Parse `?u=` strictly — never `Number("")` (which yields a valid-looking 0). */
export function parseUserIndex(raw: string | null): number | null {
  if (raw === null || raw === "") {
    return null;
  }
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Determinate progress percent from the checkpoint, clamped to [0, 100]. */
export function checkpointPct(nextStart: number, upperBound: number): number {
  if (upperBound <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((nextStart - 1) / upperBound) * 100)));
}

export function isWorkerDecodeMessage(value: unknown): value is WorkerDecodeMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    kind?: unknown;
    docId?: unknown;
    runId?: unknown;
    revisionCount?: unknown;
    revisions?: unknown;
    snapshots?: unknown;
    timeline?: unknown;
  };
  if (
    typeof candidate.docId !== "string" ||
    !Number.isInteger(candidate.runId) ||
    !Number.isInteger(candidate.revisionCount)
  ) {
    return false;
  }
  if (
    candidate.kind === "empty" ||
    candidate.kind === "unsupported" ||
    candidate.kind === "failed"
  ) {
    return candidate.revisionCount === 0;
  }
  return (
    candidate.kind === "done" &&
    Array.isArray(candidate.revisions) &&
    Array.isArray(candidate.snapshots) &&
    Array.isArray(candidate.timeline)
  );
}

/** Project timeline events onto the applied-count axis for the Timeline markers.
 *  `unit` is the document's large-edit counting unit (characters for Docs, cells
 *  for Sheets) — the shared TimelineEvent carries a unit-agnostic delta. */
export function buildMarkers(
  events: readonly TimelineEvent[],
  revisions: readonly RevisionMeta[],
  unit: EditUnit,
): TimelineMarker[] {
  const indexByRevision = new Map<number, number>();
  for (let i = 0; i < revisions.length; i++) {
    const revision = revisions[i];
    if (revision !== undefined) {
      // Applied-count after applying this revision is its 1-based position.
      indexByRevision.set(Number(revision.revisionId), i + 1);
    }
  }

  const markers: TimelineMarker[] = [];
  for (const event of events) {
    let anchor: number;
    let kind: TimelineMarker["kind"];
    let label: string;
    let detail: string;
    switch (event.kind) {
      case "session":
        anchor = Number(event.span.start);
        kind = "session";
        label = strings.timeline.markerSession;
        detail = sessionDetail(event.charsInserted, event.charsDeleted);
        break;
      case "large-insertion":
        anchor = Number(event.atRevision);
        kind = "large-insertion";
        label = strings.timeline.markerLargeInsertion;
        detail = largeEditDetail(event.charDelta, unit);
        break;
      case "large-deletion":
        anchor = Number(event.atRevision);
        kind = "large-deletion";
        label = strings.timeline.markerLargeDeletion;
        detail = largeEditDetail(event.charDelta, unit);
        break;
      case "pause":
        anchor = Number(event.afterRevision);
        kind = "pause";
        label = strings.timeline.markerPause;
        detail = pauseDetail(event.durationMs);
        break;
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
        continue;
      }
    }
    const index = indexByRevision.get(anchor);
    if (index !== undefined) {
      // `kind-anchor` is NOT unique: two events of the same kind anchored at the
      // same revision collide. Consumers must not key a Svelte `{#each}` by it —
      // `Timeline` keys cluster members by INDEX for exactly this reason. Left
      // exactly as it was; deduplicating here would change which marks render.
      markers.push({ id: `${kind}-${anchor}`, kind, index, label, detail });
    }
  }
  return markers;
}

/** Map a store load result into the kind-discriminated loaded wrapper, or null. */
export function toLoaded(result: ReplayLoadResult): LoadedReplay | null {
  if (result.kind === "ok") return { kind: "doc", data: result.data };
  if (result.kind === "ok-sheet") return { kind: "sheet", data: result.data };
  if (result.kind === "ok-slides") return { kind: "slides", data: result.data };
  return null;
}
