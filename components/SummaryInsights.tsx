// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SummaryInsights (plan Phase 5 Step 5f / PRD §9.7). Derived, content-free
// insights over the injected revisions + timeline — all values via `createMemo`,
// rendered with `<For>`. With `realIdentities` on (the default), an author resolves
// to a real display name when one was harvested for the open document (see
// lib/identity/resolve.ts); an unresolved author — or the opt-out path — falls back
// to the stable opaque "Author N" label. The raw Gaia token is never shown.
//
// Each contributor chip is interactive: hovering/focusing it — or clicking to pin —
// lifts a small detail card with content-free attributes only (display name, the
// viewer's own email when known, a revision count, and the active window). Email is
// resolvable solely for the viewer themselves; the version-history feed that names
// collaborators carries no address, so a collaborator's card shows "Not available".

import type { Component } from "solid-js";
import { createMemo, createSignal, For, mergeProps, onCleanup, onMount, Show } from "solid-js";
import type { DecodedRevision, TimelineEvent } from "@/lib/domain/model";
import { authorActiveRange, authorLabel, formatDuration, strings } from "@/lib/i18n/strings";
import type { IdentityMap } from "@/lib/identity/resolve";

interface AuthorEntry {
  readonly key: string;
  /** Resolved display name, or the opaque "Author N" fallback. Never the raw Gaia token. */
  readonly label: string;
  /** The viewer's own email when known; null for collaborators (the feed has none). */
  readonly email: string | null;
  /** Google's assigned collaborator colour (hex), when the source carried one. */
  readonly color: string | null;
  /** Count of revisions attributed to this author. */
  readonly edits: number;
  /** First / last attributed revision time (epoch ms), or null when untimed. */
  readonly firstTime: number | null;
  readonly lastTime: number | null;
}

export interface SummaryInsightsProps {
  readonly revisions: readonly DecodedRevision[];
  readonly timeline: readonly TimelineEvent[];
  /** When false, authors render as opaque "Author N" labels only. Defaults to false
   * here (component-local default); the app passes the user's setting, which is on. */
  readonly realIdentities?: boolean;
  /**
   * Resolved author identities keyed by the opaque author token. Consulted only when
   * `realIdentities` is on; an absent/unresolved author falls back to its opaque
   * "Author N" label. Empty when resolution found nothing.
   */
  readonly identities?: IdentityMap;
}

