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
// collaborators carries no address (confirmed live against the wire format), so the
// email row is shown ONLY when an address is known and is omitted entirely otherwise.

import type { Component } from "solid-js";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  mergeProps,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { DecodedRevision, TimelineEvent } from "@/lib/domain/model";
import { authorActiveRange, formatDuration, strings } from "@/lib/i18n/strings";
import { type AuthorEntry, deriveAuthors } from "@/lib/identity/authors";
import type { IdentityMap } from "@/lib/identity/resolve";

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
  /**
   * Publishes the currently-foregrounded author (its opaque key, or null when none) so a
   * sibling surface — the DocumentViewport — can highlight that author's segments. Fires
   * whenever the hover/pin focus changes; the colophon still OWNS the interaction, this
   * only shares its result. The key is the stable opaque token, never the raw Gaia id.
   */
  readonly onActiveAuthorChange?: (key: string | null) => void;
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

  // Distinct authors in first-seen order, each carrying content-free tallies plus (when
  // resolution is on) its real-identity attributes. The derivation is the shared pure
  // `deriveAuthors` so this colophon and the replay surface's authorship attribution read
  // the IDENTICAL opaque keys, "Author N" numbering, and colours.
  const authors = createMemo<readonly AuthorEntry[]>(() =>
    // Read `realIdentities` first (always a dep), then `identities` ONLY when it's on. In
    // opaque mode `deriveAuthors` ignores identities, so passing the stable `{}` here skips
    // subscribing to the identity cache — and the false→true flip still recomputes because
    // `realIdentities` itself is the dep that fires, at which point identities is read.
    deriveAuthors(
      props.revisions,
      props.realIdentities,
      props.realIdentities ? props.identities : {},
    ),
  );

  // Detail-card visibility: a chip reveals its card on hover/focus (`hovered`) or stays
  // open when clicked (`pinned`). A pin wins, so the card persists while the pointer
  // moves into it (to select the email); Escape or an outside pointer-down releases it.
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [pinned, setPinned] = createSignal<string | null>(null);
  const openKey = (): string | null => pinned() ?? hovered();

  // Share the foregrounded author with the replay surface so it can highlight that
  // author's segments. A reactive `openKey()` read means this fires exactly when the
  // hover/pin focus changes — and degrades to a no-op when no consumer is wired.
  createEffect(() => {
    props.onActiveAuthorChange?.(openKey());
  });

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
                        <Show when={author.email}>
                          {(email) => (
                            <div class="author-pop-row">
                              <span class="author-pop-key">{strings.insights.authorEmail}</span>
                              <span class="author-pop-val">{email()}</span>
                            </div>
                          )}
                        </Show>
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
