// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DocumentViewport (plan Phase 5 Step 5d / PRD §9.6 + §9.7 attribution). Renders
// the reconstructed document as a sequence of `Segment`s — never raw response
// bodies. Each state pairs color with a non-color affordance: suggestions get a
// dotted underline, deletions a strike, opaque structures a labeled chip (§9.11).
// The suggest/strike runs surface their descriptive label via a `data-doc-tip`
// attribute, painted by an instant CSS :hover tooltip (uno.config.ts) — NOT the
// native `title`, whose built-in ~1s appearance delay (reset on every scroll) made
// the label feel unresponsive. The inline `sr-only` span carries the same text for
// assistive tech. The reading column uses `dir="auto"` for RTL scripts (§9.12).
// NON-VIRTUALIZED in Phase 5; segments are length-changing across frames, so
// `<For>` (reference-keyed) is correct.
//
// Authorship attribution (§9.7) rides on top WITHOUT a re-render of the tree:
//  • A writing caret (nib) is painted after the run the CURRENT revision wrote,
//    colour-coded to that revision's author — a real-time "who is typing" cue.
//  • When a contributor is foregrounded in the colophon, every run attributed to
//    that author gets a themed underline (+ a faint tint on accepted text) via a
//    per-segment reactive style accessor, so only the affected spans restyle.
// Both derive their colour from the author's assigned hue, falling back to the
// revision indigo when the source carried none. Attribution joins on the stable
// opaque author key (never the raw Gaia token).

import type { Component, JSX } from "solid-js";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { contributedBy, strings } from "@/lib/i18n/strings";
import type { Segment } from "@/lib/reconstruction/render";

/** The active writing caret: the current revision and its author's colour. */
export interface DocumentCaret {
  /** The revision whose freshly-inserted run the caret trails. */
  readonly revision: number;
  /** The author's assigned hue, or null to fall back to the revision indigo. */
  readonly color: string | null;
}

/** The foregrounded contributor whose segments should be highlighted. */
export interface DocumentHighlight {
  /** The author's stable opaque key (matched against each segment's author). */
  readonly key: string;
  /** The author's assigned hue, or null to fall back to the revision indigo. */
  readonly color: string | null;
  /** The author's display label, for the off-screen attribution description. */
  readonly label: string;
}

export interface DocumentViewportProps {
  readonly segments: readonly Segment[];
  /** Active writing caret (playback), or null/absent to paint none. */
  readonly caret?: DocumentCaret | null;
  /** Foregrounded author to highlight, or null/absent for no highlight. */
  readonly highlight?: DocumentHighlight | null;
  /** Map from a revision id to its author's opaque key. Joins segments to authors. */
  readonly authorKeyByRevision?: ReadonlyMap<number, string>;
}

// The author hue when a contributor carried no assigned colour (the self-resolution
// path exposes none): the revision indigo, matching the playhead/caret accent.
const ATTRIBUTION_FALLBACK = "oklch(54% 0.13 264)";

// The off-screen description id that highlighted segments point at via aria-describedby.
const ATTR_DESC_ID = "dr-doc-attr-desc";

/** The inline style that paints an author highlight onto one run. */
function highlightStyle(color: string, kind: Segment["kind"]): JSX.CSSProperties {
  // A themed underline drawn as an inset bottom border — it never clobbers the
  // suggestion's dotted underline or the deletion's strike (those are `text-decoration`,
  // this is `box-shadow`), so the non-color affordance always survives (§9.11).
  const style: JSX.CSSProperties = {
    "box-shadow": `inset 0 -0.12em 0 0 ${color}`,
    "border-radius": "2px",
  };
  // A faint wash only on accepted text — suggest/strike already carry their own tinted
  // background, so layering a second tint there would muddy the state, not clarify it.
  if (kind === "accepted-text") {
    style["background-color"] = `color-mix(in srgb, ${color} 13%, transparent)`;
  }
  return style;
}

