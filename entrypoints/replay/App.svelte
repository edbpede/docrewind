<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Replay App orchestrator (plan Phase 5 Step 6). The replay page is the PRIMARY
  // surface and owns its full load lifecycle (Principle 4): it validates its own
  // docId from the URL, applies the theme, asks the background to start retrieval,
  // drives the parse worker (with a same-thread fallback), polls the persisted
  // checkpoint for content-free progress + stall detection, then composes the
  // surface from thin views over pure `lib/*` data.
  //
  // This file is the thin wrapper: URL parsing, the theme applier, and the
  // valid-docId gate. Everything from "start retrieval" onward lives in
  // `ReplaySurface.svelte`; the framework-free helpers live in `replay-app.ts`
  // (Svelte is one component per file, and a `.svelte` module cannot export the
  // pure functions the tests import).

  import { useThemeSync } from "@/components/common/theme-sync.svelte";
  import { asDocId } from "@/lib/core/domain/ids";
  import type { DocumentKind } from "@/lib/core/domain/kind";
  import type { DocId } from "@/lib/core/domain/model";
  import { errorTitle, strings } from "@/lib/core/i18n/strings";
  import { retrievalError } from "@/lib/core/retrieval/errors";
  import type { RevisionStore } from "@/lib/core/store";
  import { createIdbStore } from "@/lib/platform/db";
  import MessageCard from "./MessageCard.svelte";
  import { parseUserIndex } from "./replay-app";
  import ReplaySurface from "./ReplaySurface.svelte";

  export interface ReplayAppProps {
    /** Bulk store (page realm). Injected in tests; defaults to the idb backend. */
    readonly store?: RevisionStore | undefined;
    /** Force the same-thread pipeline when false (tests skip the Worker). */
    readonly useWorker?: boolean | undefined;
  }

  /** `asDocId` throws on a malformed id; an unusable `?doc=` is simply "no doc". */
  function parseDocId(raw: string | null): DocId | null {
    if (raw === null) {
      return null;
    }
    try {
      return asDocId(raw);
    } catch {
      return null;
    }
  }

  // `store ?? createIdbStore()` and `useWorker !== false` as `$props()` defaults:
  // an ABSENT prop takes the fallback, an explicit `false` still forces the
  // same-thread pipeline. Svelte evaluates a lazy fallback once, so the idb store
  // is created at most once per mount, exactly as the Solid setup body did.
  const { store = createIdbStore(), useWorker = true }: ReplayAppProps = $props();

  const params = new URLSearchParams(window.location.search);
  const userIndex = parseUserIndex(params.get("u"));
  const kindParam = params.get("kind");
  const kind: DocumentKind =
    kindParam === "sheet" ? "sheet" : kindParam === "slides" ? "slides" : "doc";

  const docId = parseDocId(params.get("doc"));

  // Theme applies even on the error screen.
  useThemeSync();
</script>

{#if docId}
  {@const id = docId}
  <ReplaySurface docId={id} {userIndex} {store} {useWorker} {kind} />
{:else}
  <div class="dr-page">
    <MessageCard
      title={errorTitle("missing-doc-id")}
      body={retrievalError("missing-doc-id").userMessage}
      actionLabel={strings.progress.retry}
      onAction={() => window.location.reload()}
    />
  </div>
{/if}
