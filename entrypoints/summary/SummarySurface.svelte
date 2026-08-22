<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The summary surface for a validated document id. Lifted out of `summary/App`
  // because Svelte allows one component per file.
  //
  // `replayKind` and `replayHref` are PURE and shared by both back-links on this
  // surface, so they live in the module script: evaluated once per module rather
  // than once per instance, and never able to close over reactive state by mistake.
  // `replayHref` builds the PUBLIC back-link URL (`replay.html?doc=…&kind=…`) and
  // four tests in test/summary.app.test.ts assert its exact output byte-for-byte —
  // do not change its logic.

  import type { DocumentKind } from "@/lib/core/domain/kind";
  import type { DocId } from "@/lib/core/domain/model";
  import type { ReplayLoadResult } from "@/lib/core/replay/load";

  // The replay URL kind for the back-link. A resolved publication decides the kind
  // (Docs → "doc" keeps the URL bare; Sheets/Slides round-trip so the replay route
  // retries the right Google endpoint). While still loading or when no publication
  // exists, there is no resolved kind, so we preserve the incoming URL `kind` —
  // otherwise a Sheets/Slides missing-publication link would send replay back into
  // the Docs pipeline.
  function replayKind(result: ReplayLoadResult | undefined, fallback: DocumentKind): DocumentKind {
    if (result?.kind === "ok-sheet") return "sheet";
    if (result?.kind === "ok-slides") return "slides";
    if (result?.kind === "ok") return "doc";
    return fallback;
  }

  function replayHref(docId: DocId, kind: DocumentKind = "doc"): string {
    const base = `replay.html?doc=${encodeURIComponent(docId)}`;
    return kind === "doc" ? base : `${base}&kind=${kind}`;
  }

  /**
   * The three states Solid expressed as `createResource` + `<Suspense>` +
   * `<ErrorBoundary>`: in flight, settled with a value, settled with a rejection.
   */
  type LoadState =
    | { readonly status: "pending" }
    | { readonly status: "ok"; readonly value: ReplayLoadResult }
    | { readonly status: "failed" };
</script>

<script lang="ts">
  import BrandMark from "@/components/common/BrandMark.svelte";
  import { IconArrowLeft, IconChart, IconHistory } from "@/components/common/icons";
  import PrivacyBanner from "@/components/common/PrivacyBanner.svelte";
  import ThemeControl from "@/components/common/ThemeControl.svelte";
  import DocumentSummary from "@/components/summary/DocumentSummary.svelte";
  import { strings } from "@/lib/core/i18n/strings";
  import { loadReplayData } from "@/lib/core/replay/load";
  import { deriveSheetsSummary } from "@/lib/core/sheets/reconstruction/derive";
  import { deriveSlidesSummary } from "@/lib/core/slides/reconstruction/derive";
  import type { RevisionStore } from "@/lib/core/store";
  import { deriveDocumentSummary } from "@/lib/core/summary/derive";
  import StatusCard from "./StatusCard.svelte";

  export interface SummarySurfaceProps {
    readonly docId: DocId;
    readonly store: RevisionStore;
    /** Incoming URL kind, used as the back-link fallback until a publication loads. */
    readonly kind: DocumentKind;
  }

  let { docId, store, kind }: SummarySurfaceProps = $props();

  // Solid held ONE `createResource` and read it in two places: the masthead read it
  // WITHOUT suspending (so the back-link renders immediately with the URL's kind and
  // upgrades once the publication resolves), while the body read it under
  // <Suspense>. A single load-state value reproduces that exactly — one write moves
  // the header href and the body together, in one batch — which is why this is a
  // `$state` result with `{#if}` rather than an `{#await}` on a promise the two
  // readers would have to subscribe to separately.
  //
  // `$state.raw`, not `$state`: the resolved value carries the whole decoded
  // revision array. A deep proxy would be pure overhead here (nothing mutates it in
  // place — it is only ever replaced wholesale) and would hand the pure `derive*`
  // cores proxied objects instead of the plain ones they are tested against.
  let load = $state.raw<LoadState>({ status: "pending" });

  // Solid's non-suspending `result()`: undefined while in flight or after a failure.
  const result = $derived(load.status === "ok" ? load.value : undefined);

  // Replaces `createResource(() => props.docId, (id) => loadReplayData(props.store, id))`.
  // The resource's SOURCE was `docId` alone; this effect also reads `store`, so it
  // tracks one dependency more than the resource did and would additionally refetch
  // if the store were swapped. Unreachable in practice — App resolves the store once
  // and computes docId once from the URL, and neither ever changes — but the tracking
  // sets are not identical, so do not treat this as a like-for-like translation.
  $effect(() => {
    const currentStore = store;
    const id = docId;
    let live = true;
    load = { status: "pending" };
    void loadReplayData(currentStore, id).then(
      (value) => {
        if (live) load = { status: "ok", value };
      },
      () => {
        if (live) load = { status: "failed" };
      },
    );
    return () => {
      live = false;
    };
  });

  // Derive the content-free summary by kind: Docs count characters, Sheets count
  // cell edits, Slides count text characters (all via the shared summary core). A
  // miss / stub yields undefined.
  const summary = $derived.by(() => {
    const value = result;
    if (value === undefined) return undefined;
    if (value.kind === "ok") return deriveDocumentSummary(value.data.revisions);
    if (value.kind === "ok-sheet") return deriveSheetsSummary(value.data.revisions);
    if (value.kind === "ok-slides") return deriveSlidesSummary(value.data.revisions);
    return undefined;
  });

  const backHref = $derived(replayHref(docId, replayKind(result, kind)));
