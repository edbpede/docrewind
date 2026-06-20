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
// NON-VIRTUALIZED in Phase 5; the runs are POSITION-keyed with `<Index>`, NOT
// reference-keyed with `<For>`. `segmentsAt` rebuilds a fresh array of fresh
// `Segment` objects every playback tick, and the runs never reorder — they are a
// linear left-to-right slice of the document. Under `<For>` (reference identity)
// that means zero overlap frame-to-frame, so EVERY span is torn down and rebuilt
// each tick; the span under the cursor loses `:hover` (the browser doesn't re-apply
// it to a freshly-inserted node beneath a stationary pointer) and its `::after`
// affordance tooltip re-runs the fade from 0 — the reported flicker during playback.
// `<Index>` keys by position: the node at row i persists across ticks and its
// content updates reactively in place, so the hovered tooltip stays put (and the
// per-tick teardown cost disappears). Position-keying is the natural fit here —
// "row i" is "the i-th run", stable across frames even as the tail run grows.
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
import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import {
  IconChevronDown,
  IconComment,
  IconFile,
  IconImage,
  IconList,
  IconTable,
} from "@/components/icons";
import type { OpaqueStructure } from "@/lib/decoder/types";
import { contributedBy, strings } from "@/lib/i18n/strings";
import type { Segment } from "@/lib/reconstruction/render";
import { type CaretVisibility, caretVisibility, followScroll } from "@/lib/replay/follow";

/** A clear per-kind icon for an embedded non-text element (image, table, …) — far
 *  more legible than the old generic ▤ glyph. Called inside reactive JSX so it
 *  re-evaluates if a position's structure kind ever changes. */
function structureIcon(structure: OpaqueStructure): JSX.Element {
  switch (structure) {
    case "image":
    case "drawing":
      return <IconImage size={14} />;
    case "table":
      return <IconTable size={14} />;
    case "list-format":
      return <IconList size={14} />;
    case "comment-ref":
      return <IconComment size={14} />;
    default:
      return <IconFile size={14} />;
  }
}

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
  /** When false, the viewport does not auto-scroll to keep the caret in view.
   *  Absent/true → follow enabled (the host owns the toggle state). */
  readonly follow?: boolean;
  /** Scroll behaviour for follow + jump: "smooth" at ≤1×, "auto" when stepping faster. */
  readonly scrollBehavior?: ScrollBehavior;
  /** Fired on a genuine user scroll gesture (wheel/touch) so the host disengages follow. */
  readonly onFollowOff?: () => void;
  /** Fired when the user taps "Jump to edit" so the host re-engages follow. */
  readonly onFollowOn?: () => void;
}

// The author hue when a contributor carried no assigned colour (the self-resolution
// path exposes none): the brand indigo, matching the playhead/caret accent. Uses the
// theme variable so the fallback follows light/dark like every other brand surface.
const ATTRIBUTION_FALLBACK = "var(--dr-brand)";

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

// Reactive-safe discriminant narrowing for the segment union. `<Index>` hands each
// row a `() => Segment` accessor rather than a value, so the old
// `segment.kind === K && segment` const-narrowing no longer holds (TS can't narrow
// a function call). This maps a value to its variant when the kind matches, else
// `undefined`, so every `<Match>` still receives a correctly-typed narrowed accessor.
function asKind<K extends Segment["kind"]>(
  segment: Segment,
  kind: K,
): Extract<Segment, { readonly kind: K }> | undefined {
  return segment.kind === kind ? (segment as Extract<Segment, { readonly kind: K }>) : undefined;
}