const DocumentViewport: Component<DocumentViewportProps> = (props) => {
  // The author key(s) a segment is attributed to. A run coalesces contiguous
  // same-kind chars regardless of which revision wrote each, so it can straddle
  // revisions with different authors (A opens it, B appends to its tail). The
  // model only exposes the run's two endpoints (`fromRevision` / `toRevision`),
  // so we attribute to whichever authors those endpoints map to — mirroring the
  // caret, which already consults both. Opaque placeholders / unattributed runs
  // contribute no keys. A `Set` so a single-revision run yields one key.
  const authorKeysOf = (segment: Segment): ReadonlySet<string> => {
    const keys = new Set<string>();
    if ("fromRevision" in segment) {
      const from = props.authorKeyByRevision?.get(Number(segment.fromRevision));
      if (from !== undefined) keys.add(from);
      const to = props.authorKeyByRevision?.get(Number(segment.toRevision));
      if (to !== undefined) keys.add(to);
    }
    return keys;
  };

  // The index of the run the caret trails: the LAST run the current revision touched —
  // either one it OPENED (`fromRevision`) or one it EXTENDED at the tail (`toRevision`,
  // the ordinary sequential-typing case, where its text coalesced into an older run).
  // Recomputed per frame (segments + caret both change on a tick); O(segments), trivial
  // beside the segment rebuild itself. -1 when the current revision left no visible run
  // (a pure deletion, or a strict mid-run insert) so no caret is painted that frame.
  const caretIndex = createMemo(() => {
    const caret = props.caret;
    if (caret === undefined || caret === null) {
      return -1;
    }
    let found = -1;
    props.segments.forEach((segment, index) => {
      if (
        "fromRevision" in segment &&
        (Number(segment.fromRevision) === caret.revision ||
          Number(segment.toRevision) === caret.revision)
      ) {
        found = index;
      }
    });
    return found;
  });

  const caretColor = (): string => props.caret?.color ?? ATTRIBUTION_FALLBACK;

  // The manuscript leaf: an elevated sheet with a ruled binding margin. Both the
  // written page and the blank-page note rest on the same paper so scrubbing back
  // to the start never drops out of the manuscript frame.
  return (
    <section class="dr-leaf">
      <Show
        when={props.segments.length > 0}
        fallback={
          <p class="doc-column italic text-stone-500 dark:text-stone-400">
            {strings.viewport.empty}
          </p>
        }
      >
        <article class="doc-column" dir="auto">
          {/* The off-screen attribution description, present only while an author is
              foregrounded; highlighted runs reference it so screen readers announce who
              contributed the run. `aria-live` so toggling the focus is announced. */}
          <Show when={props.highlight}>
            {(highlight) => (
              <span id={ATTR_DESC_ID} class="sr-only" aria-live="polite">
                {contributedBy(highlight().label)}
              </span>
            )}
          </Show>
          <For each={props.segments}>
            {(segment, index) => {
              // Highlighted iff this run's author is the foregrounded one. The DOM stays
              // put — `<For>` is reference-keyed, so no spans are recreated; only these
              // reactive style/aria accessors re-evaluate on a focus change, and only the
              // matching spans actually write to the DOM (the rest resolve to `undefined`).
              const highlighted = (): boolean => {
                const highlight = props.highlight;
                return (
                  highlight !== undefined &&
                  highlight !== null &&
                  authorKeysOf(segment).has(highlight.key)
                );
              };
              const attrStyle = (): JSX.CSSProperties | undefined =>
                highlighted()
                  ? highlightStyle(props.highlight?.color ?? ATTRIBUTION_FALLBACK, segment.kind)
                  : undefined;
              const describedBy = (): string | undefined =>
                highlighted() ? ATTR_DESC_ID : undefined;
              return (
                <>
                  <Switch>
                    <Match when={segment.kind === "accepted-text" && segment}>
                      {(seg) => (
                        <span
                          class="doc-accepted"
                          style={attrStyle()}
                          aria-describedby={describedBy()}
                        >
                          {seg().text}
                        </span>
                      )}
                    </Match>
                    <Match when={segment.kind === "suggested-insert" && segment}>
                      {(seg) => (
                        <span
                          class="doc-suggest"
                          data-doc-tip={strings.viewport.suggestedInsert}
                          style={attrStyle()}
                          aria-describedby={describedBy()}
                        >
                          <span class="sr-only">{strings.viewport.suggestedInsert}: </span>
                          {seg().text}
                        </span>
                      )}
                    </Match>
                    <Match when={segment.kind === "marked-for-deletion" && segment}>
                      {(seg) => (
                        <span
                          class="doc-strike"
                          data-doc-tip={strings.viewport.markedForDeletion}
                          style={attrStyle()}
                          aria-describedby={describedBy()}
                        >
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
                  {/* The writing caret (nib), painted after the run the current revision
                      wrote and tinted to that author's hue. Decorative — the dateline and
                      colophon carry the attribution semantics for assistive tech. */}
                  <Show when={caretIndex() === index()}>
                    <span
                      class="doc-caret"
                      aria-hidden="true"
                      style={{ "background-color": caretColor() }}
                    />
                  </Show>
                </>
              );
            }}
          </For>
        </article>
      </Show>
    </section>
  );
};

export default DocumentViewport;