</script>

<main class="mx-auto flex max-w-[64rem] flex-col gap-6 p-6 sm:p-8">
  <header class="dr-masthead">
    <div class="flex items-center justify-between gap-3">
      <!-- The icon and the label are written adjacent: Svelte collapses interior
           template whitespace into a real space, which would leak into this link's
           text node. -->
      <a class="dr-link inline-flex items-center gap-1.5" href={backHref}>
        <IconArrowLeft size={16} />{strings.summary.backToReplay}
      </a>
      <ThemeControl bare />
    </div>
    <div class="flex flex-col items-center gap-1.5 text-center">
      <div class="flex items-center gap-2.5">
        <BrandMark size={28} />
        <h1 class="dr-title">{strings.summary.title}</h1>
      </div>
      <p class="text-ink-muted">{strings.summary.subtitle}</p>
    </div>
    <PrivacyBanner />
  </header>

  <!-- Solid's <ErrorBoundary fallback={…}> in ELEMENT form: the fallback was a
       static card with no access to the error or a reset, so the `failed` snippet
       takes neither parameter. The boundary still catches a throw from the derive
       cores or from DocumentSummary's render; a REJECTED load is settled into
       `load.status === "failed"` and renders the same card. -->
  <svelte:boundary>
    {#snippet failed()}
      {@render loadFailedCard()}
    {/snippet}
    {#if load.status === "failed"}
      {@render loadFailedCard()}
    {:else if load.status === "pending"}
      <StatusCard
        icon={IconChart}
        title={strings.summary.loading}
        body={strings.summary.subtitle}
      />
    {:else if summary !== undefined}
      {@const derivedSummary = summary}
      <DocumentSummary summary={derivedSummary} />
    {:else}
      <StatusCard
        icon={IconHistory}
        title={strings.summary.missingTitle}
        body={strings.summary.missingHint}
        action={{ label: strings.summary.openReplay, href: backHref }}
      />
    {/if}
  </svelte:boundary>
</main>

{#snippet loadFailedCard()}
  <StatusCard
    icon={IconHistory}
    title={strings.app.loadFailed}
    body={strings.app.loadFailedHint}
  />
{/snippet}
