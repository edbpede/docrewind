// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SummaryInsights (plan Phase 5 Step 5f / PRD §9.7). Derived, content-free
// insights over the injected revisions + timeline — all values via `createMemo`,
// rendered with `<For>`. No identity is exposed by default: authors show as
// opaque "Author N" labels unless `realIdentities` is on (and even then the
// underlying `UserId` is already an opaque per-document token, never a real name).

import type { Component } from "solid-js";
import { createMemo, For, mergeProps, Show } from "solid-js";
import type { DecodedRevision, TimelineEvent } from "@/lib/domain/model";
import { authorLabel, strings } from "@/lib/i18n/strings";

interface AuthorLabel {
  readonly key: string;
  readonly label: string;
}

export interface SummaryInsightsProps {
  readonly revisions: readonly DecodedRevision[];
  readonly timeline: readonly TimelineEvent[];
  /** When false (default), authors render as opaque labels only. */
  readonly realIdentities?: boolean;
}

const SummaryInsights: Component<SummaryInsightsProps> = (rawProps) => {
  const props = mergeProps({ realIdentities: false }, rawProps);

  const stats = createMemo(() => {
    let sessions = 0;
    let largeEdits = 0;
    let pauses = 0;
    for (const event of props.timeline) {
      switch (event.kind) {
        case "session":
          sessions += 1;
          break;
        case "large-insertion":
        case "large-deletion":
          largeEdits += 1;
          break;
        case "pause":
          pauses += 1;
          break;
        default: {
          const _exhaustive: never = event;
          void _exhaustive;
        }
      }
    }
    return [
      { key: "sessions", label: strings.insights.sessions, value: sessions },
      { key: "largeEdits", label: strings.insights.largeEdits, value: largeEdits },
      { key: "pauses", label: strings.insights.pauses, value: pauses },
      { key: "span", label: strings.insights.span, value: props.revisions.length },
    ];
  });

  // Distinct authors in first-seen order, projected to opaque (or raw-opaque)
  // labels. Built with an accumulator (not `.map`) so list construction stays a
  // pure derivation feeding `<For>`, never inline render logic.
  const authors = createMemo<readonly AuthorLabel[]>(() => {
    const seen: string[] = [];
    const projected: AuthorLabel[] = [];
    for (const revision of props.revisions) {
      if (revision.userId !== null && !seen.includes(revision.userId)) {
        seen.push(revision.userId);
        const label = props.realIdentities ? revision.userId : authorLabel(seen.length - 1);
        projected.push({ key: revision.userId, label });
      }
    }
    return projected;
  });

  return (
    <section class="dr-card" aria-label={strings.insights.heading}>
      <h2 class="dr-eyebrow mb-2">{strings.insights.heading}</h2>
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <For each={stats()}>
          {(stat) => (
            <div>
              <dt class="text-xs text-stone-500 dark:text-stone-400">{stat.label}</dt>
              <dd class="font-mono text-lg tabular-nums">{stat.value}</dd>
            </div>
          )}
        </For>
      </dl>
      <Show when={authors().length > 0}>
        <ul class="mt-3 flex flex-wrap gap-2">
          <For each={authors()}>
            {(author) => (
              <li class="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-600 dark:border-stone-600 dark:text-stone-300">
                {author.label}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
};

export default SummaryInsights;
