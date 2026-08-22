<script module lang="ts">
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
  // NON-VIRTUALIZED in Phase 5; the runs are POSITION-keyed with a KEYLESS `{#each}`,
  // NOT reference-keyed with a KEYED one. `segmentsAt` rebuilds a fresh array of fresh
  // `Segment` objects every playback tick, and the runs never reorder — they are a
  // linear left-to-right slice of the document. Under a keyed `{#each}` (reference or
  // id identity) that means zero overlap frame-to-frame, so EVERY span is torn down
  // and rebuilt each tick; the span under the cursor loses `:hover` (the browser
  // doesn't re-apply it to a freshly-inserted node beneath a stationary pointer) and
  // its `::after` affordance tooltip re-runs the fade from 0 — the reported flicker
  // during playback. A KEYLESS `{#each}` keys by position: the node at row i persists
  // across ticks and its content updates reactively in place, so the hovered tooltip
  // stays put (and the per-tick teardown cost disappears). Position-keying is the
  // natural fit here — "row i" is "the i-th run", stable across frames even as the
  // tail run grows.
  //
  // Authorship attribution (§9.7) rides on top WITHOUT a re-render of the tree:
  //  • A writing caret (nib) is painted after the run the CURRENT revision wrote,
  //    colour-coded to that revision's author — a real-time "who is typing" cue.
  //  • When a contributor is foregrounded in the colophon, every run attributed to
  //    that author gets a themed underline (+ a faint tint on accepted text) via a
  //    per-run style computed in the render snippet, so only the affected spans
  //    restyle.
  // Both derive their colour from the author's assigned hue, falling back to the
  // revision indigo when the source carried none. Attribution joins on the stable
  // opaque author key (never the raw Gaia token).

  import { cssText } from "@/components/common/css";
  import type { TextMarks } from "@/lib/core/docs/decoder/style-allowlist";
  import type { Block, BlockRun } from "@/lib/core/docs/reconstruction/blocks";
  import type { Segment } from "@/lib/core/docs/reconstruction/render";
  import { stripDisplayControlChars, textMarkStyle } from "@/lib/core/replay/style-css";

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
    readonly blocks: readonly Block[];
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

  // ── Pure per-run helpers ────────────────────────────────────────────────────
  // These were closures inside the old `renderRun` (which returned JSX). A Svelte
  // snippet takes explicit arguments instead of closing over an accessor, so each
  // one is hoisted to a module-level pure function taking what it needs.

  /** The author key(s) a segment is attributed to. A run coalesces contiguous
   *  same-kind chars regardless of which revision wrote each, so it can straddle
   *  revisions with different authors — not just at its endpoints but in the
   *  middle too (A opens it, B edits inside it, C appends to its tail). The
   *  segment's `revisions` lists every contributing revision, so we attribute to
   *  every author those revisions map to. Opaque placeholders / unattributed runs
   *  contribute no keys. A `Set` so a single-revision run yields one key. */
  function authorKeysOf(
    segment: Segment,
    authorKeyByRevision: ReadonlyMap<number, string> | undefined,
  ): ReadonlySet<string> {
    const keys = new Set<string>();
    if ("revisions" in segment) {
      for (const revision of segment.revisions) {
        const key = authorKeyByRevision?.get(Number(revision));
        if (key !== undefined) keys.add(key);
      }
    }
    return keys;
  }

  /** True when this run is attributed to the foregrounded contributor. */
  function isHighlighted(
    run: BlockRun,
    highlight: DocumentHighlight | null | undefined,
    authorKeyByRevision: ReadonlyMap<number, string> | undefined,
  ): boolean {
    return (
      highlight !== undefined &&
      highlight !== null &&
      authorKeysOf(run, authorKeyByRevision).has(highlight.key)
    );
  }

  /** The inline style that paints an author highlight onto one run. */
  function highlightStyle(color: string, kind: Segment["kind"]): Record<string, string> {
    // A themed underline drawn as an inset bottom border — it never clobbers the
    // suggestion's dotted underline or the deletion's strike (those are `text-decoration`,
    // this is `box-shadow`), so the non-color affordance always survives (§9.11).
    const style: Record<string, string> = {
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

  /** Merge a run's character marks (bold/italic/font/size) with any author-highlight
   *  style, serialized for Svelte's string-valued `style` attribute. `includeDecoration`
   *  is false for suggested/marked runs so an inline underline/strike never clobbers
   *  their kind-based affordance class. `cssText` returns undefined for an empty map,
   *  so a plain run emits no `style` attribute at all. */
  function runStyle(
    marks: TextMarks | undefined,
    includeDecoration: boolean,
    attr: Record<string, string> | undefined,
  ): string | undefined {
    return cssText({ ...textMarkStyle(marks, includeDecoration), ...attr });
  }

  /** Strip C0 control chars (table/structural delimiters that ride in the stream)
   *  for display, then drop the ONE trailing paragraph-mark '\n' on a block's last
   *  run — paragraph separation comes from the block box, not the mark. */
  function shownText(text: string, isLast: boolean): string {
    const clean = stripDisplayControlChars(text);
    return isLast ? clean.replace(/\n$/, "") : clean;
  }
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    IconChevronDown,
    IconComment,
    IconFile,
    IconImage,
    IconList,
    IconTable,
  } from "@/components/common/icons";
  import type { OpaqueStructure } from "@/lib/core/docs/decoder/types";
  import { contributedBy, strings } from "@/lib/core/i18n/strings";
  import { type CaretVisibility, caretVisibility, followScroll } from "@/lib/core/replay/follow";
  import { blockMarkStyle, listGlyphFor } from "@/lib/core/replay/style-css";

  const {
    blocks,
    caret,
    highlight,
    authorKeyByRevision,
    follow,
    scrollBehavior,
    onFollowOff,
    onFollowOn,
  }: DocumentViewportProps = $props();

  // `render.ts` breaks a run wherever an insertion threads into older (e.g.
  // Revision-0 base/template) content, so even a mid-document edit closes a run at
  // the insertion point whose `toRevision` names this frame's revision.
  // The global run `seq` the writing caret trails: the LAST run (in document
  // order) the current revision touched — one it OPENED (`fromRevision`) or
  // EXTENDED/CLOSED at the tail (`toRevision`). Last-match-in-order keeps the nib
  // on the freshest run when a revision contributed to several (mark-break or
  // threaded-insert). -1 when this frame's revision added no visible run.
  const caretSeq = $derived.by(() => {
    if (caret === undefined || caret === null) {
      return -1;
    }
    let found = -1;
    for (const block of blocks) {
      for (const run of block.runs) {
        if (
          "fromRevision" in run &&
          (Number(run.fromRevision) === caret.revision || Number(run.toRevision) === caret.revision)
        ) {
          found = run.seq;
        }
      }
    }
    return found;
  });

  const caretColor = $derived(caret?.color ?? ATTRIBUTION_FALLBACK);

  // True when any block carries a renderable run, so the empty-state fallback
  // shows only for a genuinely empty document (not a one-blank-paragraph doc).
  const hasContent = $derived(blocks.some((block) => block.runs.length > 0));

  // ── Follow-caret auto-scroll (legibility during NON-LINEAR playback) ─────────
  // When playback jumps between distant sections, keep the active edit in view. The
  // geometry decisions are pure (`lib/core/replay/follow`); here we only read the caret's
  // box and drive `window.scrollTo`. Every measure is deferred into ONE
  // requestAnimationFrame so we never read layout inside the reactive tick (which
  // would interleave with the per-frame segment rebuild and thrash) and never run
  // more than one scroll per frame — keeping the TICK_MS cadence clean.
  //
  // `$state` only because `bind:this` writes it; it is read from `measureCaret`, which
  // always runs off the reactive path (rAF / event handlers).
  let rootEl: HTMLElement | undefined = $state();
  let caretView = $state<CaretVisibility>("visible");

  const measureCaret = (): { readonly top: number; readonly bottom: number } | null => {
    const el = rootEl?.querySelector<HTMLElement>(".doc-caret");
    if (el === null || el === undefined) {
      return null;
    }
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  };

  // ── NON-REACTIVE scroll guards — plain `let`, deliberately ───────────────────
  // Everything from here to `recompute` is bookkeeping for one in-flight scroll
  // animation. It is read and written exclusively from `scroll` event handlers and
  // the rAF-deferred `recompute`, NEVER from the template. Promoting any of it to
  // `$state` would schedule a render (and re-run the scheduling `$effect`) on every
  // scroll frame, reordering the deferred measure that eight follow-caret tests
  // reproduce exact `scroll` orderings against. Leave them as plain `let`.
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
      caretView = "visible";
      return;
    }
    const vh = window.innerHeight;
    if (follow !== false) {
      const decision = followScroll(box.top, box.bottom, vh, window.scrollY);
      if (decision.scroll) {
        markProgrammatic(decision.top);
        window.scrollTo({ top: decision.top, behavior: scrollBehavior ?? "smooth" });
      }

      // Following keeps the caret in view, so the off-screen pill never shows.
      caretView = "visible";
      return;
    }
    caretView = caretVisibility(box.top, box.bottom, vh);
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
  $effect(() => {
    void caretSeq;
    void blocks.length;
    void follow;
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
  //
  // Capture whatever inline `overflow-anchor` the `<html>` element carried before we
  // first touched it, so unmount restores THAT value (not a hardcoded "") — leaving the
  // scroller exactly as we found it even if other code had set an inline value.
  const priorOverflowAnchor =
    typeof document !== "undefined" ? document.documentElement.style.overflowAnchor : "";
  $effect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.style.overflowAnchor = follow !== false ? "none" : "";
  });

  $effect(() => {
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
      if (follow !== false) {
        onFollowOff?.();
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
    return () => {
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.removeEventListener("keydown", onKeyNav);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onView);
    };
  });

  onDestroy(() => {
    if (rafId !== undefined && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
    }
    clearTimeout(progScrollTimer);
    // Leave the viewport scroller as we found it (drop our anchoring suppression):
    // restore the inline value captured before we first overrode it, not a blanket "".
    if (typeof document !== "undefined") {
      document.documentElement.style.overflowAnchor = priorOverflowAnchor;
    }
  });

  // The off-screen "Jump to edit" affordance: only while follow is OFF (when on we
  // scroll to the caret, so it is never lost) and the caret has actually left the
  // viewport. Clicking snaps to the caret and re-engages follow.
  const showPill = $derived(follow === false && caretView !== "visible");
  const onJump = (): void => {
    const box = measureCaret();
    if (box !== null && typeof window !== "undefined") {
      const decision = followScroll(box.top, box.bottom, window.innerHeight, window.scrollY);
      markProgrammatic(decision.top);
      window.scrollTo({ top: decision.top, behavior: scrollBehavior ?? "smooth" });
    }
    onFollowOn?.();
  };
