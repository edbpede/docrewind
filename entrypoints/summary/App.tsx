// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Document-summary page — the "advanced view" linked from the replay surface. It
// is a READ-ONLY view over the replay publication the replay page already built:
// it never triggers retrieval, spins a worker, or runs the pipeline. It validates
// its own `?doc=` id from the URL, applies the theme, reads the document's active
// replay publication via the pure `loadReplayData`, and renders the content-free
// charts (components/DocumentSummary). If no publication exists yet, it points the
// user back to the replay to build the history first.

import type { Component } from "solid-js";
import { createResource, ErrorBoundary, Show, Suspense } from "solid-js";
import BrandMark from "@/components/common/BrandMark";
import { IconArrowLeft, IconChart, IconHistory } from "@/components/common/icons";
import PrivacyBanner from "@/components/common/PrivacyBanner";
import ThemeControl from "@/components/common/ThemeControl";
import { useThemeSync } from "@/components/common/theme-sync";
import DocumentSummary from "@/components/summary/DocumentSummary";
import { asDocId } from "@/lib/core/domain/ids";
import type { DocumentKind } from "@/lib/core/domain/kind";
import type { DocId } from "@/lib/core/domain/model";
import { errorTitle, strings } from "@/lib/core/i18n/strings";
import { loadReplayData, type ReplayLoadResult } from "@/lib/core/replay/load";
import { retrievalError } from "@/lib/core/retrieval/errors";
import { deriveSheetsSummary } from "@/lib/core/sheets/reconstruction/derive";
import { deriveSlidesSummary } from "@/lib/core/slides/reconstruction/derive";
import type { RevisionStore } from "@/lib/core/store";
import { deriveDocumentSummary } from "@/lib/core/summary/derive";
import { createIdbStore } from "@/lib/platform/db";

export interface SummaryAppProps {
  /** Bulk store (page realm). Injected in tests; defaults to the idb backend. */
  readonly store?: RevisionStore;
}

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

/** A centered status card (loading / missing / error). Calm, plain-language, with
 *  one clear recovery action. */
const StatusCard: Component<{
  readonly icon: Component<{ readonly size?: number }>;
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly label: string; readonly href: string };
}> = (props) => (
  <section class="dr-card flex flex-col items-center gap-3 py-10 text-center">
    <span class="text-ink-muted">
      <props.icon size={32} />
    </span>
    <h2 class="dr-heading">{props.title}</h2>
    <p class="text-ink-muted" style={{ "max-width": "32rem" }}>
      {props.body}
    </p>
    <Show when={props.action}>
      {(action) => (
        <a class="btn-primary mt-1 inline-flex items-center gap-1.5" href={action().href}>
          {action().label}
        </a>
      )}
    </Show>
  </section>
);

/** The summary surface for a validated document id. */
const SummarySurface: Component<{
  readonly docId: DocId;
  readonly store: RevisionStore;
  /** Incoming URL kind, used as the back-link fallback until a publication loads. */
  readonly kind: DocumentKind;
}> = (props) => {
  const [result] = createResource(
    () => props.docId,
    (docId) => loadReplayData(props.store, docId),
  );
  // Derive the content-free summary by kind: Docs count characters, Sheets count
  // cell edits, Slides count text characters (all via the shared summary core). A
  // miss / stub yields undefined.
  const summary = () => {
    const value = result();
    if (value === undefined) return undefined;
    if (value.kind === "ok") return deriveDocumentSummary(value.data.revisions);
    if (value.kind === "ok-sheet") return deriveSheetsSummary(value.data.revisions);
    if (value.kind === "ok-slides") return deriveSlidesSummary(value.data.revisions);
    return undefined;
  };

  return (
    <main class="mx-auto flex max-w-[64rem] flex-col gap-6 p-6 sm:p-8">
      <header class="dr-masthead">
        <div class="flex items-center justify-between gap-3">
          <a
            class="dr-link inline-flex items-center gap-1.5"
            href={replayHref(props.docId, replayKind(result(), props.kind))}
          >
            <IconArrowLeft size={16} />
            {strings.summary.backToReplay}
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

      <ErrorBoundary
        fallback={
          <StatusCard
            icon={IconHistory}
            title={strings.app.loadFailed}
            body={strings.app.loadFailedHint}
          />
        }
      >
        <Suspense
          fallback={
            <StatusCard
              icon={IconChart}
              title={strings.summary.loading}
              body={strings.summary.subtitle}
            />
          }
        >
          <Show
            when={summary()}
            fallback={
              <StatusCard
                icon={IconHistory}
                title={strings.summary.missingTitle}
                body={strings.summary.missingHint}
                action={{
                  label: strings.summary.openReplay,
                  href: replayHref(props.docId, replayKind(result(), props.kind)),
                }}
              />
            }
          >
            {(derived) => <DocumentSummary summary={derived()} />}
          </Show>
        </Suspense>
      </ErrorBoundary>
    </main>
  );
};

const App: Component<SummaryAppProps> = (props) => {
  const params = new URLSearchParams(window.location.search);
  const rawDoc = params.get("doc");
  // Mirror the replay route's parse (entrypoints/replay/App.tsx) so a Sheets/Slides
  // summary opened before its publication exists still round-trips its kind back.
  const kindParam = params.get("kind");
  const kind: DocumentKind =
    kindParam === "sheet" ? "sheet" : kindParam === "slides" ? "slides" : "doc";

  let docId: DocId | null = null;
  try {
    docId = rawDoc !== null ? asDocId(rawDoc) : null;
  } catch {
    docId = null;
  }

  // Theme applies even on the error screen.
  useThemeSync();

  const store = props.store ?? createIdbStore();

  return (
    <div class="dr-page">
      <Show
        when={docId}
        fallback={
          <main class="mx-auto flex max-w-[64rem] flex-col gap-6 p-6 sm:p-8">
            <StatusCard
              icon={IconHistory}
              title={errorTitle("missing-doc-id")}
              body={retrievalError("missing-doc-id").userMessage}
            />
          </main>
        }
      >
        {(id) => <SummarySurface docId={id()} store={store} kind={kind} />}
      </Show>
    </div>
  );
};

export default App;
