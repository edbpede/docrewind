// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay App orchestrator (plan Phase 5 Step 6). The replay page is the PRIMARY
// surface and owns its full load lifecycle (Principle 4): it validates its own
// docId from the URL, applies the theme, asks the background to start retrieval,
// drives the parse worker (with a same-thread fallback), polls the persisted
// checkpoint for content-free progress + stall detection, then composes the
// surface from thin views over pure `lib/*` data.
//
// Scale-safety: `currentIndex` is an APPLIED-COUNT. `modelAtRevisionIndex` does
// ALL time-travel; `segmentsAt` is SINGLE-ARG over that already-time-traveled
// model. Nothing here passes an applied-count as a wire `RevisionId` `t`.

import type { Component } from "solid-js";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import BrandMark from "@/components/BrandMark";
import DocumentViewport from "@/components/DocumentViewport";
import GridViewport from "@/components/GridViewport";
import { IconAlert, IconChart, IconSettings } from "@/components/icons";
import PlaybackControls from "@/components/PlaybackControls";
import PrivacyBanner from "@/components/PrivacyBanner";
import ProgressView, { type ProgressPhase } from "@/components/ProgressView";
import SheetTabs, { SHEET_GRID_PANEL_ID, sheetTabId } from "@/components/SheetTabs";
import SummaryInsights from "@/components/SummaryInsights";
import ThemeControl from "@/components/ThemeControl";
import Timeline, { type TimelineMarker } from "@/components/Timeline";
import TimelineLegend from "@/components/TimelineLegend";
import { useThemeSync } from "@/components/theme-sync";
import { createIdbStore } from "@/lib/db";
import { asDocId } from "@/lib/domain/ids";
import type { DocumentKind } from "@/lib/domain/kind";
import type { DocId, TimelineEvent } from "@/lib/domain/model";
import {
  type EditUnit,
  errorTitle,
  largeEditDetail,
  pauseDetail,
  revisionOf,
  sessionDetail,
  strings,
} from "@/lib/i18n/strings";
import { deriveAuthors } from "@/lib/identity/authors";
import { sendMessage } from "@/lib/messaging";
import { blocksAt } from "@/lib/reconstruction/blocks";
import { modelAtRevisionIndex } from "@/lib/reconstruction/snapshot";
import {
  type DecodeOutcome,
  loadReplayData,
  publishDerivedData,
  publishSheetsDerivedData,
  type ReplayData,
  type ReplayDerivedData,
  type ReplayLoadResult,
  runPipelineSameThread,
  runSheetsPipelineSameThread,
  type SheetReplayData,
  type SheetReplayDerivedData,
} from "@/lib/replay/load";
import type { RevisionMeta } from "@/lib/replay-core/meta";
import { type RetrievalErrorCategory, retrievalError } from "@/lib/retrieval/errors";
import {
  createPendingStorageMaintenanceRequest,
  keepRawData,
  realIdentities,
  removePendingStorageMaintenance,
  resolvedIdentities,
  STORAGE_LEASE_REFRESH_MS,
  storageBudget,
  upsertPendingStorageMaintenance,
} from "@/lib/settings";
import type { Gid } from "@/lib/sheets-decoder/types";
import { hasFidelityNotice } from "@/lib/sheets-reconstruction/render";
import { gridAtRevisionIndex } from "@/lib/sheets-reconstruction/snapshot";
import type { RevisionStore } from "@/lib/store";

export interface ReplayAppProps {
  /** Bulk store (page realm). Injected in tests; defaults to the idb backend. */
  readonly store?: RevisionStore;
  /** Force the same-thread pipeline when false (tests skip the Worker). */
  readonly useWorker?: boolean;
}

type WorkerDecodeMessage =
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
  | {
      readonly kind: "unsupported" | "empty" | "failed";
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: 0;
    };

// Poll cadence + liveness thresholds (Seam C1 + F1). Stall/timeout resolve to an
// error state with Retry/Cancel — never an infinite "discovering".
const POLL_MS = 750;
const STALL_POLLS = 16; // ~12s with no checkpoint advance
const NO_CHECKPOINT_MS = 20_000; // no first checkpoint at all
const TICK_MS = 120; // playback frame budget (throttled)
const TICK_MS_REDUCED = 320; // calmer cadence under reduced motion
let pageSessionSequence = 0;