const SummaryInsights: Component<SummaryInsightsProps> = (rawProps) => {
  const props = mergeProps({ realIdentities: false, identities: {} as IdentityMap }, rawProps);

  const stats = createMemo(() => {
    let sessions = 0;
    let largeEdits = 0;
    let pauses = 0;
    let firstTime: number | null = null;
    let lastTime: number | null = null;
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
    for (const revision of props.revisions) {
      if (revision.time === null) {
        continue;
      }
      const time = Number(revision.time);
      firstTime = firstTime === null ? time : Math.min(firstTime, time);
      lastTime = lastTime === null ? time : Math.max(lastTime, time);
    }
    const duration =
      firstTime === null || lastTime === null
        ? strings.insights.durationUnknown
        : formatDuration(lastTime - firstTime);
    return [
      { key: "sessions", label: strings.insights.sessions, value: sessions },
      { key: "largeEdits", label: strings.insights.largeEdits, value: largeEdits },
      { key: "pauses", label: strings.insights.pauses, value: pauses },
      { key: "span", label: strings.insights.span, value: props.revisions.length },
      { key: "duration", label: strings.insights.duration, value: duration },
    ];
  });

  // Distinct authors in first-seen order, each carrying its real-identity attributes
  // (when resolution is on) plus content-free per-author tallies (revision count, first
  // and last edit time) accumulated in one pass. A mutable accumulator is pushed in
  // first-seen order so the opaque "Author N" numbering stays stable, then projected to
  // the immutable entry list `<For>` consumes — list construction remains a pure
  // derivation, never inline render logic. Each distinct author token yields ONE entry,
  // so a single person is a single chip even across many editing sessions.
  const authors = createMemo<readonly AuthorEntry[]>(() => {
    interface Tally {
      readonly key: string;
      edits: number;
      first: number | null;
      last: number | null;
    }
    const order: Tally[] = [];
    const byId = new Map<string, Tally>();
    for (const revision of props.revisions) {
      const id = revision.userId;
      if (id === null) {
        continue;
      }
      let tally = byId.get(id);
      if (tally === undefined) {
        tally = { key: id, edits: 0, first: null, last: null };
        byId.set(id, tally);
        order.push(tally);
      }
      tally.edits += 1;
      if (revision.time !== null) {
        const time = Number(revision.time);
        tally.first = tally.first === null ? time : Math.min(tally.first, time);
        tally.last = tally.last === null ? time : Math.max(tally.last, time);
      }
    }
    return order.map((tally, index) => {
      const identity = props.realIdentities ? props.identities[tally.key] : undefined;
      return {
        key: tally.key,
        label: identity?.name ?? authorLabel(index),
        email: identity?.email ?? null,
        color: identity?.color ?? null,
        edits: tally.edits,
        firstTime: tally.first,
        lastTime: tally.last,
      } satisfies AuthorEntry;
    });
  });

  // Detail-card visibility: a chip reveals its card on hover/focus (`hovered`) or stays
  // open when clicked (`pinned`). A pin wins, so the card persists while the pointer
  // moves into it (to select the email); Escape or an outside pointer-down releases it.
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [pinned, setPinned] = createSignal<string | null>(null);
  const openKey = (): string | null => pinned() ?? hovered();

  let listEl: HTMLUListElement | undefined;
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(null);
        setHovered(null);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (listEl !== undefined && !listEl.contains(event.target as Node)) {
        setPinned(null);
        setHovered(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    });
  });

  const clearHover = (key: string) => setHovered((current) => (current === key ? null : current));

  return (
    <section class="dr-card" aria-label={strings.insights.heading}>
      <h2 class="dr-eyebrow mb-2">{strings.insights.heading}</h2>
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <For each={stats()}>
          {(stat) => (
            <div class="flex flex-col gap-0.5">
              <dt class="dr-eyebrow">{stat.label}</dt>
              <dd class="font-mono text-lg tabular-nums text-stone-800 dark:text-stone-100">
                {stat.value}
              </dd>
            </div>
          )}
        </For>
      </dl>
      <Show when={authors().length > 0}>
        <div class="mt-3 flex flex-col gap-2">
          <ul ref={listEl} class="flex flex-wrap gap-2">
            <For each={authors()}>
              {(author, index) => {
                // A row-index id (never the raw Gaia token) links the chip to its card
                // for assistive tech via aria-controls/aria-expanded.
                const cardId = `dr-author-card-${index()}`;
                return (
                  <li
                    class="relative"
                    onPointerEnter={() => setHovered(author.key)}
                    onPointerLeave={() => clearHover(author.key)}
                    onFocusIn={() => setHovered(author.key)}
                    onFocusOut={() => clearHover(author.key)}
                  >
                    <button
                      type="button"
                      class="author-chip"
                      aria-expanded={openKey() === author.key}
                      aria-controls={cardId}
                      onClick={() => {
                        setPinned((current) => (current === author.key ? null : author.key));
                        // Pin and hover never both hold a value, so `openKey()` is
                        // unambiguous: unpinning a chip closes its card even if the
                        // pointer is still over it (a missed pointerleave can't strand it).
                        setHovered(null);
                      }}
                    >
                      <Show when={author.color}>
                        {(color) => (
                          <span
                            class="author-dot"
                            aria-hidden="true"
                            style={{ "background-color": color() }}
                          />
                        )}
                      </Show>
                      {author.label}
                    </button>
                    <Show when={openKey() === author.key}>
                      <div class="author-pop" id={cardId}>
                        <p class="author-pop-name">
                          <Show when={author.color}>
                            {(color) => (
                              <span
                                class="author-dot"
                                aria-hidden="true"
                                style={{ "background-color": color() }}
                              />
                            )}
                          </Show>
                          {author.label}
                        </p>
                        <div class="author-pop-row">
                          <span class="author-pop-key">{strings.insights.authorEmail}</span>
                          <span class="author-pop-val">
                            {author.email ?? strings.insights.authorEmailUnknown}
                          </span>
                        </div>
                        <div class="author-pop-row">
                          <span class="author-pop-key">{strings.insights.authorEdits}</span>
                          <span class="author-pop-val">{author.edits}</span>
                        </div>
                        <Show
                          when={
                            author.firstTime !== null &&
                            author.lastTime !== null &&
                            author.lastTime > author.firstTime
                          }
                        >
                          <div class="author-pop-row">
                            <span class="author-pop-key">{strings.insights.authorActive}</span>
                            <span class="author-pop-val">
                              {formatDuration((author.lastTime ?? 0) - (author.firstTime ?? 0))}
                            </span>
                          </div>
                        </Show>
                        <Show when={author.firstTime !== null && author.lastTime !== null}>
                          <p class="author-pop-range">
                            {authorActiveRange(author.firstTime ?? 0, author.lastTime ?? 0)}
                          </p>
                        </Show>
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
          <p class="text-xs text-stone-500 dark:text-stone-400">
            {strings.insights.attributionCaveat}
          </p>
        </div>
      </Show>
    </section>
  );
};

export default SummaryInsights;
