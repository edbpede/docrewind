// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CacheControls (plan Phase 5 Step 8 / PRD §9.8). Clear cached data for the
// current document (when the options page was opened with a `?doc=`) or for every
// document, and show approximate usage. Destructive actions confirm first. Never
// displays raw data — only coarse byte figures.

import type { Component } from "solid-js";
import { createResource, Show } from "solid-js";
import { IconInfo, IconTrash } from "@/components/common/icons";
import type { DocId } from "@/lib/core/domain/model";
import { strings } from "@/lib/core/i18n/strings";
import type { RevisionStore } from "@/lib/core/store";

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

  // The "Cached data" group heading is owned by the parent OptionsApp (one
  // heading per group); this component renders the storage readout + the clear
  // actions beneath the budget rows.
  return (
    <div class="dr-group">
      <Show
        when={usage()?.quota ? usage() : undefined}
        fallback={
          <p class="note-info" role="status">
            <IconInfo size={18} class="note-icon" />
            <span>{strings.options.usageUnknown}</span>
          </p>
        }
      >
        {(estimate) => (
          <div class="dr-rows">
            <div class="dr-row">
              <span class="dr-row-label">{strings.options.cacheHeading}</span>
              <span class="dr-counter">
                {formatMib(estimate().usage)} / {formatMib(estimate().quota)}
              </span>
            </div>
          </div>
        )}
      </Show>

      <div class="flex flex-wrap gap-2 px-1">
        <Show when={props.docId}>
          {(docId) => (
            <button type="button" class="btn-secondary" onClick={() => void clearDocument(docId())}>
              <IconTrash size={18} />
              {strings.options.clearCurrent}
            </button>
          )}
        </Show>
        <button type="button" class="btn-danger" onClick={() => void clearAll()}>
          <IconTrash size={18} />
          {strings.options.clearAll}
        </button>
      </div>
    </div>
  );
};

export default CacheControls;
