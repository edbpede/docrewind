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
import BrandMark from "@/components/BrandMark";
import DocumentSummary from "@/components/DocumentSummary";
import { IconArrowLeft, IconChart, IconHistory } from "@/components/icons";
import PrivacyBanner from "@/components/PrivacyBanner";
import ThemeControl from "@/components/ThemeControl";
import { useThemeSync } from "@/components/theme-sync";
import { createIdbStore } from "@/lib/db";
import { asDocId } from "@/lib/domain/ids";
import type { DocId } from "@/lib/domain/model";
import { errorTitle, strings } from "@/lib/i18n/strings";
import { loadReplayData } from "@/lib/replay/load";
import { retrievalError } from "@/lib/retrieval/errors";
import type { RevisionStore } from "@/lib/store";

export interface SummaryAppProps {
  /** Bulk store (page realm). Injected in tests; defaults to the idb backend. */
  readonly store?: RevisionStore;
}

function replayHref(docId: DocId): string {
  return `replay.html?doc=${encodeURIComponent(docId)}`;
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
const SummarySurface: Component<{ readonly docId: DocId; readonly store: RevisionStore }> = (
  props,
) => {
  const [result] = createResource(
    () => props.docId,
    (docId) => loadReplayData(props.store, docId),
  );
  const data = () => {
    const value = result();
    return value !== undefined && value.kind === "ok" ? value.data : undefined;
  };

  return (
    <main class="mx-auto flex max-w-[64rem] flex-col gap-6 p-6 sm:p-8">
      <header class="dr-masthead">
        <div class="flex items-center justify-between gap-3">
          <a class="dr-link inline-flex items-center gap-1.5" href={replayHref(props.docId)}>
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
            when={data()}
            fallback={
              <StatusCard
                icon={IconHistory}
                title={strings.summary.missingTitle}
                body={strings.summary.missingHint}
                action={{ label: strings.summary.openReplay, href: replayHref(props.docId) }}
              />
            }
          >
            {(loaded) => <DocumentSummary revisions={loaded().revisions} />}
          </Show>
        </Suspense>
      </ErrorBoundary>
    </main>
  );
};

const App: Component<SummaryAppProps> = (props) => {
  const params = new URLSearchParams(window.location.search);
  const rawDoc = params.get("doc");

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
        {(id) => <SummarySurface docId={id()} store={store} />}
      </Show>
    </div>
  );
};

export default App;
