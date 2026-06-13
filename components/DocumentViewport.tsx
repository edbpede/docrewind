// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DocumentViewport (plan Phase 5 Step 5d / PRD §9.6). Renders the reconstructed
// document as a sequence of `Segment`s — never raw response bodies. Each state
// pairs color with a non-color affordance: suggestions get a dotted underline,
// deletions a strike, opaque structures a labeled chip (§9.11). A visually-hidden
// label names each non-accepted run for screen readers. The reading column uses
// `dir="auto"` for RTL scripts (§9.12). NON-VIRTUALIZED in Phase 5; segments are
// length-changing across frames, so `<For>` (reference-keyed) is correct.

import type { Component } from "solid-js";
import { For, Match, Show, Switch } from "solid-js";
import { strings } from "@/lib/i18n/strings";
import type { Segment } from "@/lib/reconstruction/render";

export interface DocumentViewportProps {
  readonly segments: readonly Segment[];
}

const DocumentViewport: Component<DocumentViewportProps> = (props) => {
  return (
    <Show
      when={props.segments.length > 0}
      fallback={
        <p class="doc-column italic text-stone-500 dark:text-stone-400">{strings.viewport.empty}</p>
      }
    >
      <article class="doc-column" dir="auto">
        <For each={props.segments}>
          {(segment) => (
            <Switch>
              <Match when={segment.kind === "accepted-text" && segment}>
                {(seg) => <span class="doc-accepted">{seg().text}</span>}
              </Match>
              <Match when={segment.kind === "suggested-insert" && segment}>
                {(seg) => (
                  <span class="doc-suggest">
                    <span class="sr-only">{strings.viewport.suggestedInsert}: </span>
                    {seg().text}
                  </span>
                )}
              </Match>
              <Match when={segment.kind === "marked-for-deletion" && segment}>
                {(seg) => (
                  <span class="doc-strike">
                    <span class="sr-only">{strings.viewport.markedForDeletion}: </span>
                    {seg().text}
                  </span>
                )}
              </Match>
              <Match when={segment.kind === "opaque-placeholder" && segment}>
                {(seg) => (
                  <span class="doc-opaque" title={seg().label}>
                    <span aria-hidden="true">▤</span>
                    <span>{seg().label}</span>
                  </span>
                )}
              </Match>
            </Switch>
          )}
        </For>
      </article>
    </Show>
  );
};

export default DocumentViewport;