const DocumentViewport: Component<DocumentViewportProps> = (props) => {
  // The author key(s) a segment is attributed to. A run coalesces contiguous
  // same-kind chars regardless of which revision wrote each, so it can straddle
  // revisions with different authors — not just at its endpoints but in the
  // middle too (A opens it, B edits inside it, C appends to its tail). The
  // segment's `revisions` lists every contributing revision, so we attribute to
  // every author those revisions map to. Opaque placeholders / unattributed runs
  // contribute no keys. A `Set` so a single-revision run yields one key.
  const authorKeysOf = (segment: Segment): ReadonlySet<string> => {
    const keys = new Set<string>();
    if ("revisions" in segment) {
      for (const revision of segment.revisions) {
        const key = props.authorKeyByRevision?.get(Number(revision));
        if (key !== undefined) keys.add(key);
      }
    }
    return keys;
  };

  // The index of the run the caret trails: the LAST run the current revision touched —
  // either one it OPENED (`fromRevision`) or one it EXTENDED/CLOSED at the tail
  // (`toRevision`). `render.ts` breaks a run wherever an insertion threads into older
  // (e.g. Revision 0 base/template) content, so even a mid-document edit closes a run
  // at the insertion point whose `toRevision` names this frame's revision — the caret
  // latches there instead of being swept to the tail of the surrounding base content.
  // Recomputed per frame (segments + caret both change on a tick); O(segments), trivial
  // beside the segment rebuild itself. -1 only when the current revision added no visible
  // char this frame (a pure or suggested deletion), so no caret is painted that frame.
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

  // ── Follow-caret auto-scroll (legibility during NON-LINEAR playback) ─────────
  // When playback jumps between distant sections, keep the active edit in view. The
  // geometry decisions are pure (`lib/replay/follow`); here we only read the caret's
  // box and drive `window.scrollTo`. Every measure is deferred into ONE
  // requestAnimationFrame so we never read layout inside the reactive tick (which
  // would interleave with the per-frame segment rebuild and thrash) and never run
  // more than one scroll per frame — keeping the TICK_MS cadence clean.
  let rootEl: HTMLElement | undefined;
  const [caretView, setCaretView] = createSignal<CaretVisibility>("visible");

  const measureCaret = (): { readonly top: number; readonly bottom: number } | null => {
    const el = rootEl?.querySelector<HTMLElement>(".doc-caret");
    if (el === null || el === undefined) {
      return null;
    }
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  };

  let rafId: number | undefined;
  // Programmatic-scroll guard: set before every window.scrollTo call we issue so
  // the `scroll` event listener can distinguish our own position adjustments from
  // genuine user-initiated scrolls (keyboard nav, scrollbar drag). Smooth-scroll
  // animations emit multiple `scroll` events: intermediate frames are far from the
  // target, then a cluster of easing-tail frames land within PROG_SCROLL_TOLERANCE_PX.
  // The guard stays active (progScroll=true) until AFTER the target is reached, so
  // the easing tail is suppressed too. Once the tail is seen (progScrollReached=true),
  // any scroll event that moves clearly away from the target is genuine user intent
  // and disengages follow.
  //
  // The guard self-clears after PROG_SCROLL_IDLE_MS of NO programmatic scroll activity.
  // This is an INACTIVITY window — re-armed by markProgrammatic AND by every scroll
  // event we classify as our own (mid-animation or easing tail) — not a wall-clock cap.
  // A single smooth `scrollTo` over a large distance animates well past a second
  // (Chromium scales the duration with distance, measured up to a ~1.5s cap), so a
  // fixed cap expires mid-flight: the animation's own remaining frames then fall through
  // to the user-scroll branch and wrongly disengage follow — the large-jump / "around
  // revision 50" regression, made worse when a pure-deletion revision yields no caret so
  // recompute stops re-issuing markProgrammatic. An inactivity window only fires once the
  // animation has truly gone quiet — target reached, or stalled (e.g. clamped short at
  // the page bottom) — so the guard stays correct for an animation of any duration.
  const PROG_SCROLL_TOLERANCE_PX = 2;
  const PROG_SCROLL_IDLE_MS = 1200;
  let progScroll = false;
  let progScrollTarget: number | undefined;
  let progScrollReached = false;
  // The distance to target at the previous scroll event we classified as our own.
  // A smooth `scrollTo` animation is MONOTONIC — every frame closes the gap to the
  // target, never widens it — so a mid-animation event whose distance to target GREW
  // beyond tolerance is motion the animation could not have produced (a scrollbar drag
  // pulling away), the one cue that separates a genuine drag from the normal approach.
  let progScrollDist = Number.POSITIVE_INFINITY;
  let progScrollTimer: ReturnType<typeof setTimeout> | undefined;
  // (Re)start the inactivity timer that releases the guard once our scroll goes quiet.
  const armProgScrollIdleTimeout = (): void => {
    clearTimeout(progScrollTimer);
    progScrollTimer = setTimeout(() => {
      progScroll = false;
      progScrollTarget = undefined;
      progScrollReached = false;
    }, PROG_SCROLL_IDLE_MS);
  };
  const markProgrammatic = (target: number): void => {
    progScroll = true;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    progScrollTarget = Math.min(target, maxScroll);
    progScrollReached = false;
    // Seed with the real starting gap (target assigned on the line above, so never
    // undefined here) — not Infinity, or the reversal check below could never trip on
    // the very first scroll event, misclassifying an immediate drag-away as programmatic.
    progScrollDist = Math.abs(window.scrollY - progScrollTarget);
    armProgScrollIdleTimeout();
  };

  const recompute = (): void => {
    rafId = undefined;
    if (typeof window === "undefined") {
      return;
    }
    const box = measureCaret();
    if (box === null) {
      // No caret this frame (pure deletion / strict mid-run insert) — hold position.
      setCaretView("visible");
      return;
    }
    const vh = window.innerHeight;
    if (props.follow !== false) {
      const decision = followScroll(box.top, box.bottom, vh, window.scrollY);
      if (decision.scroll) {
        markProgrammatic(decision.top);
        window.scrollTo({ top: decision.top, behavior: props.scrollBehavior ?? "smooth" });
      }

      // Following keeps the caret in view, so the off-screen pill never shows.
      setCaretView("visible");
      return;
    }
    setCaretView(caretVisibility(box.top, box.bottom, vh));
  };
  const schedule = (): void => {
    if (typeof requestAnimationFrame === "undefined") {
      recompute();
      return;
    }
    if (rafId !== undefined) {
      return; // a measure is already queued for this frame
    }
    rafId = requestAnimationFrame(recompute);
  };

  // React to the caret moving (a tick or a scrub), its run growing, and the follow
  // toggle flipping. These are the tracked reads; the DOM measure runs off the
  // reactive path in `recompute`.
  createEffect(() => {
    void caretIndex();
    void props.segments.length;
    void props.follow;
    schedule();
  });

  // Scroll anchoring vs. follow: the reconstructed document re-renders on EVERY
  // playback tick, so runs above the caret change height and Chromium's scroll
  // anchoring shifts `window.scrollY` to keep the prior content visually stable — a
  // scroll the component never issued via `scrollTo`, and one that leaves total
  // `scrollHeight` unchanged (so it is indistinguishable from a user scrollbar drag by
  // position alone). After a follow scroll has settled (`progScrollReached`), `onScroll`
  // reads that browser re-anchoring as "the user moved away" and disengages follow mid-
  // playback — the large up/down-jump regression. While follow is engaged we are the
  // sole intended scroll driver, so suppress anchoring on the viewport scroller; when
  // the user takes over (follow off) restore the default so their reading position holds.
  createEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.style.overflowAnchor = props.follow !== false ? "none" : "";
  });

  onMount(() => {
    if (typeof window === "undefined") {
      return;
    }
    // A real user gesture means "I'm driving now" — disengage follow so playback
    // stops yanking the page. We cover three gesture surfaces:
    //   • wheel / touchmove — input events that never fire for programmatic scrollTo.
    //   • keydown on navigation keys — fires before the resulting scroll event, giving
    //     immediate disengage without waiting on the smooth-scroll settle timer.
    //   • scroll (with progScroll guard) — catches scrollbar dragging and any other
    //     scroll source not covered above; skipped while our own scrollTo is in flight.
    const onUserScroll = (): void => {
      if (props.follow !== false) {
        props.onFollowOff?.();
      }
    };
    // Nav keys that trigger page scrolling. We act on keydown (before the scroll
    // fires) so keyboard users get immediate disengage.
    const NAV_KEYS = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "PageUp",
      "PageDown",
      "Home",
      "End",
    ]);
    const onKeyNav = (e: KeyboardEvent): void => {
      if (!e.defaultPrevented && NAV_KEYS.has(e.key)) onUserScroll();
    };
    // Pill visibility + scrollbar-drag disengage: runs on every scroll event.
    // Four-way guard while progScroll is active:
    //   1. Within tolerance of target → mark as reached, suppress (easing tail).
    //   2. Beyond tolerance AND already reached → user moved away; clear guard + disengage.
    //   3. Beyond tolerance, not yet reached, but distance to target GREW → a drag
    //      pulling away mid-animation (the animation only ever closes the gap); disengage.
    //   4. Beyond tolerance, not yet reached, distance shrank → mid-animation; suppress.
    // After the guard clears (reached+moved, drag-away, or safety timeout), events
    // disengage normally.
    const clearProgScrollGuard = (): void => {
      progScroll = false;
      progScrollTarget = undefined;
      progScrollReached = false;
      clearTimeout(progScrollTimer);
    };
    const onScroll = (): void => {
      schedule();
      if (!progScroll) {
        onUserScroll();
        return;
      }
      const dist =
        progScrollTarget === undefined
          ? Number.POSITIVE_INFINITY
          : Math.abs(window.scrollY - progScrollTarget);
      if (dist <= PROG_SCROLL_TOLERANCE_PX) {
        // Landing frame or easing tail — suppress, note we've reached the target, and
        // keep the guard alive: the easing tail keeps emitting events for a while.
        progScrollReached = true;
        progScrollDist = dist;
        armProgScrollIdleTimeout();
        return;
      }
      if (progScrollReached) {
        // Moved clearly away after settling: genuine user intent. Clear guard and disengage.
        clearProgScrollGuard();
        onUserScroll();
        return;
      }
      if (dist > progScrollDist + PROG_SCROLL_TOLERANCE_PX) {
        // Moving AWAY from the target mid-animation — our own smooth scroll never widens
        // the gap, so this is a scrollbar drag (the one gesture with no wheel/touch/key
        // fast-path). Clear the guard and disengage before the idle timer would snap back.
        clearProgScrollGuard();
        onUserScroll();
        return;
      }
      // Still mid-animation (before reaching target, gap shrinking) — suppress, and keep
      // the guard alive so a long smooth scroll never outlives the inactivity window
      // mid-flight. Track this frame's distance so the next event can spot a reversal.
      progScrollDist = dist;
      armProgScrollIdleTimeout();
    };
    // Pill visibility for window resize (no disengage needed).
    const onView = (): void => schedule();
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    window.addEventListener("keydown", onKeyNav);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onView, { passive: true });
    onCleanup(() => {
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.removeEventListener("keydown", onKeyNav);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onView);
    });
  });
  onCleanup(() => {
    if (rafId !== undefined && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
    }
    clearTimeout(progScrollTimer);
    // Leave the viewport scroller as we found it (drop our anchoring suppression).
    if (typeof document !== "undefined") {
      document.documentElement.style.overflowAnchor = "";
    }
  });

  // The off-screen "Jump to edit" affordance: only while follow is OFF (when on we
  // scroll to the caret, so it is never lost) and the caret has actually left the
  // viewport. Clicking snaps to the caret and re-engages follow.
  const showPill = (): boolean => props.follow === false && caretView() !== "visible";
  const onJump = (): void => {
    const box = measureCaret();
    if (box !== null && typeof window !== "undefined") {
      const decision = followScroll(box.top, box.bottom, window.innerHeight, window.scrollY);
      markProgrammatic(decision.top);
      window.scrollTo({ top: decision.top, behavior: props.scrollBehavior ?? "smooth" });
    }
    props.onFollowOn?.();
  };

  // The manuscript leaf: an elevated sheet with a ruled binding margin. Both the
  // written page and the blank-page note rest on the same paper so scrubbing back
  // to the start never drops out of the manuscript frame.
  return (
    <section
      class="dr-leaf"
      ref={(el) => {
        rootEl = el;
      }}
    >
      <Show
        when={props.segments.length > 0}
        fallback={<p class="doc-column italic text-ink-muted">{strings.viewport.empty}</p>}
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
          <Index each={props.segments}>
            {(segment, index) => {
              // Highlighted iff this run's author is the foregrounded one. The DOM stays
              // put — `<Index>` is position-keyed, so the row's spans are reused across
              // ticks (never torn down, so a hovered tooltip keeps its `:hover`); only
              // these reactive style/aria accessors re-evaluate on a focus change, and
              // only the matching spans actually write to the DOM. `segment` is a `()
              // => Segment` accessor here, so each read inside these closures tracks the
              // per-row signal and the body restyles in place when the run updates.
              const highlighted = (): boolean => {
                const highlight = props.highlight;
                return (
                  highlight !== undefined &&
                  highlight !== null &&
                  authorKeysOf(segment()).has(highlight.key)
                );
              };
              const attrStyle = (): JSX.CSSProperties | undefined =>
                highlighted()
                  ? highlightStyle(props.highlight?.color ?? ATTRIBUTION_FALLBACK, segment().kind)
                  : undefined;
              const describedBy = (): string | undefined =>
                highlighted() ? ATTR_DESC_ID : undefined;
              return (
                <>
                  <Switch>
                    <Match when={asKind(segment(), "accepted-text")}>
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
                    <Match when={asKind(segment(), "suggested-insert")}>
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
                    <Match when={asKind(segment(), "marked-for-deletion")}>
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
                    <Match when={asKind(segment(), "opaque-placeholder")}>
                      {(seg) => (
                        <span class="doc-opaque">
                          <span aria-hidden="true" class="inline-flex text-ink-muted">
                            {structureIcon(seg().structure)}
                          </span>
                          <span>{seg().label}</span>
                        </span>
                      )}
                    </Match>
                  </Switch>
                  {/* The writing caret (nib), painted after the run the current revision
                      wrote and tinted to that author's hue. Decorative — the dateline and
                      colophon carry the attribution semantics for assistive tech. */}
                  <Show when={caretIndex() === index}>
                    <span
                      class="doc-caret"
                      aria-hidden="true"
                      style={{ "background-color": caretColor() }}
                    />
                  </Show>
                </>
              );
            }}
          </Index>
        </article>
      </Show>
      {/* Off-screen edit indicator: a non-jarring alternative to forcing a scroll
          while the user is driving. Points toward the active edit and re-engages
          follow on tap. `position: fixed`, so it floats over the viewport edge. */}
      <Show when={showPill()}>
        <button type="button" class="dr-jump-pill" onClick={onJump}>
          <span
            class="inline-flex"
            classList={{ "rotate-180": caretView() === "above" }}
            aria-hidden="true"
          >
            <IconChevronDown size={16} />
          </span>
          <span>{strings.viewport.jumpToEdit}</span>
        </button>
      </Show>
    </section>
  );
};

export default DocumentViewport;