// A manuscript carries the date it was written. The dateline formatter renders
// the CURRENT frame's revision time (metadata, never content) as an archival
// dateline. Built once at module scope so the playback tick never reallocates it.
const datelineFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function createPageSessionId(): string {
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
function checkpointPct(nextStart: number, upperBound: number): number {
  if (upperBound <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((nextStart - 1) / upperBound) * 100)));
}

function isWorkerDecodeMessage(value: unknown): value is WorkerDecodeMessage {
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
function buildMarkers(
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
      markers.push({ id: `${kind}-${anchor}`, kind, index, label, detail });
    }
  }
  return markers;
}

/** A small centered card for missing-doc / load-failure states. Calm, not alarming:
 *  a brand row for orientation, the privacy reassurance, then a plain-language error
 *  with one clear recovery action. */
const MessageCard: Component<{
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}> = (props) => (
  <main class="mx-auto flex max-w-prose flex-col gap-4 p-6 sm:p-8">
    <div class="flex items-center gap-2.5">
      <BrandMark size={30} />
      <span class="text-base font-semibold text-ink">{strings.app.brandName}</span>
    </div>
    <PrivacyBanner />
    <div class="dr-card flex items-start gap-3">
      <IconAlert size={22} class="mt-0.5 shrink-0 text-danger" />
      <div class="flex flex-col gap-1.5">
        <h1 class="dr-subheading text-balance">{props.title}</h1>
        <p class="dr-body text-ink-secondary text-pretty">{props.body}</p>
        <Show when={props.actionLabel}>
          {(label) => (
            <button
              type="button"
              class="btn-primary mt-1.5 self-start"
              onClick={() => props.onAction?.()}
            >
              {label()}
            </button>
          )}
        </Show>
      </div>
    </div>
  </main>
);

type NonReplayState = "empty" | "unsupported" | "failed" | "missing-publication";

/** Loaded replay data, discriminated by document kind (doc viewport vs grid). */
type LoadedReplay =
  | { readonly kind: "doc"; readonly data: ReplayData }
  | { readonly kind: "sheet"; readonly data: SheetReplayData };

/** Map a store load result into the kind-discriminated loaded wrapper, or null. */
function toLoaded(result: ReplayLoadResult): LoadedReplay | null {
  if (result.kind === "ok") return { kind: "doc", data: result.data };
  if (result.kind === "ok-sheet") return { kind: "sheet", data: result.data };
  return null;
}

