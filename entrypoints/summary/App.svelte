<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Document-summary page — the "advanced view" linked from the replay surface. It
  // is a READ-ONLY view over the replay publication the replay page already built:
  // it never triggers retrieval, spins a worker, or runs the pipeline. It validates
  // its own `?doc=` id from the URL, applies the theme, reads the document's active
  // replay publication via the pure `loadReplayData`, and renders the content-free
  // charts (components/DocumentSummary). If no publication exists yet, it points the
  // user back to the replay to build the history first.
  //
  // Svelte allows one component per file, so the surface and the status card are
  // siblings (./SummarySurface.svelte, ./StatusCard.svelte).

  import { IconHistory } from "@/components/common/icons";
  import { useThemeSync } from "@/components/common/theme-sync.svelte";
  import { asDocId } from "@/lib/core/domain/ids";
  import type { DocumentKind } from "@/lib/core/domain/kind";
  import type { DocId } from "@/lib/core/domain/model";
  import { errorTitle } from "@/lib/core/i18n/strings";
  import { retrievalError } from "@/lib/core/retrieval/errors";
  import type { RevisionStore } from "@/lib/core/store";
  import { createIdbStore } from "@/lib/platform/db";
  import StatusCard from "./StatusCard.svelte";
  import SummarySurface from "./SummarySurface.svelte";

  export interface SummaryAppProps {
    /** Bulk store (page realm). Injected in tests; defaults to the idb backend. */
    readonly store?: RevisionStore | undefined;
  }

  /** Validate the `?doc=` id from the URL; an unparseable id reads as absent.
   *  (A named helper rather than a reassigned `let`: the value is settled once at
   *  setup and read from the template, which Svelte wants declared as a constant.) */
  function parseDocId(raw: string | null): DocId | null {
    if (raw === null) return null;
    try {
      return asDocId(raw);
    } catch {
      return null;
    }
  }

  let { store }: SummaryAppProps = $props();

  const params = new URLSearchParams(window.location.search);
  const rawDoc = params.get("doc");
  // Mirror the replay route's parse (entrypoints/replay/App.svelte) so a Sheets/Slides
  // summary opened before its publication exists still round-trips its kind back.
  const kindParam = params.get("kind");
  const kind: DocumentKind =
    kindParam === "sheet" ? "sheet" : kindParam === "slides" ? "slides" : "doc";

  const docId = parseDocId(rawDoc);

  // Theme applies even on the error screen.
  useThemeSync();

  // Read ONCE at setup, exactly as Solid's `props.store ?? createIdbStore()` did:
  // the store is an injection point for tests, never swapped on a live page, and
  // re-resolving it reactively would construct a second idb backend.
  // svelte-ignore state_referenced_locally
  const resolvedStore = store ?? createIdbStore();
</script>

<div class="dr-page">
  {#if docId}
    {@const id = docId}
    <SummarySurface docId={id} store={resolvedStore} {kind} />
  {:else}
    <main class="mx-auto flex max-w-[64rem] flex-col gap-6 p-6 sm:p-8">
      <StatusCard
        icon={IconHistory}
        title={errorTitle("missing-doc-id")}
        body={retrievalError("missing-doc-id").userMessage}
      />
    </main>
  {/if}
</div>
