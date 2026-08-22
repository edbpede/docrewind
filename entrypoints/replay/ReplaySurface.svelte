<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // ReplaySurface — the active replay surface for a validated document (plan Phase 5
  // Step 6). The replay page is the PRIMARY surface and owns its full load lifecycle
  // (Principle 4): it asks the background to start retrieval, drives the parse worker
  // (with a same-thread fallback), polls the persisted checkpoint for content-free
  // progress + stall detection, then composes the surface from thin views over pure
  // `lib/*` data. Its own file because Svelte is one component per file; it was a
  // sibling `const ReplaySurface` inside the Solid `entrypoints/replay/App.tsx`.
  //
  // Scale-safety: `currentIndex` is an APPLIED-COUNT. `modelAtRevisionIndex` does
  // ALL time-travel; `segmentsAt` is SINGLE-ARG over that already-time-traveled
  // model. Nothing here passes an applied-count as a wire `RevisionId` `t`.
  //
  // THE RUN LEDGER IS DELIBERATELY NON-REACTIVE. `worker`, `nextRunId`,
  // `activeRunId`, `leasedRunIds`, `leaseRefreshTimers`, `pollTimer` and
  // `watchdogTimer` are plain `let`/`const`, never `$state`. They gate which run may
  // publish, fail, or stop timers; making them reactive would re-run the effects
  // below on every ledger mutation and re-open closed gates. `test/replay.app.test.ts`
  // exercises exactly that logic across 17 tests. DO NOT CONVERT THEM TO `$state`.

  import { onDestroy, onMount, untrack } from "svelte";
  import BrandMark from "@/components/common/BrandMark.svelte";
  import { IconChart, IconSettings } from "@/components/common/icons";
  import PrivacyBanner from "@/components/common/PrivacyBanner.svelte";
  import ThemeControl from "@/components/common/ThemeControl.svelte";
  import DocumentViewport from "@/components/replay/DocumentViewport.svelte";
  import PlaybackControls from "@/components/replay/PlaybackControls.svelte";
  import ProgressView, { type ProgressPhase } from "@/components/replay/ProgressView.svelte";
  import SummaryInsights from "@/components/replay/SummaryInsights.svelte";
  import Timeline from "@/components/replay/Timeline.svelte";
  import TimelineLegend from "@/components/replay/TimelineLegend.svelte";
  import GridViewport from "@/components/sheets/GridViewport.svelte";
  import SheetTabs, { SHEET_GRID_PANEL_ID, sheetTabId } from "@/components/sheets/SheetTabs.svelte";
  import SlideStrip, { SLIDE_PANEL_ID, slideTabId } from "@/components/slides/SlideStrip.svelte";
  import SlideViewport from "@/components/slides/SlideViewport.svelte";
  import { blocksAt } from "@/lib/core/docs/reconstruction/blocks";
  import { modelAtRevisionIndex } from "@/lib/core/docs/reconstruction/snapshot";
  import type { DocumentKind } from "@/lib/core/domain/kind";
  import type { DocId } from "@/lib/core/domain/model";
  import { type EditUnit, errorTitle, revisionOf, strings } from "@/lib/core/i18n/strings";
  import { deriveAuthors } from "@/lib/core/identity/authors";
  import type { IdentityMap } from "@/lib/core/identity/resolve";
  import {
    type DecodeOutcome,
    loadReplayData,
    publishDerivedData,
    publishSheetsDerivedData,
    publishSlidesDerivedData,
    runPipelineSameThread,
    runSheetsPipelineSameThread,
    runSlidesPipelineSameThread,
  } from "@/lib/core/replay/load";
  import { type RetrievalErrorCategory, retrievalError } from "@/lib/core/retrieval/errors";
  import type { Gid } from "@/lib/core/sheets/decoder/types";
  import { hasFidelityNotice } from "@/lib/core/sheets/reconstruction/render";
  import { gridAtRevisionIndex } from "@/lib/core/sheets/reconstruction/snapshot";
  import { slideIndexOfRevision } from "@/lib/core/slides/reconstruction/attribution";
  import {
    renderSlides,
    hasFidelityNotice as slidesHasFidelityNotice,
  } from "@/lib/core/slides/reconstruction/render";
  import { presentationAtRevisionIndex } from "@/lib/core/slides/reconstruction/snapshot";
  import type { RevisionStore } from "@/lib/core/store";
  import { sendMessage } from "@/lib/platform/messaging";
  import {
    createPendingStorageMaintenanceRequest,
    keepRawData,
    realIdentities,
    removePendingStorageMaintenance,
    resolvedIdentities,
    STORAGE_LEASE_REFRESH_MS,
    storageBudget,
    upsertPendingStorageMaintenance,
  } from "@/lib/platform/settings";
  import MessageCard from "./MessageCard.svelte";
  import {
    buildMarkers,
    checkpointPct,
    createPageSessionId,
    datelineFormat,
    isWorkerDecodeMessage,
    type LoadedReplay,
    NO_CHECKPOINT_MS,
    type NonReplayState,
    POLL_MS,
    STALL_POLLS,
    TICK_MS,
    TICK_MS_REDUCED,
    toLoaded,
  } from "./replay-app";

  export interface ReplaySurfaceProps {
    readonly docId: DocId;
    readonly userIndex: number | null;
    readonly store: RevisionStore;
    readonly useWorker: boolean;
    readonly kind: DocumentKind;
  }

  const { docId, userIndex, store, useWorker, kind }: ReplaySurfaceProps = $props();

  // Playback state (flat runes).
  let currentIndex = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  // Follow-caret: when on (default), the viewport auto-scrolls to keep the active edit
  // in view during non-linear playback. A genuine user scroll disengages it; the toggle
  // and a Timeline scrub re-engage it (see the viewport + scrub wiring below).
  let follow = $state(true);

  // Progress / liveness state (driven by the checkpoint poll + late ack).
  let phase = $state<ProgressPhase>("discovering");
  let pct = $state(0);
  let errorCategory = $state<RetrievalErrorCategory | null>(null);
  let nonReplayState = $state<NonReplayState | null>(null);
  let retrievalDoneRunId = $state<number | null>(null);

  let prefersReducedMotion = $state(false);

  // Scroll behaviour for the follow + jump: a single smooth glide at ≤1× reads well, but
  // an 8 fps step at 2×/4× outruns a ~400ms smooth scroll (it would perpetually lag), and
  // reduced-motion always wants an instant cut. Derived once; the viewport just consumes it.
  const followBehavior = $derived<ScrollBehavior>(
    prefersReducedMotion ? "auto" : playing && speed <= 1 ? "smooth" : "auto",
  );

  // Identity-display preference (default ON; opt-out). When on, an author resolves to
  // a real display name harvested for the open document (PRD §9.7); when the user has
  // opted out, names are never ingested into the reactive graph and authors stay opaque.
  let showRealIdentities = $state<boolean | undefined>(undefined);
  // Harvesting is asynchronous (the background tiles fetch + the content-script self
  // path both write the SESSION cache shortly after this page boots). Watch the store
  // so a late resolution still reaches the colophon without a manual refresh. The load
  // and watch are gated behind the preference: a user who opted out keeps the cache out
  // of the graph entirely.
  let identities = $state<IdentityMap | undefined>(undefined);

  /** The old `identities` resource fetcher; `refetch()` becomes calling it again. */
  async function refetchIdentities(): Promise<void> {
    identities = showRealIdentities === true ? await resolvedIdentities.getValue() : {};
  }

  // The old resource SOURCE was `showRealIdentities() ?? false`, and a FALSY Solid
  // source never invokes the fetcher — so the cache stays out of the graph entirely
  // for a user who opted out. This gate reproduces that exactly. `untrack` keeps the
  // ONLY dependency the preference itself.
  $effect(() => {
    if (showRealIdentities !== true) {
      return;
    }
    untrack(() => {
      void refetchIdentities();
    });
  });

  onMount(() => {
    void (async () => {
      showRealIdentities = await realIdentities.getValue();
    })();
    const unwatch = resolvedIdentities.watch(() => {
      if (showRealIdentities) {
        void refetchIdentities();
      }
    });
    return unwatch;
  });

  // Decode runs only AFTER retrieval completes (the worker reads raw chunks).
  // Either path writes one replay publication; replay reads resolve through the
  // document's active publication pointer so remounts do not need this page's id.
  let loaded = $state<LoadedReplay | undefined>(undefined);

  /** The old `loaded` resource fetcher, keyed on the run whose retrieval finished. */
  async function loadRun(runId: number): Promise<void> {
    const publicationId = publicationIdForRun(runId);
    let reconstructionStatus: "partial" | "complete" = "partial";
    try {
      const outcome = await decode(docId, runId, publicationId);
      if (outcome.kind !== "published") {
        if (outcome.kind === "empty") {
          const existing = toLoaded(await loadReplayData(store, docId));
          if (existing !== null) {
            reconstructionStatus = "complete";
            loaded = existing;
            return;
          }
        }
        if (outcome.kind !== "stale" && isActiveRun(runId)) {
          nonReplayState = outcome.kind;
        }
        loaded = undefined;
        return;
      }
      const result = toLoaded(await loadReplayData(store, docId, publicationId));
      if (result === null) {
        if (isActiveRun(runId)) {
          nonReplayState = "missing-publication";
        }
        loaded = undefined;
        return;
      }
      reconstructionStatus = "complete";
      loaded = result;
    } catch {
      if (isActiveRun(runId)) {
        nonReplayState = "failed";
      }
      loaded = undefined;
    } finally {
      if (isActiveRun(runId)) {
        await finishRunMaintenance(runId, reconstructionStatus);
      }
    }
  }

  // The old resource SOURCE: `null` means "no run has finished retrieval yet", and
  // Solid skipped the fetcher for it. A non-null id opens the decode gate for that
  // ONE run. `untrack` keeps the effect's only dependency the run id — the loader
  // reads props and the (non-reactive) run ledger, none of which may re-trigger it.
  $effect(() => {
    const runId = retrievalDoneRunId;
    if (runId === null) {
      return;
    }
    untrack(() => {
      void loadRun(runId);
    });
  });

  // ── The run ledger. PLAIN LOCALS — see the header note. ─────────────────────
  let worker: Worker | undefined;
  onDestroy(() => {
    worker?.terminate();
    for (const runId of [...leasedRunIds]) {
      void finishRunMaintenance(runId, "partial");
    }
    void sendMessage("cancelRetrieval", { docId }).catch(() => {});
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
    void sendMessage("beginDecodeLease", { docId }).catch(() => {});
    const timer = setInterval(() => {
      void sendMessage("refreshDecodeLease", { docId }).catch(() => {});
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
    await sendMessage("endDecodeLease", { docId }).catch(() => {});
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
      docId,
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
    targetDocId: DocId,
    runId: number,
    publicationId: string,
  ): Promise<DecodeOutcome> {
    if (useWorker && typeof Worker !== "undefined") {
      return decodeInWorker(targetDocId, runId, publicationId);
    }
    const options = { publicationId, shouldPublish: () => isActiveRun(runId) };
    if (kind === "sheet") return runSheetsPipelineSameThread(store, targetDocId, options);
    if (kind === "slides") return runSlidesPipelineSameThread(store, targetDocId, options);
    return runPipelineSameThread(store, targetDocId, options);
  }

  function decodeInWorker(
    targetDocId: DocId,
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
        if (
          !isWorkerDecodeMessage(message) ||
          message.docId !== targetDocId ||
          message.runId !== runId
        ) {
          resolve(isActiveRun(runId) ? { kind: "failed" } : { kind: "stale" });
          return;
        }
        if (!isActiveRun(runId) || message.kind !== "done") {
          resolve(message.kind === "done" ? { kind: "stale" } : { kind: message.kind });
          return;
        }
        const publishOptions = { publicationId, shouldPublish: () => isActiveRun(runId) };
        const publish =
          message.docKind === "sheet"
            ? publishSheetsDerivedData(store, targetDocId, message, publishOptions)
            : message.docKind === "slides"
              ? publishSlidesDerivedData(store, targetDocId, message, publishOptions)
              : publishDerivedData(store, targetDocId, message, publishOptions);
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
      localWorker.postMessage({ docId: targetDocId, runId, kind });
    });
  }

  // Derived playback views. `modelAtRevisionIndex` time-travels; `blocksAt` (over
  // `segmentsAt`) is single-arg over that model (no second time-cut).
  const maxIndex = $derived(loaded?.data.revisions.length ?? 0);
  const currentModel = $derived(
    loaded === undefined || loaded.kind !== "doc"
      ? undefined
      : modelAtRevisionIndex(loaded.data.replayIndex, currentIndex),
  );
  const currentBlocks = $derived(currentModel === undefined ? [] : blocksAt(currentModel));

  // ── Sheets grid views (the Docs deriveds above stay untouched) ──────────────
  // The active grid at the current frame, the active tab gid, and the §9 notice.
  let selectedGid = $state<Gid | null>(null);
  const currentGrid = $derived(
    loaded === undefined || loaded.kind !== "sheet"
      ? undefined
      : gridAtRevisionIndex(loaded.data.replayIndex, currentIndex),
  );
  // The tab to render: the user's selection if it still exists, else the first.
  const activeGid = $derived.by<Gid | null>(() => {
    const grid = currentGrid;
    if (grid === undefined || grid.order.length === 0) return null;
    const selected = selectedGid;
    if (selected !== null && grid.sheets.has(selected)) return selected;
    return grid.order[0] ?? null;
  });
  const currentSheet = $derived(
    currentGrid !== undefined && activeGid !== null ? currentGrid.sheets.get(activeGid) : undefined,
  );
  const gridHasFidelityNotice = $derived(
    currentGrid !== undefined && hasFidelityNotice(currentGrid),
  );
  // Reverse link for the grid tabpanel: name it by the active tab when one exists
  // (the tabs only render when there is at least one sheet).
  const sheetPanelLabelledBy = $derived(activeGid === null ? undefined : sheetTabId(activeGid));

  // ── Slides deck views (mirrors the Sheets grid views above) ─────────────────
  // The reconstructed deck at the current frame, the selected slide, and the §9 notice.
  let selectedSlide = $state(0);
  const currentPresentation = $derived(
    loaded === undefined || loaded.kind !== "slides"
      ? undefined
      : presentationAtRevisionIndex(loaded.data.replayIndex, currentIndex),
  );
  // Every slide projected for the current frame — feeds BOTH the filmstrip and the
  // active-slide lookup, so the thumbnails and the hero always agree.
  const deckSlides = $derived(
    currentPresentation === undefined ? [] : renderSlides(currentPresentation),
  );
  // Which slide the CURRENT revision edits — the "follow edits" target for a deck
  // (the Slides analogue of the Docs follow-caret). `currentIndex` is an applied
  // count, so the frame's revision is `revisions[currentIndex - 1]`; index 0 is the
  // blank pre-history page. Resolved against the POST-frame presentation so a shape
  // (or slide) born in this very revision maps correctly. Null when the revision
  // touches no user-visible slide (a template/layout op).
  const followedSlideIndex = $derived.by<number | null>(() => {
    const entry = loaded;
    const presentation = currentPresentation;
    const index = currentIndex;
    if (
      entry === undefined ||
      entry.kind !== "slides" ||
      presentation === undefined ||
      index <= 0
    ) {
      return null;
    }
    const revision = entry.data.revisions[index - 1];
    return revision === undefined ? null : slideIndexOfRevision(presentation, revision);
  });
  // The slide to show. While "Follow edits" is on we track the slide the current
  // revision edits, so playback walks the deck; otherwise we honour the user's pick.
  // Either target is clamped to this frame's slide count — e.g. scrubbing BACKWARD
  // to a revision that had fewer slides than the selected index. Follow falling back
  // to the selection (when the current revision touches no slide) keeps the view put
  // on a "no-slide" frame instead of snapping to slide 1.
  const activeSlideIndex = $derived.by(() => {
    const total = deckSlides.length;
    if (total === 0) return 0;
    const followed = follow ? followedSlideIndex : null;
    const target = followed ?? selectedSlide;
    return Math.min(Math.max(0, target), total - 1);
  });
  const currentSlide = $derived(deckSlides[activeSlideIndex]);
  // Mirror the followed slide into the selection WHILE following, so turning
  // "Follow edits" off leaves you on the slide you were watching (not snapped back
  // to a stale manual pick). A manual thumbnail pick disengages follow (the strip's
  // onSelect below), so this never fights the user. Slides-only and follow-only: the
  // early returns keep the effect a true no-op (no per-frame reruns) for Docs/Sheets
  // and while follow is off, holding no subscription to the edited slide until it
  // actually drives selection.
  $effect(() => {
    if (loaded?.kind !== "slides" || !follow) return;
    const followed = followedSlideIndex;
    if (followed !== null) selectedSlide = followed;
  });
  const slidesFidelityNotice = $derived(
    currentPresentation !== undefined && slidesHasFidelityNotice(currentPresentation),
  );
  // Reverse link for the slide tabpanel: name it by the active thumbnail tab (the
  // strip only renders when there is more than one slide).
  const slidePanelLabelledBy = $derived(
    deckSlides.length > 1 ? slideTabId(activeSlideIndex) : undefined,
  );

  // ── Authorship attribution (§9.7) ───────────────────────────────────────────
  // ONE shared author derivation feeds BOTH the colophon and the caret/highlight, so
  // they agree on opaque keys, "Author N" numbering, and assigned colours. Built off the
  // loaded revisions + the (opt-in) resolved identities — the same inputs the colophon uses.
  const authors = $derived(
    deriveAuthors(loaded?.data.revisions ?? [], showRealIdentities ?? false, identities ?? {}),
  );
  // author key → assigned hue (null when the source carried none); the caret + highlight
  // tints read it. Keyed by the stable opaque token, never the raw Gaia id.
  const colorByAuthorKey = $derived.by(() => {
    const map = new Map<string, string | null>();
    for (const author of authors) {
      map.set(author.key, author.color);
    }
    return map;
  });
  // revision id → author key: joins a rendered segment (which carries its insert
  // revision) back to its contributor. Stable per load.
  const authorKeyByRevision = $derived.by(() => {
    const map = new Map<number, string>();
    for (const revision of loaded?.data.revisions ?? []) {
      if (revision.userId !== null) {
        map.set(Number(revision.revisionId), revision.userId);
      }
    }
    return map;
  });

  // The colophon publishes which contributor is foregrounded (hover/pin) and the viewport
  // highlights that author's runs — the shared state lives HERE so the two sibling
  // surfaces both reach it. Off when nothing is foregrounded or identities are opt-out.
  let activeAuthorKey = $state<string | null>(null);
  const highlight = $derived.by(() => {
    const key = activeAuthorKey;
    if (key === null) {
      return null;
    }
    const author = authors.find((entry) => entry.key === key);
    if (author === undefined) {
      return null;
    }
    return { key, color: author.color, label: author.label };
  });

  // The writing caret follows the CURRENT frame's revision (`currentIndex` is an
  // applied-count, so the frame's revision is `revisions[currentIndex - 1]`); index 0 is
  // the blank page, before anything was written. Colour-coded to that revision's author.
  const caret = $derived.by(() => {
    const data = loaded;
    const index = currentIndex;
    if (data === undefined || index <= 0) {
      return null;
    }
    const revision = data.data.revisions[index - 1];
    if (revision === undefined) {
      return null;
    }
    const color = revision.userId !== null ? (colorByAuthorKey.get(revision.userId) ?? null) : null;
    return { revision: Number(revision.revisionId), color };
  });

  const markers = $derived.by(() => {
    const data = loaded;
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
  // the blank page, before anything was written. A lazy derived — no per-tick effect.
  const dateline = $derived.by(() => {
    const data = loaded;
    const index = currentIndex;
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

  // `runId` defaults explicitly rather than using an optional `?` parameter: the
  // Svelte compiler's TypeScript stripping leaves a bare `runId?` behind, which is
  // not valid JavaScript. Call sites are unchanged.
  function stopRunTimers(runId: number | undefined = undefined): void {
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
  onDestroy(() => {
    stopRunTimers();
  });

  function failRun(runId: number, category: RetrievalErrorCategory): void {
    if (!isActiveRun(runId)) {
      return;
    }
    errorCategory = category;
    phase = "error";
    stopRunTimers(runId);
    activeRunId = ++nextRunId;
    worker?.terminate();
    worker = undefined;
    retrievalDoneRunId = null;
    loaded = undefined;
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
    phase = "discovering";
    pct = 0;
    errorCategory = null;
    nonReplayState = null;
    retrievalDoneRunId = null;
    loaded = undefined;

    // Fire start; the ack resolves only at end-of-run, so it is the only
    // terminal signal allowed to open the decode gate for this page run.
    // Persisted completed checkpoints have no run id and can be stale.
    void sendMessage("startRetrieval", {
      docId,
      userIndex,
      kind,
    })
      .then((ack) => {
        if (!isActiveRun(runId)) {
          return;
        }
        if (!ack.ok) {
          failRun(runId, ack.error.category);
          return;
        }
        pct = 100;
        phase = "fetching";
        retrievalDoneRunId = runId;
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
          const checkpoint = await store.readCheckpoint(docId);
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

          pct = checkpointPct(next, Number(checkpoint.upperBound));
          phase = "fetching";
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
    void sendMessage("cancelRetrieval", { docId }).catch(() => {});
    startFlow();
  }

  function onCancel(): void {
    const cancelledRunId = activeRunId;
    activeRunId = ++nextRunId;
    worker?.terminate();
    worker = undefined;
    void sendMessage("cancelRetrieval", { docId }).catch(() => {});
    void finishRunMaintenance(cancelledRunId, "partial");
    stopRunTimers();
    retrievalDoneRunId = null;
    loaded = undefined;
    errorCategory = "cancellation";
    phase = "error";
  }

  // ── Lifecycle: reduced-motion, retrieval, playback ──────────────────────────
  // (Theme is applied once at the top-level App, which covers this subtree.)
  onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion = media.matches;
    const onChange = (): void => {
      prefersReducedMotion = media.matches;
    };
    media.addEventListener("change", onChange);

    startFlow();

    return () => media.removeEventListener("change", onChange);
  });

  // Playback tick, managed by an effect so the cadence rebuilds when the
  // reduced-motion preference flips (calmer cadence = less animation, without
  // stopping the data stepping). A fractional accumulator honors sub-1× speeds.
  // The effect tracks `playing` and the reduced-motion read only: `speed`/
  // `currentIndex` are read inside the interval callback, which runs outside the
  // effect's tracking scope, so there is still no per-frame effect churn. Gating
  // on `playing` means NO interval spins while paused — it is created on play and
  // torn down on pause/stop, so an open but idle replay tab does zero periodic
  // work (idle-time cost).
  let accumulator = 0;
  $effect(() => {
    if (!playing) return; // paused/stopped: no timer, no idle wakeups
    const interval = prefersReducedMotion ? TICK_MS_REDUCED : TICK_MS;
    const timer = setInterval(() => {
      if (!playing) {
        return;
      }
      const max = maxIndex;
      if (currentIndex >= max) {
        playing = false;
        return;
      }
      accumulator += speed;
      const step = Math.floor(accumulator);
      if (step >= 1) {
        accumulator -= step;
        currentIndex = Math.min(currentIndex + step, max);
      }
    }, interval);
    return () => clearInterval(timer);
  });

  function onPlayPause(): void {
    if (currentIndex >= maxIndex && !playing) {
      currentIndex = 0; // replay from the start if parked at the end
    }
    playing = !playing;
  }
</script>

{#snippet progressView()}
  <main class="mx-auto flex max-w-3xl flex-col gap-5 p-6 sm:p-8">
    <div class="flex items-center gap-2.5">
      <BrandMark size={32} />
      <span class="text-base font-semibold text-ink">{strings.app.brandName}</span>
    </div>
    <PrivacyBanner />
    <ProgressView {phase} {pct} {errorCategory} {onRetry} {onCancel} />
  </main>
{/snippet}

{#snippet nonReplay(state: NonReplayState)}
  {@const category = state === "unsupported" ? "unsupported-format" : "reconstruction-failure"}
  <MessageCard
    title={state === "empty"
      ? strings.app.emptyReplayTitle
      : state === "missing-publication"
        ? strings.app.loadFailed
        : errorTitle(category)}
    body={state === "empty" ? strings.app.emptyReplayHint : retrievalError(category).userMessage}
    actionLabel={strings.progress.retry}
    onAction={onRetry}
  />
{/snippet}

<div class="dr-page">
  <svelte:boundary>
    {#if nonReplayState}{@const state = nonReplayState}{@render nonReplay(state)}
    {:else if loaded}
      {@const data = loaded}
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
            <!-- The summary CTA rides at the top, next to the appearance
                 control, so the insights deep-dive is prevalent — not buried
                 below the leaf. A brand-soft pill that fills in on hover. -->
            <div class="flex shrink-0 items-center gap-2.5">
              <a
                class="dr-summary-cta"
                href={`summary.html?doc=${encodeURIComponent(docId)}${
                  kind === "doc" ? "" : `&kind=${kind}`
                }`}
              >
                <IconChart size={18} />
                <span>{strings.summary.title}</span>
              </a>
              <ThemeControl bare />
            </div>
          </div>
          <PrivacyBanner approximationNote={strings.privacy.approximationNote} />
        </header>

        <!-- The margin: transport + the writing-activity stratum, with the
             frame's revision count and archival dateline framing the scrubber. -->
        <section class="sticky top-0 z-20 flex flex-col gap-3 bg-canvas pt-1 pb-2">
          <PlaybackControls
            {playing}
            {speed}
            {onPlayPause}
            onRestart={() => {
              playing = false;
              currentIndex = 0;
            }}
            onSpeed={(value) => {
              speed = value;
            }}
            {follow}
            onFollowChange={(next) => {
              follow = next;
            }}
          />
          <div class="flex flex-col gap-1.5">
            <div class="flex items-baseline justify-between gap-3">
              <span class="dr-counter">{revisionOf(currentIndex, maxIndex)}</span>
              {#if dateline}{@const when = dateline}<span class="dr-dateline">{when}</span>{/if}
            </div>
            <Timeline
              {currentIndex}
              max={maxIndex}
              events={markers}
              onScrub={(index) => {
                currentIndex = index;
                follow = true; // a scrub is "take me here" — re-engage follow.
              }}
            />
            <TimelineLegend events={markers} />
          </div>
        </section>

        <!-- The leaf is the hero: the rebuilt manuscript sits directly
             under its transport, so the controls read as the margin of
             the page they drive. The caret + highlight surface authorship:
             who is writing now, and (on a colophon hover) who wrote what. -->
        {#if data.kind === "doc"}
          <DocumentViewport
            blocks={currentBlocks}
            {caret}
            {highlight}
            {authorKeyByRevision}
            {follow}
            scrollBehavior={followBehavior}
            onFollowOff={() => {
              follow = false;
            }}
            onFollowOn={() => {
              follow = true;
            }}
          />
        {:else if data.kind === "sheet"}
          <!-- The grid is reconstructed and ready, but THIS frame may
               hold no sheets — the empty pre-history base at revision 0,
               before the first sheet is added. A calm "empty here" note,
               never a "not ready" message: stepping forward reveals the
               grid the instant the first sheet op applies. -->
          {#if currentSheet}
            {@const sheet = currentSheet}
            <div class="flex flex-col gap-3">
              {#if currentGrid}
                {@const grid = currentGrid}
                <SheetTabs
                  model={grid}
                  {activeGid}
                  onSelect={(gid) => {
                    selectedGid = gid;
                  }}
                />
              {/if}
              <div
                role="tabpanel"
                id={SHEET_GRID_PANEL_ID}
                aria-labelledby={sheetPanelLabelledBy}
                tabindex="0"
              >
                <GridViewport {sheet} showFidelityNotice={gridHasFidelityNotice} />
              </div>
            </div>
          {:else}
            <div class="dr-card text-center">
              <p class="dr-subheading">{strings.sheet.emptyFrameTitle}</p>
              <p class="dr-muted mt-1">{strings.sheet.emptyFrameHint}</p>
            </div>
          {/if}
        {:else if data.kind === "slides"}
          <!-- The deck is reconstructed, but THIS frame may hold no slides
               yet (the pre-history base, before the first slide op). A calm
               "empty here" note; stepping forward reveals the deck the
               instant the first slide applies. -->
          {#if currentSlide}
            {@const slide = currentSlide}
            <div class="flex flex-col gap-3">
              <SlideStrip
                slides={deckSlides}
                activeIndex={activeSlideIndex}
                onSelect={(index) => {
                  // A manual slide pick is "let me look here" — it
                  // disengages follow so the choice sticks (the
                  // Slides mirror of a manual scroll disengaging the
                  // Docs follow-caret). The toggle or a scrub
                  // re-engages follow.
                  selectedSlide = index;
                  follow = false;
                }}
              />
              <!-- The tab semantics only apply when the filmstrip
                   (the tablist) renders — i.e. more than one slide.
                   A single-slide deck is a plain region, not an
                   orphaned, unnamed tabpanel. -->
              {#if deckSlides.length > 1}
                <div
                  role="tabpanel"
                  id={SLIDE_PANEL_ID}
                  aria-labelledby={slidePanelLabelledBy}
                  tabindex="0"
                >
                  <SlideViewport {slide} showFidelityNotice={slidesFidelityNotice} />
                </div>
              {:else}
                <SlideViewport {slide} showFidelityNotice={slidesFidelityNotice} />
              {/if}
            </div>
          {:else}
            <div class="dr-card text-center">
              <p class="dr-subheading">{strings.slide.emptyFrameTitle}</p>
              <p class="dr-muted mt-1">{strings.slide.emptyFrameHint}</p>
            </div>
          {/if}
        {/if}

        <!-- The colophon: content-free insights close the record. Foregrounding
             a contributor here highlights their runs on the leaf above. -->
        <SummaryInsights
          revisions={data.data.revisions}
          timeline={data.data.timeline}
          realIdentities={showRealIdentities ?? false}
          identities={identities ?? {}}
          onActiveAuthorChange={(key) => {
            activeAuthorKey = key;
          }}
        />
        <!-- Settings is a quiet utility, parked in the bottom-right corner —
             present and reachable, never competing with the record above. -->
        <footer class="flex justify-end pt-2">
          <a class="btn-ghost" href={`options.html?doc=${encodeURIComponent(docId)}`}>
            <IconSettings size={18} />
            <span>{strings.app.optionsLink}</span>
          </a>
        </footer>
      </main>
    {:else}{@render progressView()}{/if}

    {#snippet failed()}
      <MessageCard
        title={strings.app.loadFailed}
        body={strings.app.loadFailedHint}
        actionLabel={strings.progress.retry}
        onAction={() => window.location.reload()}
      />
    {/snippet}
  </svelte:boundary>
</div>
