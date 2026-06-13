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
import DocumentViewport from "@/components/DocumentViewport";
import PlaybackControls from "@/components/PlaybackControls";
import PrivacyBanner from "@/components/PrivacyBanner";
import ProgressView, { type ProgressPhase } from "@/components/ProgressView";
import SummaryInsights from "@/components/SummaryInsights";
import Timeline, { type TimelineMarker } from "@/components/Timeline";
import { useThemeSync } from "@/components/theme-sync";
import { createIdbStore } from "@/lib/db";
import { asDocId } from "@/lib/domain/ids";
import type { DecodedRevision, DocId, TimelineEvent } from "@/lib/domain/model";
import { errorTitle, strings } from "@/lib/i18n/strings";
import { sendMessage } from "@/lib/messaging";
import { segmentsAt } from "@/lib/reconstruction/render";
import { modelAtRevisionIndex } from "@/lib/reconstruction/snapshot";
import {
  loadReplayData,
  publishDerivedData,
  type ReplayDerivedData,
  runPipelineSameThread,
} from "@/lib/replay/load";
import { type RetrievalErrorCategory, retrievalError } from "@/lib/retrieval/errors";
import { keepRawData, realIdentities, storageBudget } from "@/lib/settings";
import { applyPostDecodeStoragePolicy } from "@/lib/storage-maintenance";
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
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: number;
    } & ReplayDerivedData)
  | {
      readonly kind: "unsupported" | "empty";
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

/** Parse `?u=` strictly — never `Number("")` (which yields a valid-looking 0). */
function parseUserIndex(raw: string | null): number | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : null;
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
  if (candidate.kind === "empty" || candidate.kind === "unsupported") {
    return candidate.revisionCount === 0;
  }
  return (
    candidate.kind === "done" &&
    Array.isArray(candidate.revisions) &&
    Array.isArray(candidate.snapshots) &&
    Array.isArray(candidate.timeline)
  );
}

/** Project timeline events onto the applied-count axis for the Timeline markers. */
function buildMarkers(
  events: readonly TimelineEvent[],
  revisions: readonly DecodedRevision[],
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
    switch (event.kind) {
      case "session":
        anchor = Number(event.span.start);
        kind = "session";
        label = strings.timeline.markerSession;
        break;
      case "large-insertion":
        anchor = Number(event.atRevision);
        kind = "large-insertion";
        label = strings.timeline.markerLargeInsertion;
        break;
      case "large-deletion":
        anchor = Number(event.atRevision);
        kind = "large-deletion";
        label = strings.timeline.markerLargeDeletion;
        break;
      case "pause":
        anchor = Number(event.afterRevision);
        kind = "pause";
        label = strings.timeline.markerPause;
        break;
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
        continue;
      }
    }
    const index = indexByRevision.get(anchor);
    if (index !== undefined) {
      markers.push({ id: `${kind}-${anchor}`, kind, index, label });
    }
  }
  return markers;
}

/** A small centered card for missing-doc / load-failure states. */
const MessageCard: Component<{
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}> = (props) => (
  <main class="mx-auto flex max-w-prose flex-col gap-3 p-8">
    <PrivacyBanner />
    <div class="dr-card flex flex-col gap-2">
      <h1 class="font-medium text-strike">{props.title}</h1>
      <p class="text-sm text-stone-700 dark:text-stone-300">{props.body}</p>
      <Show when={props.actionLabel}>
        {(label) => (
          <button type="button" class="btn-primary self-start" onClick={() => props.onAction?.()}>
            {label()}
          </button>
        )}
      </Show>
    </div>
  </main>
);