/** The active replay surface for a validated document. */
const ReplaySurface: Component<{
  readonly docId: DocId;
  readonly userIndex: number | null;
  readonly store: RevisionStore;
  readonly useWorker: boolean;
  readonly kind: DocumentKind;
}> = (props) => {
  // Playback state (flat signals).
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(1);
  // Follow-caret: when on (default), the viewport auto-scrolls to keep the active edit
  // in view during non-linear playback. A genuine user scroll disengages it; the toggle
  // and a Timeline scrub re-engage it (see the viewport + scrub wiring below).
  const [follow, setFollow] = createSignal(true);

  // Progress / liveness state (driven by the checkpoint poll + late ack).
  const [phase, setPhase] = createSignal<ProgressPhase>("discovering");
  const [pct, setPct] = createSignal(0);
  const [errorCategory, setErrorCategory] = createSignal<RetrievalErrorCategory | null>(null);
  const [nonReplayState, setNonReplayState] = createSignal<NonReplayState | null>(null);
  const [retrievalDoneRunId, setRetrievalDoneRunId] = createSignal<number | null>(null);

  const [prefersReducedMotion, setPrefersReducedMotion] = createSignal(false);

  // Scroll behaviour for the follow + jump: a single smooth glide at ≤1× reads well, but
  // an 8 fps step at 2×/4× outruns a ~400ms smooth scroll (it would perpetually lag), and
  // reduced-motion always wants an instant cut. Derived once; the viewport just consumes it.
  const followBehavior = createMemo<ScrollBehavior>(() =>
    prefersReducedMotion() ? "auto" : playing() && speed() <= 1 ? "smooth" : "auto",
  );

  // Identity-display preference (default ON; opt-out). When on, an author resolves to
  // a real display name harvested for the open document (PRD §9.7); when the user has
  // opted out, names are never ingested into the reactive graph and authors stay opaque.
  const [showRealIdentities] = createResource(() => realIdentities.getValue());
  // Harvesting is asynchronous (the background tiles fetch + the content-script self
  // path both write the SESSION cache shortly after this page boots). Watch the store
  // so a late resolution still reaches the colophon without a manual refresh. The load
  // and watch are gated behind the preference: a user who opted out keeps the cache out
  // of the graph entirely.
  const [identities, { refetch: refetchIdentities }] = createResource(
    () => showRealIdentities() ?? false,
    (enabled) => (enabled ? resolvedIdentities.getValue() : {}),
  );
  onMount(() => {
    const unwatch = resolvedIdentities.watch(() => {
      if (showRealIdentities()) {
        void refetchIdentities();
      }
    });
    onCleanup(unwatch);
  });

  // Decode runs only AFTER retrieval completes (the worker reads raw chunks).
  // Either path writes one replay publication; replay reads resolve through the
  // document's active publication pointer so remounts do not need this page's id.
  const [loaded, { mutate: mutateLoaded }] = createResource(
    () => {
      const runId = retrievalDoneRunId();
      return runId === null
        ? undefined
        : { docId: props.docId, runId, publicationId: publicationIdForRun(runId) };
    },
    async ({ docId, runId, publicationId }): Promise<LoadedReplay | undefined> => {
      let reconstructionStatus: "partial" | "complete" = "partial";
      try {
        const outcome = await decode(docId, runId, publicationId);
        if (outcome.kind !== "published") {
          if (outcome.kind === "empty") {
            const existing = toLoaded(await loadReplayData(props.store, docId));
            if (existing !== null) {
              reconstructionStatus = "complete";
              return existing;
            }
          }
          if (outcome.kind !== "stale" && isActiveRun(runId)) {
            setNonReplayState(outcome.kind);
          }
          return undefined;
        }
        const result = toLoaded(await loadReplayData(props.store, docId, publicationId));
        if (result === null) {
          if (isActiveRun(runId)) {
            setNonReplayState("missing-publication");
          }
          return undefined;
        }
        reconstructionStatus = "complete";
        return result;
      } catch {
        if (isActiveRun(runId)) {
          setNonReplayState("failed");
        }
        return undefined;
      } finally {
        if (isActiveRun(runId)) {
          await finishRunMaintenance(runId, reconstructionStatus);
        }
      }
    },
  );

  let worker: Worker | undefined;
  onCleanup(() => {
    worker?.terminate();
    for (const runId of [...leasedRunIds]) {
      void finishRunMaintenance(runId, "partial");
    }
    void sendMessage("cancelRetrieval", { docId: props.docId }).catch(() => {});
  });

  let nextRunId = 0;
  let activeRunId = 0;
  const pageSessionId = createPageSessionId();
  const leasedRunIds = new Set<number>();
  const leaseRefreshTimers = new Map<number, ReturnType<typeof setInterval>>();

  function isActiveRun(runId: number): boolean {
    return activeRunId === runId;
  }

  function publicationIdForRun(runId: number): string {
    return `${pageSessionId}:${runId}`;
  }

  function beginPageLease(runId: number): void {
    leasedRunIds.add(runId);
    void sendMessage("beginDecodeLease", { docId: props.docId }).catch(() => {});
    const timer = setInterval(() => {
      void sendMessage("refreshDecodeLease", { docId: props.docId }).catch(() => {});
    }, STORAGE_LEASE_REFRESH_MS);
    leaseRefreshTimers.set(runId, timer);
  }

  async function releasePageLease(runId: number): Promise<void> {
    if (!leasedRunIds.delete(runId)) {
      return;
    }
    const timer = leaseRefreshTimers.get(runId);
    if (timer !== undefined) {
      clearInterval(timer);
      leaseRefreshTimers.delete(runId);
    }
    await sendMessage("endDecodeLease", { docId: props.docId }).catch(() => {});
  }

  async function requestMaintenanceForRun(
    runId: number,
    reconstructionStatus: "partial" | "complete",
  ): Promise<void> {
    if (!leasedRunIds.has(runId)) {
      return;
    }
    const [retainRaw, budget] = await Promise.all([
      keepRawData.getValue(),
      storageBudget.getValue(),
    ]);
    const request = createPendingStorageMaintenanceRequest({
      docId: props.docId,
      keepRawData: retainRaw,
      budget,
      reconstructionStatus,
    });
    await upsertPendingStorageMaintenance(request);
    try {
      const ack = await sendMessage("requestStorageMaintenance", request);
      if (ack.status === "completed") {
        await removePendingStorageMaintenance(request.id, request.queuedAt);
      }
    } catch {
      // Durable pending state was written before send; background startup or a
      // later lease release will retry this content-free maintenance request.
    }
  }

  async function finishRunMaintenance(
    runId: number,
    reconstructionStatus: "partial" | "complete",
  ): Promise<void> {
    await requestMaintenanceForRun(runId, reconstructionStatus);
    await releasePageLease(runId);
  }

  async function decode(
    docId: DocId,
    runId: number,
    publicationId: string,
  ): Promise<DecodeOutcome> {
    if (props.useWorker && typeof Worker !== "undefined") {
      return decodeInWorker(docId, runId, publicationId);
    }
    return props.kind === "sheet"
      ? runSheetsPipelineSameThread(props.store, docId, {
          publicationId,
          shouldPublish: () => isActiveRun(runId),
        })
      : runPipelineSameThread(props.store, docId, {
          publicationId,
          shouldPublish: () => isActiveRun(runId),
        });
  }

  function decodeInWorker(
    docId: DocId,
    runId: number,
    publicationId: string,
  ): Promise<DecodeOutcome> {
    return new Promise<DecodeOutcome>((resolve) => {
      const localWorker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
        type: "module",
      });
      worker = localWorker;
      // Any terminal signal (done/unsupported/empty) ends decode; the page then
      // re-reads, and an unsupported/empty result surfaces as an empty document.
      localWorker.addEventListener("message", (event: MessageEvent) => {
        if (worker === localWorker) {
          worker = undefined;
        }
        localWorker.terminate();
        const message: unknown = event.data;
        if (!isWorkerDecodeMessage(message) || message.docId !== docId || message.runId !== runId) {
          resolve(isActiveRun(runId) ? { kind: "failed" } : { kind: "stale" });
          return;
        }
        if (!isActiveRun(runId) || message.kind !== "done") {
          resolve(message.kind === "done" ? { kind: "stale" } : { kind: message.kind });
          return;
        }
        const publish =
          message.docKind === "sheet"
            ? publishSheetsDerivedData(props.store, docId, message, {
                publicationId,
                shouldPublish: () => isActiveRun(runId),
              })
            : publishDerivedData(props.store, docId, message, {
                publicationId,
                shouldPublish: () => isActiveRun(runId),
              });
        publish.then(
          (published) =>
            resolve(
              published
                ? { kind: "published", revisionCount: message.revisionCount }
                : { kind: "stale" },
            ),
          () => resolve({ kind: "failed" }),
        );
      });
      localWorker.addEventListener("error", (event) => {
        if (worker === localWorker) {
          worker = undefined;
        }
        localWorker.terminate();
        void event.error;
        resolve({ kind: "failed" });
      });
      localWorker.postMessage({ docId, runId, kind: props.kind });
    });
  }

  // Derived playback views. `modelAtRevisionIndex` time-travels; `blocksAt` (over
  // `segmentsAt`) is single-arg over that model (no second time-cut).
  const maxIndex = createMemo(() => loaded()?.data.revisions.length ?? 0);
  const currentModel = createMemo(() => {
    const entry = loaded();
    return entry === undefined || entry.kind !== "doc"
      ? undefined
      : modelAtRevisionIndex(entry.data.replayIndex, currentIndex());
  });
  const currentBlocks = createMemo(() => {
    const model = currentModel();
    return model === undefined ? [] : blocksAt(model);
  });

  // ── Sheets grid views (the Docs memos above stay untouched) ─────────────────
  // The active grid at the current frame, the active tab gid, and the §9 notice.
  const [selectedGid, setSelectedGid] = createSignal<Gid | null>(null);
  const currentGrid = createMemo(() => {
    const entry = loaded();
    return entry === undefined || entry.kind !== "sheet"
      ? undefined
      : gridAtRevisionIndex(entry.data.replayIndex, currentIndex());
  });
  // The tab to render: the user's selection if it still exists, else the first.
  const activeGid = createMemo<Gid | null>(() => {
    const grid = currentGrid();
    if (grid === undefined || grid.order.length === 0) return null;
    const selected = selectedGid();
    if (selected !== null && grid.sheets.has(selected)) return selected;
    return grid.order[0] ?? null;
  });
  const currentSheet = createMemo(() => {
    const grid = currentGrid();
    const gid = activeGid();
    return grid !== undefined && gid !== null ? grid.sheets.get(gid) : undefined;
  });
  const gridHasFidelityNotice = createMemo(() => {
    const grid = currentGrid();
    return grid !== undefined && hasFidelityNotice(grid);
  });
  // Reverse link for the grid tabpanel: name it by the active tab when one exists
  // (the tabs only render when there is at least one sheet).
  const sheetPanelLabelledBy = createMemo(() => {
    const gid = activeGid();
    return gid === null ? undefined : sheetTabId(gid);
  });

  // ── Authorship attribution (§9.7) ───────────────────────────────────────────
  // ONE shared author derivation feeds BOTH the colophon and the caret/highlight, so
  // they agree on opaque keys, "Author N" numbering, and assigned colours. Built off the
  // loaded revisions + the (opt-in) resolved identities — the same inputs the colophon uses.
  const authors = createMemo(() =>
    deriveAuthors(
      loaded()?.data.revisions ?? [],
      showRealIdentities() ?? false,
      identities() ?? {},
    ),
  );
  // author key → assigned hue (null when the source carried none); the caret + highlight
  // tints read it. Keyed by the stable opaque token, never the raw Gaia id.
  const colorByAuthorKey = createMemo(() => {
    const map = new Map<string, string | null>();
    for (const author of authors()) {
      map.set(author.key, author.color);
    }
    return map;
  });
  // revision id → author key: joins a rendered segment (which carries its insert
  // revision) back to its contributor. Stable per load.
  const authorKeyByRevision = createMemo(() => {
    const map = new Map<number, string>();
    for (const revision of loaded()?.data.revisions ?? []) {
      if (revision.userId !== null) {
        map.set(Number(revision.revisionId), revision.userId);
      }
    }
    return map;
  });

  // The colophon publishes which contributor is foregrounded (hover/pin) and the viewport
  // highlights that author's runs — the shared state lives HERE so the two sibling
  // surfaces both reach it. Off when nothing is foregrounded or identities are opt-out.
  const [activeAuthorKey, setActiveAuthorKey] = createSignal<string | null>(null);
  const highlight = createMemo(() => {
    const key = activeAuthorKey();
    if (key === null) {
      return null;
    }
    const author = authors().find((entry) => entry.key === key);
    if (author === undefined) {
      return null;
    }
    return { key, color: author.color, label: author.label };
  });

  // The writing caret follows the CURRENT frame's revision (`currentIndex` is an
  // applied-count, so the frame's revision is `revisions[currentIndex - 1]`); index 0 is
  // the blank page, before anything was written. Colour-coded to that revision's author.
  const caret = createMemo(() => {
    const data = loaded();
    const index = currentIndex();
    if (data === undefined || index <= 0) {
      return null;
    }
    const revision = data.data.revisions[index - 1];
    if (revision === undefined) {
      return null;
    }
    const color =
      revision.userId !== null ? (colorByAuthorKey().get(revision.userId) ?? null) : null;
    return { revision: Number(revision.revisionId), color };
  });

  const markers = createMemo(() => {
    const data = loaded();
    if (data === undefined) {
      return [];
    }
    // Sheets large-edit deltas count cells; Docs count characters. The marker
    // detail must name the right unit (CID 3501810461).
    const unit: EditUnit = data.kind === "sheet" ? "cells" : "characters";
    return buildMarkers(data.data.timeline, data.data.revisions, unit);
  });
  // The dateline of the frame in view. `currentIndex` is an applied-count, so the
  // revision that produced this frame is `revisions[currentIndex - 1]`; index 0 is
  // the blank page, before anything was written. A lazy memo — no per-tick effect.
  const dateline = createMemo(() => {
    const data = loaded();
    const index = currentIndex();
    if (data === undefined || index <= 0) {
      return "";
    }
    const time = data.data.revisions[index - 1]?.time;
    // The decoder admits any finite number, but `format` throws RangeError beyond
    // the Date epoch bound (±8.64e15 ms). Out-of-range metadata degrades to blank.
    if (time === null || time === undefined || Math.abs(time) > 8.64e15) {
      return "";
    }
    return datelineFormat.format(time);
  });

  // ── Retrieval flow: fire start, poll the checkpoint, detect stalls ──────────
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let watchdogTimer: ReturnType<typeof setInterval> | undefined;

  function stopRunTimers(runId?: number): void {
    if (runId !== undefined && !isActiveRun(runId)) {
      return;
    }
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (watchdogTimer !== undefined) {
      clearInterval(watchdogTimer);
      watchdogTimer = undefined;
    }
  }
  onCleanup(stopRunTimers);

  function failRun(runId: number, category: RetrievalErrorCategory): void {
    if (!isActiveRun(runId)) {
      return;
    }
    setErrorCategory(category);
    setPhase("error");
    stopRunTimers(runId);
    activeRunId = ++nextRunId;
    worker?.terminate();
    worker = undefined;
    setRetrievalDoneRunId(null);
    mutateLoaded(undefined);
    void finishRunMaintenance(runId, "partial");
  }

  function startFlow(): void {
    if (activeRunId !== 0) {
      const previousRunId = activeRunId;
      void finishRunMaintenance(previousRunId, "partial");
    }
    const runId = ++nextRunId;
    activeRunId = runId;
    beginPageLease(runId);
    worker?.terminate();
    worker = undefined;
    setPhase("discovering");
    setPct(0);
    setErrorCategory(null);
    setNonReplayState(null);
    setRetrievalDoneRunId(null);
    mutateLoaded(undefined);

    // Fire start; the ack resolves only at end-of-run, so it is the only
    // terminal signal allowed to open the decode gate for this page run.
    // Persisted completed checkpoints have no run id and can be stale.
    void sendMessage("startRetrieval", {
      docId: props.docId,
      userIndex: props.userIndex,
      kind: props.kind,
    })
      .then((ack) => {
        if (!isActiveRun(runId)) {
          return;
        }
        if (!ack.ok) {
          failRun(runId, ack.error.category);
          return;
        }
        setPct(100);
        setPhase("fetching");
        setRetrievalDoneRunId(runId);
        stopRunTimers(runId);
      })
      .catch(() => {
        // SW restarting / page navigating: the poll + stall detection surface it.
      });

    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let lastNextStart: number | null = null;
    let checkpointSeen = false;
    let stallCount = 0;
    let pollInFlight = false;

    stopRunTimers();
    watchdogTimer = setInterval(() => {
      if (!isActiveRun(runId)) {
        return;
      }
      const elapsedWithoutProgress = Date.now() - (checkpointSeen ? lastProgressAt : startedAt);
      if (!checkpointSeen && elapsedWithoutProgress > NO_CHECKPOINT_MS) {
        failRun(runId, "endpoint-unavailable");
        return;
      }
      if (checkpointSeen && elapsedWithoutProgress > STALL_POLLS * POLL_MS) {
        failRun(runId, "network-failure");
      }
    }, POLL_MS);
    pollTimer = setInterval(() => {
      if (pollInFlight) {
        return;
      }
      pollInFlight = true;
      void (async () => {
        try {
          if (!isActiveRun(runId)) {
            return;
          }
          const checkpoint = await props.store.readCheckpoint(props.docId);
          if (!isActiveRun(runId)) {
            return;
          }
          if (checkpoint === null) {
            if (Date.now() - startedAt > NO_CHECKPOINT_MS) {
              failRun(runId, "endpoint-unavailable");
            }
            return;
          }

          const next = Number(checkpoint.nextStart);

          if (checkpoint.completed) {
            // Checkpoints are durable resume state, not a page-run proof. A stale
            // completion from an older run must not decode or stop polling; the
            // current `startRetrieval` ack above is the authoritative terminal.
            return;
          }

          setPct(checkpointPct(next, Number(checkpoint.upperBound)));
          setPhase("fetching");
          checkpointSeen = true;
          if (next === lastNextStart) {
            stallCount += 1;
            if (stallCount >= STALL_POLLS) {
              failRun(runId, "network-failure");
            }
          } else {
            stallCount = 0;
            lastNextStart = next;
            lastProgressAt = Date.now();
          }
        } catch {
          failRun(runId, "network-failure");
        } finally {
          pollInFlight = false;
        }
      })();
    }, POLL_MS);
  }

  function onRetry(): void {
    void sendMessage("cancelRetrieval", { docId: props.docId }).catch(() => {});
    startFlow();
  }

  function onCancel(): void {
    const cancelledRunId = activeRunId;
    activeRunId = ++nextRunId;
    worker?.terminate();
    worker = undefined;
    void sendMessage("cancelRetrieval", { docId: props.docId }).catch(() => {});
    void finishRunMaintenance(cancelledRunId, "partial");
    stopRunTimers();
    setRetrievalDoneRunId(null);
    mutateLoaded(undefined);
    setErrorCategory("cancellation");
    setPhase("error");
  }

  // ── Lifecycle: reduced-motion, retrieval, playback ──────────────────────────
  // (Theme is applied once at the top-level App, which covers this subtree.)
  onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(media.matches);
    const onChange = (): void => {
      setPrefersReducedMotion(media.matches);
    };
    media.addEventListener("change", onChange);
    onCleanup(() => media.removeEventListener("change", onChange));

    startFlow();
  });

  // Playback tick, managed by an effect so the cadence rebuilds when the
  // reduced-motion preference flips (calmer cadence = less animation, without
  // stopping the data stepping). A fractional accumulator honors sub-1× speeds.
  // The interval callback reads playing/speed/currentIndex untracked, so only the
  // reduced-motion read drives the effect — no per-frame effect churn.
  let accumulator = 0;
  createEffect(() => {
    const interval = prefersReducedMotion() ? TICK_MS_REDUCED : TICK_MS;
    const timer = setInterval(() => {
      if (!playing()) {
        return;
      }
      const max = maxIndex();
      if (currentIndex() >= max) {
        setPlaying(false);
        return;
      }
      accumulator += speed();
      const step = Math.floor(accumulator);
      if (step >= 1) {
        accumulator -= step;
        setCurrentIndex((index) => Math.min(index + step, max));
      }
    }, interval);
    onCleanup(() => clearInterval(timer));
  });

  function onPlayPause(): void {
    if (currentIndex() >= maxIndex() && !playing()) {
      setCurrentIndex(0); // replay from the start if parked at the end
    }
    setPlaying((value) => !value);
  }

  function renderProgress() {
    return (
      <main class="mx-auto flex max-w-3xl flex-col gap-5 p-6 sm:p-8">
        <div class="flex items-center gap-2.5">
          <BrandMark size={32} />
          <span class="text-base font-semibold text-ink">{strings.app.brandName}</span>
        </div>
        <PrivacyBanner />
        <ProgressView
          phase={phase()}
          pct={pct()}
          errorCategory={errorCategory()}
          onRetry={onRetry}
          onCancel={onCancel}
        />
      </main>
    );
  }

  function renderNonReplay(state: NonReplayState) {
    const category: RetrievalErrorCategory =
      state === "unsupported" ? "unsupported-format" : "reconstruction-failure";
    const error = retrievalError(category);
    return (
      <MessageCard
        title={
          state === "empty"
            ? strings.app.emptyReplayTitle
            : state === "missing-publication"
              ? strings.app.loadFailed
              : errorTitle(category)
        }
        body={state === "empty" ? strings.app.emptyReplayHint : error.userMessage}
        actionLabel={strings.progress.retry}
        onAction={onRetry}
      />
    );
  }

  return (
    <div class="dr-page">
      <ErrorBoundary
        fallback={() => (
          <MessageCard
            title={strings.app.loadFailed}
            body={strings.app.loadFailedHint}
            actionLabel={strings.progress.retry}
            onAction={() => window.location.reload()}
          />
        )}
      >
        <Show
          when={nonReplayState()}
          fallback={
            <Suspense fallback={renderProgress()}>
              <Show when={loaded()} fallback={renderProgress()}>
                {(data) => (
                  <main class="mx-auto flex max-w-[58rem] flex-col gap-5 p-6 sm:p-8">
                    <header class="dr-masthead">
                      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                        <div class="flex min-w-0 items-center gap-3">
                          <BrandMark size={40} />
                          <div class="flex min-w-0 flex-col gap-1">
                            <p class="dr-eyebrow">{strings.app.mastheadEyebrow}</p>
                            <h1 class="dr-title">{strings.app.mastheadTitle}</h1>
                          </div>
                        </div>
                        {/* The summary CTA rides at the top, next to the appearance
                            control, so the insights deep-dive is prevalent — not buried
                            below the leaf. A brand-soft pill that fills in on hover. */}
                        <div class="flex shrink-0 items-center gap-2.5">
                          <a
                            class="dr-summary-cta"
                            href={`summary.html?doc=${encodeURIComponent(props.docId)}`}
                          >
                            <IconChart size={18} />
                            <span>{strings.summary.title}</span>
                          </a>
                          <ThemeControl bare />
                        </div>
                      </div>
                      <PrivacyBanner approximationNote={strings.privacy.approximationNote} />
                    </header>

                    {/* The margin: transport + the writing-activity stratum, with the
                        frame's revision count and archival dateline framing the scrubber. */}
                    <section class="sticky top-0 z-20 flex flex-col gap-3 bg-canvas pt-1 pb-2">
                      <PlaybackControls
                        playing={playing()}
                        speed={speed()}
                        onPlayPause={onPlayPause}
                        onRestart={() => {
                          setPlaying(false);
                          setCurrentIndex(0);
                        }}
                        onSpeed={(value) => setSpeed(value)}
                        follow={follow()}
                        onFollowChange={setFollow}
                      />
                      <div class="flex flex-col gap-1.5">
                        <div class="flex items-baseline justify-between gap-3">
                          <span class="dr-counter">{revisionOf(currentIndex(), maxIndex())}</span>
                          <Show when={dateline()}>
                            {(when) => <span class="dr-dateline">{when()}</span>}
                          </Show>
                        </div>
                        <Timeline
                          currentIndex={currentIndex()}
                          max={maxIndex()}
                          events={markers()}
                          onScrub={(index) => {
                            setCurrentIndex(index);
                            setFollow(true); // a scrub is "take me here" — re-engage follow.
                          }}
                        />
                        <TimelineLegend events={markers()} />
                      </div>
                    </section>

                    {/* The leaf is the hero: the rebuilt manuscript sits directly
                        under its transport, so the controls read as the margin of
                        the page they drive. The caret + highlight surface authorship:
                        who is writing now, and (on a colophon hover) who wrote what. */}
                    <Show
                      when={data().kind === "doc"}
                      fallback={
                        <Show
                          when={currentSheet()}
                          fallback={
                            <div class="dr-card text-center">
                              <p class="dr-subheading">{strings.sheet.placeholderTitle}</p>
                              <p class="dr-muted mt-1">{strings.sheet.placeholderHint}</p>
                            </div>
                          }
                        >
                          {(sheet) => (
                            <div class="flex flex-col gap-3">
                              <Show when={currentGrid()}>
                                {(grid) => (
                                  <SheetTabs
                                    model={grid()}
                                    activeGid={activeGid()}
                                    onSelect={setSelectedGid}
                                  />
                                )}
                              </Show>
                              <div
                                role="tabpanel"
                                id={SHEET_GRID_PANEL_ID}
                                aria-labelledby={sheetPanelLabelledBy()}
                                tabindex="0"
                              >
                                <GridViewport
                                  sheet={sheet()}
                                  showFidelityNotice={gridHasFidelityNotice()}
                                />
                              </div>
                            </div>
                          )}
                        </Show>
                      }
                    >
                      <DocumentViewport
                        blocks={currentBlocks()}
                        caret={caret()}
                        highlight={highlight()}
                        authorKeyByRevision={authorKeyByRevision()}
                        follow={follow()}
                        scrollBehavior={followBehavior()}
                        onFollowOff={() => setFollow(false)}
                        onFollowOn={() => setFollow(true)}
                      />
                    </Show>

                    {/* The colophon: content-free insights close the record. Foregrounding
                        a contributor here highlights their runs on the leaf above. */}
                    <SummaryInsights
                      revisions={data().data.revisions}
                      timeline={data().data.timeline}
                      realIdentities={showRealIdentities() ?? false}
                      identities={identities() ?? {}}
                      onActiveAuthorChange={setActiveAuthorKey}
                    />
                    {/* Settings is a quiet utility, parked in the bottom-right corner —
                        present and reachable, never competing with the record above. */}
                    <footer class="flex justify-end pt-2">
                      <a
                        class="btn-ghost"
                        href={`options.html?doc=${encodeURIComponent(props.docId)}`}
                      >
                        <IconSettings size={18} />
                        <span>{strings.app.optionsLink}</span>
                      </a>
                    </footer>
                  </main>
                )}
              </Show>
            </Suspense>
          }
        >
          {(state) => renderNonReplay(state())}
        </Show>
      </ErrorBoundary>
    </div>
  );
};

const App: Component<ReplayAppProps> = (props) => {
  const params = new URLSearchParams(window.location.search);
  const rawDoc = params.get("doc");
  const userIndex = parseUserIndex(params.get("u"));
  const kind: DocumentKind = params.get("kind") === "sheet" ? "sheet" : "doc";

  let docId: DocId | null = null;
  try {
    docId = rawDoc !== null ? asDocId(rawDoc) : null;
  } catch {
    docId = null;
  }

  // Theme applies even on the error screen.
  useThemeSync();

  const store = props.store ?? createIdbStore();
  const useWorker = props.useWorker !== false;

  return (
    <Show
      when={docId}
      fallback={
        <div class="dr-page">
          <MessageCard
            title={errorTitle("missing-doc-id")}
            body={retrievalError("missing-doc-id").userMessage}
            actionLabel={strings.progress.retry}
            onAction={() => window.location.reload()}
          />
        </div>
      }
    >
      {(id) => (
        <ReplaySurface
          docId={id()}
          userIndex={userIndex}
          store={store}
          useWorker={useWorker}
          kind={kind}
        />
      )}
    </Show>
  );
};

export default App;