</script>

<!-- A clear per-kind icon for an embedded non-text element (image, table, …) — far
     more legible than the old generic ▤ glyph. A snippet rather than a function
     because it renders markup; it re-evaluates if a position's structure kind ever
     changes. -->
{#snippet structureIcon(structure: OpaqueStructure)}
  {#if structure === "image" || structure === "drawing"}
    <IconImage size={14} />
  {:else if structure === "table"}
    <IconTable size={14} />
  {:else if structure === "list-format"}
    <IconList size={14} />
  {:else if structure === "comment-ref"}
    <IconComment size={14} />
  {:else}
    <IconFile size={14} />
  {/if}
{/snippet}

<!-- Render one run (a `Segment` + global `seq`) inside a block, plus the writing
     caret nib when this run is the one the current revision trails. A snippet takes
     `run` and `isLast` as plain VALUES; the enclosing keyless `{#each}` updates them
     in place across ticks, so the span nodes persist (the position-keying contract
     described at the top of this file).

     WHITESPACE IS SIGNIFICANT BELOW. Runs sit in inline flow inside a `<p>`, so any
     whitespace Svelte keeps between two of them renders as a real space and forges
     text the document does not contain. Svelte trims a fragment's leading/trailing
     whitespace but COLLAPSES interior whitespace to one space (JSX dropped it), so
     the kind branch and the caret `{#if}` are written adjacent — `{/if}{#if …}` — and
     the caret's own comment moved up here. Same reason the `sr-only` label's trailing
     space rides inside the expression rather than the markup.

     The trailing `{#if caretSeq === run.seq}` paints the writing caret (nib) after the
     run the current revision wrote, tinted to that author's hue. Decorative — the
     dateline and colophon carry the attribution semantics for assistive tech. -->
{#snippet renderRun(run: BlockRun, isLast: boolean)}
  {@const highlighted = isHighlighted(run, highlight, authorKeyByRevision)}
  {@const attr = highlighted
    ? highlightStyle(highlight?.color ?? ATTRIBUTION_FALLBACK, run.kind)
    : undefined}
  {@const describedBy = highlighted ? ATTR_DESC_ID : undefined}
  {#if run.kind === "accepted-text"}
    <span
      class="doc-accepted"
      style={runStyle(run.marks, true, attr)}
      aria-describedby={describedBy}>{shownText(run.text, isLast)}</span
    >
  {:else if run.kind === "suggested-insert"}
    <span
      class="doc-suggest"
      data-doc-tip={strings.viewport.suggestedInsert}
      style={runStyle(run.marks, false, attr)}
      aria-describedby={describedBy}
      ><span class="sr-only">{`${strings.viewport.suggestedInsert}: `}</span>{shownText(
        run.text,
        isLast,
      )}</span
    >
  {:else if run.kind === "marked-for-deletion"}
    <span
      class="doc-strike"
      data-doc-tip={strings.viewport.markedForDeletion}
      style={runStyle(run.marks, false, attr)}
      aria-describedby={describedBy}
      ><span class="sr-only">{`${strings.viewport.markedForDeletion}: `}</span>{shownText(
        run.text,
        isLast,
      )}</span
    >
  {:else if run.kind === "opaque-placeholder"}
    <span class="doc-opaque"
      ><span aria-hidden="true" class="inline-flex text-ink-muted"
        >{@render structureIcon(run.structure)}</span
      ><span>{run.label}</span></span
    >
  {/if}{#if caretSeq === run.seq}<span
      class="doc-caret"
      aria-hidden="true"
      style:background-color={caretColor}
    ></span>{/if}
{/snippet}

<!-- The manuscript leaf: an elevated sheet with a ruled binding margin. Both the
     written page and the blank-page note rest on the same paper so scrubbing back
     to the start never drops out of the manuscript frame. -->
<section class="dr-leaf" bind:this={rootEl}>
  {#if hasContent}
    <article class="doc-column" dir="auto">
      <!-- Two children, written ADJACENT (`{/if}{#each`) so Svelte keeps no whitespace
           text node between them — the JSX this replaced emitted none.

           1. The off-screen attribution description, present only while an author is
              foregrounded; highlighted runs reference it so screen readers announce
              who contributed the run. `aria-live` so toggling the focus is announced.
           2. Paragraph / embed blocks (plan Phase 1). BOTH loops are KEYLESS `{#each}`
              blocks — the exact equivalent of the `<Index>` they replaced — so the node
              at block i / run j persists across playback ticks: a hovered tooltip keeps
              its `:hover` and there is no per-tick teardown flicker. Authorship + caret
              ride on the global run `seq`, never on array position.
              `replay.components.test.ts`'s "reuses run DOM nodes across a segments
              update so hover tooltips don't flicker" asserts the surviving node
              identity and is the ONLY automated detector of a wrong choice here.
              DO NOT ADD A KEY HERE. -->
      {#if highlight}
        <span id={ATTR_DESC_ID} class="sr-only" aria-live="polite">
          {contributedBy(highlight.label)}
        </span>
      {/if}{#each blocks as block}
        {#if block.kind === "embed"}
          <div
            class="doc-block-embed"
          >{#each block.runs as run, index}{@render renderRun(
              run,
              index === block.runs.length - 1,
            )}{/each}</div>
        {:else if block.kind === "paragraph"}
          <p
            class="doc-block"
            style={cssText(blockMarkStyle(block.marks))}
          >{#if block.list}{@const list = block.list}<span
                class="doc-list-bullet"
                aria-hidden="true">{listGlyphFor(list)}&nbsp;</span
              >{/if}{#each block.runs as run, index}{@render renderRun(
              run,
              index === block.runs.length - 1,
            )}{/each}</p>
        {/if}
      {/each}
    </article>
  {:else}
    <p class="doc-column italic text-ink-muted">{strings.viewport.empty}</p>
  {/if}
  <!-- Off-screen edit indicator: a non-jarring alternative to forcing a scroll
       while the user is driving. Points toward the active edit and re-engages
       follow on tap. `position: fixed`, so it floats over the viewport edge. -->
  {#if showPill}
    <button type="button" class="dr-jump-pill" onclick={onJump}>
      <span class={["inline-flex", { "rotate-180": caretView === "above" }]} aria-hidden="true">
        <IconChevronDown size={16} />
      </span>
      <span>{strings.viewport.jumpToEdit}</span>
    </button>
  {/if}
</section>