/** The active replay surface for a validated document. */
const ReplaySurface: Component<{
  readonly docId: DocId;
  readonly userIndex: number | null;
  readonly store: RevisionStore;
  readonly useWorker: boolean;
}> = (props) => {
  // Playback state (flat signals).
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(1);

  // Progress / liveness state (driven by the checkpoint poll + late ack).
  const [phase, setPhase] = createSignal<ProgressPhase>("discovering");
  const [pct, setPct] = createSignal(0);
  const [errorCategory, setErrorCategory] = createSignal<RetrievalErrorCategory | null>(null);
  const [retrievalDoneRunId, setRetrievalDoneRunId] = createSignal<number | null>(null);

  const [prefersReducedMotion, setPrefersReducedMotion] = createSignal(false);

  // Identity-display preference (default opaque). Even when on, userId is an
  // opaque per-document token — never a real-world identity (PRD §9.7).
  const [showRealIdentities] = createResource(() => realIdentities.getValue());

  // Decode runs only AFTER retrieval completes (the worker reads raw chunks).
  // Either path writes decoded/snapshots/timeline; we then re-read via one path.
  const [loaded, { mutate: mutateLoaded }] = createResource(
    () => {
      const runId = retrievalDoneRunId();
      return runId === null ? undefined : { docId: props.docId, runId };
    },
    async ({ docId, runId }) => {
      const published = await decode(docId, runId);
      const data = await loadReplayData(props.store, docId);
      if (published && isActiveRun(runId)) {
        const [retainRaw, budget] = await Promise.all([
          keepRawData.getValue(),
          storageBudget.getValue(),
        ]);
        if (isActiveRun(runId)) {
          await applyPostDecodeStoragePolicy(props.store, docId, {
            keepRawData: retainRaw,
            budget,
          });
        }
      }
      return data;
    },
  );

  let worker: Worker | undefined;
  onCleanup(() => worker?.terminate());

  let nextRunId = 0;
  let activeRunId = 0;

  function isActiveRun(runId: number): boolean {
    return activeRunId === runId;
  }

  async function decode(docId: DocId, runId: number): Promise<boolean> {
    if (props.useWorker && typeof Worker !== "undefined") {
      return decodeInWorker(docId, runId);
    }
    return runPipelineSameThread(props.store, docId, {
      shouldPublish: () => isActiveRun(runId),
    });
  }

  function decodeInWorker(docId: DocId, runId: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
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
          resolve(false);
          return;
        }
        if (!isActiveRun(runId) || message.kind !== "done") {
          resolve(false);
          return;
        }
        publishDerivedData(props.store, docId, message, () => isActiveRun(runId)).then(
          (published) => resolve(published),
          reject,
        );
      });
      localWorker.addEventListener("error", (event) => {
        if (worker === localWorker) {
          worker = undefined;
        }
        localWorker.terminate();
        reject(event.error ?? new Error("parse worker failed"));
      });
      localWorker.postMessage({ docId, runId });
    });
  }

  // Derived playback views. `modelAtRevisionIndex` time-travels; `segmentsAt` is
  // single-arg over that model (no second time-cut).
  const maxIndex = createMemo(() => loaded()?.revisions.length ?? 0);
  const currentModel = createMemo(() => {
    const data = loaded();
    return data === undefined ? undefined : modelAtRevisionIndex(data.replayIndex, currentIndex());
  });
  const currentSegments = createMemo(() => {
    const model = currentModel();
    return model === undefined ? [] : segmentsAt(model);
  });
  const markers = createMemo(() => {
    const data = loaded();
    return data === undefined ? [] : buildMarkers(data.timeline, data.revisions);
  });

  // ── Retrieval flow: fire start, poll the checkpoint, detect stalls ──────────
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function stopPolling(runId?: number): void {
    if ((runId === undefined || isActiveRun(runId)) && pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }
  onCleanup(stopPolling);

  function startFlow(): void {
    const runId = ++nextRunId;
    activeRunId = runId;
    worker?.terminate();
    worker = undefined;
    setPhase("discovering");
    setPct(0);
    setErrorCategory(null);
    setRetrievalDoneRunId(null);
    mutateLoaded(undefined);

    // Fire start; the ack resolves only at end-of-run, so it is the only
    // terminal signal allowed to open the decode gate for this page run.
    // Persisted completed checkpoints have no run id and can be stale.
    void sendMessage("startRetrieval", { docId: props.docId, userIndex: props.userIndex })
      .then((ack) => {
        if (!isActiveRun(runId)) {
          return;
        }
        if (!ack.ok) {
          setErrorCategory(ack.error.category);
          setPhase("error");
          stopPolling(runId);
          return;
        }
        setPct(100);
        setPhase("fetching");
        setRetrievalDoneRunId(runId);
        stopPolling(runId);
      })
      .catch(() => {
        // SW restarting / page navigating: the poll + stall detection surface it.
      });

    const startedAt = Date.now();
    let lastNextStart = -1;
    let stallCount = 0;

    stopPolling();
    pollTimer = setInterval(() => {
      void (async () => {
        if (!isActiveRun(runId)) {
          return;
        }
        const checkpoint = await props.store.readCheckpoint(props.docId);
        if (!isActiveRun(runId)) {
          return;
        }
        if (checkpoint === null) {
          if (Date.now() - startedAt > NO_CHECKPOINT_MS) {
            setErrorCategory("endpoint-unavailable");
            setPhase("error");
            stopPolling(runId);
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
        if (next === lastNextStart) {
          stallCount += 1;
          if (stallCount >= STALL_POLLS) {
            setErrorCategory("network-failure");
            setPhase("error");
            stopPolling(runId);
          }
        } else {
          stallCount = 0;
          lastNextStart = next;
        }
      })();
    }, POLL_MS);
  }

  function onRetry(): void {
    void sendMessage("cancelRetrieval", { docId: props.docId }).catch(() => {});
    startFlow();
  }

  function onCancel(): void {
    activeRunId = ++nextRunId;
    worker?.terminate();
    worker = undefined;
    void sendMessage("cancelRetrieval", { docId: props.docId }).catch(() => {});
    stopPolling();
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
      <main class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
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
        <Suspense fallback={renderProgress()}>
          <Show when={loaded()} fallback={renderProgress()}>
            {(data) => (
              <main class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
                <header>
                  <PrivacyBanner approximationNote={strings.privacy.approximationNote} />
                </header>
                <PlaybackControls
                  playing={playing()}
                  speed={speed()}
                  onPlayPause={onPlayPause}
                  onRestart={() => {
                    setPlaying(false);
                    setCurrentIndex(0);
                  }}
                  onSpeed={(value) => setSpeed(value)}
                />
                <Timeline
                  currentIndex={currentIndex()}
                  max={maxIndex()}
                  events={markers()}
                  onScrub={(index) => setCurrentIndex(index)}
                />
                <SummaryInsights
                  revisions={data().revisions}
                  timeline={data().timeline}
                  realIdentities={showRealIdentities() ?? false}
                />
                <DocumentViewport segments={currentSegments()} />
                <footer class="pt-2 text-sm">
                  <a
                    class="text-revision underline"
                    href={`options.html?doc=${encodeURIComponent(props.docId)}`}
                  >
                    {strings.app.optionsLink}
                  </a>
                </footer>
              </main>
            )}
          </Show>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
};

const App: Component<ReplayAppProps> = (props) => {
  const params = new URLSearchParams(window.location.search);
  const rawDoc = params.get("doc");
  const userIndex = parseUserIndex(params.get("u"));

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
        <ReplaySurface docId={id()} userIndex={userIndex} store={store} useWorker={useWorker} />
      )}
    </Show>
  );
};

export default App;
