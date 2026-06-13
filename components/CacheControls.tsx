// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CacheControls (plan Phase 5 Step 8 / PRD §9.8). Clear cached data for the
// current document (when the options page was opened with a `?doc=`) or for every
// document, and show approximate usage. Destructive actions confirm first. Never
// displays raw data — only coarse byte figures.

import type { Component } from "solid-js";
import { createResource, Show } from "solid-js";
import type { DocId } from "@/lib/domain/model";
import { strings } from "@/lib/i18n/strings";
import type { RevisionStore } from "@/lib/store";

export interface CacheControlsProps {
  readonly store: RevisionStore;
  /** Present when the page was opened in the context of one document. */
  readonly docId: DocId | null;
  readonly onClearDocument: (docId: DocId) => Promise<void>;
  readonly onClearAll: () => Promise<void>;
}

function formatMib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CacheControls: Component<CacheControlsProps> = (props) => {
  const [usage, { refetch }] = createResource(() => props.store.estimateUsage());

  async function clearDocument(docId: DocId): Promise<void> {
    if (!window.confirm(strings.options.clearConfirm)) {
      return;
    }
    await props.onClearDocument(docId);
    void refetch();
  }

  async function clearAll(): Promise<void> {
    if (!window.confirm(strings.options.clearConfirm)) {
      return;
    }
    await props.onClearAll();
    void refetch();
  }

  return (
    <section class="dr-card" aria-labelledby="dr-cache-heading">
      <h2 id="dr-cache-heading" class="mb-2 font-medium">
        {strings.options.cacheHeading}
      </h2>

      <Show
        when={usage()?.quota ? usage() : undefined}
        fallback={
          <p class="mb-3 text-sm text-stone-500 dark:text-stone-400">
            {strings.options.usageUnknown}
          </p>
        }
      >
        {(estimate) => (
          <p class="dr-counter mb-3">
            {formatMib(estimate().usage)} / {formatMib(estimate().quota)}
          </p>
        )}
      </Show>

      <div class="flex flex-wrap gap-2">
        <Show when={props.docId}>
          {(docId) => (
            <button type="button" class="btn-secondary" onClick={() => void clearDocument(docId())}>
              {strings.options.clearCurrent}
            </button>
          )}
        </Show>
        <button type="button" class="btn-secondary" onClick={() => void clearAll()}>
          {strings.options.clearAll}
        </button>
      </div>
    </section>
  );
};

export default CacheControls;
