// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Timeline scrubber (plan Phase 5 Step 5c) — the surface's signature element: a
// writing-activity stratum with a vertical playhead caret. An ARIA slider with
// full keyboard scrub (Arrow ±1, Home/End to bounds).
//
// Positioning note (scale-safety): the slider domain is APPLIED-COUNT [0, max]
// — the same scale as `currentIndex` (which drives `modelAtRevisionIndex`). Event
// markers therefore carry a precomputed applied-count `index`, mapped UPSTREAM in
// the App from each event's wire `RevisionId` anchor (the App holds the revisions
// array). The leaf never sees a `RevisionId`, so it cannot mix the two scales.
//
// Density note (collision stacking): seals are ~16px and many bursts anchor a
// handful of events within a few revisions, so at the page's real width they
// would pile into an unreadable clump. Marks whose pixel positions would collide
// fuse into one STACKED SEAL bearing a count (see `clusterMarkers`); the burst
// becomes legible signal instead of a pile. Stacking is measurement-driven — with
// no measured width (jsdom / first paint) every mark renders on its own.

import type { Component, JSX } from "solid-js";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { IconClose, IconMinus, IconPauseBars, IconPencil, IconPlus } from "@/components/icons";
import { clusterCountLabel, revisionOf, revisionRangeOf, strings } from "@/lib/i18n/strings";

/** The four kinds of writing-activity mark drawn onto the timeline stratum. */
export type TimelineMarkerKind = "session" | "large-insertion" | "large-deletion" | "pause";

/** A timeline event projected onto the applied-count axis for rendering. */
export interface TimelineMarker {
  /** Stable key (kind + anchor) for `<For>`. */
  readonly id: string;
  readonly kind: TimelineMarkerKind;
  /** Applied-count position in [0, max]. */
  readonly index: number;
  /** Accessible description (i18n) for the marker. */
  readonly label: string;
  /** Content-free revision data shown on hover/focus (e.g. "+1,240 characters"). */
  readonly detail?: string;
}

export interface TimelineProps {
  readonly currentIndex: number;
  readonly max: number;
  readonly events: readonly TimelineMarker[];
  readonly onScrub: (index: number) => void;
}

// An intuitive icon per kind — a non-color affordance paired with the seal hue
// (§9.11): a pencil for a writing session, a plus for a surge of inserted text, a
// minus for a passage cut, and paused bars for a pause between sittings. (These
// replace the old scholarly glyphs § ⌃ ⌄ ‖, which read as cryptic to non-technical
// users.) Exported so the legend keys each mark to its meaning with the same icons.
// A plain function (not a component) so it re-evaluates inside reactive JSX.
export function markerIcon(kind: TimelineMarkerKind, size = 12): JSX.Element {
  switch (kind) {
    case "session":
      return <IconPencil size={size} />;
    case "large-insertion":
      return <IconPlus size={size} />;
    case "large-deletion":
      return <IconMinus size={size} />;
    case "pause":
      return <IconPauseBars size={size} />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// The per-kind seal ink (color + border). Split from the marker base so the
// legend can reuse the same tones on its static seals (`tl-seal`).
export function markerToneClass(kind: TimelineMarkerKind): string {
  switch (kind) {
    case "session":
      return "tl-marker-session";
    case "large-insertion":
    case "large-deletion":
      return "tl-marker-large";
    case "pause":
      return "tl-marker-pause";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// Stable display order for a cluster's kind breakdown (independent of the order
// the events arrive in). Mirrors the legend's ordering vocabulary.
const CLUSTER_KIND_ORDER: readonly TimelineMarkerKind[] = [
  "session",
  "large-insertion",
  "large-deletion",
  "pause",
];

const CLUSTER_KIND_LABEL: Record<TimelineMarkerKind, string> = {
  session: strings.timeline.markerSession,
  "large-insertion": strings.timeline.markerLargeInsertion,
  "large-deletion": strings.timeline.markerLargeDeletion,
  pause: strings.timeline.markerPause,
};

/**
 * A run of one-or-more marks rendered as a single entry. A single-member cluster
 * draws the familiar per-kind seal; a multi-member cluster draws a stacked count
 * seal. The `index` is the render anchor (the burst's mean position); `jumpIndex`
 * is the scrub target (the burst's first frame) so activating it lands the reader
 * at where the activity began.
 */
export interface MarkerCluster {
  /** Stable `<For>`/tooltip key derived from the member ids. */
  readonly id: string;
  readonly members: readonly TimelineMarker[];
  /** Mean applied-count position — where the seal is drawn. */
  readonly index: number;
  /** Earliest member index — where activation scrubs to. */
  readonly jumpIndex: number;
  /** Inclusive applied-count span of the members. */
  readonly span: { readonly start: number; readonly end: number };
}

// A seal is ~16px; require a touch of breathing room before two are treated as
// colliding so the stacked seals never visually kiss.
const DEFAULT_COLLISION_PX = 18;

/**
 * Group in-range marks that would visually collide into stacked clusters. Marks
 * are chained left→right: a mark joins the open cluster while its pixel gap to the
 * previous member is under the collision radius, so a continuous burst collapses
 * to ONE seal and well-separated marks each stay their own singleton.
 *
 * Pure and measurement-driven: with no measured width (`widthPx <= 0`, e.g. jsdom
 * or the first paint before layout) every mark is returned as its own singleton,
 * so rendering degrades to exactly the pre-stacking behavior.
 */
export function clusterMarkers(
  events: readonly TimelineMarker[],
  max: number,
  widthPx: number,
  radiusPx: number = DEFAULT_COLLISION_PX,
): MarkerCluster[] {
  // Mirror the per-marker bounds guard: out-of-range anchors never render.
  const inRange = events.filter((event) => event.index >= 0 && event.index <= max);
  const sorted = [...inRange].sort((a, b) => a.index - b.index);

  const groups: TimelineMarker[][] = [];
  const canMeasure = widthPx > 0 && max > 0;
  if (!canMeasure) {
    for (const marker of sorted) {
      groups.push([marker]);
    }
  } else {
    const pxOf = (index: number): number => (index / max) * widthPx;
    let current: TimelineMarker[] = [];
    let prevPx = Number.NEGATIVE_INFINITY;
    for (const marker of sorted) {
      const px = pxOf(marker.index);
      if (current.length > 0 && px - prevPx >= radiusPx) {
        groups.push(current);
        current = [];
      }
      current.push(marker);
      prevPx = px;
    }
    if (current.length > 0) {
      groups.push(current);
    }
  }

  return groups.map((members) => {
    const start = members[0]!.index; // sorted ascending
    const end = members[members.length - 1]!.index;
    const mean = members.reduce((sum, m) => sum + m.index, 0) / members.length;
    return {
      id: members.map((m) => m.id).join("|"),
      members,
      index: mean,
      jumpIndex: start,
      span: { start, end },
    };
  });
}

/** Graphite seal class for a mixed-kind cluster; the kind tone for a uniform one. */
function clusterToneClass(cluster: MarkerCluster): string {
  const kinds = new Set(cluster.members.map((m) => m.kind));
  return kinds.size === 1 ? markerToneClass(cluster.members[0]!.kind) : "tl-cluster-mixed";
}

/** One kind's tally within a cluster — the unit of both the peek ledger and aria. */
interface ClusterBreakdownRow {
  readonly kind: TimelineMarkerKind;
  readonly count: number;
  /** Count-aware kind name, e.g. "Editing session" / "Large insertions". */
  readonly label: string;
}

/**
 * Per-kind tallies in stable display order. Drives the structured hover-peek
 * ledger (one chip-row per kind) and, joined, the seal's accessible breakdown —
 * so the visible rows and the spoken summary can never drift apart.
 */
function clusterBreakdownRows(members: readonly TimelineMarker[]): ClusterBreakdownRow[] {
  const counts = new Map<TimelineMarkerKind, number>();
  for (const member of members) {
    counts.set(member.kind, (counts.get(member.kind) ?? 0) + 1);
  }
  return CLUSTER_KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => {
    const count = counts.get(kind)!;
    const base = CLUSTER_KIND_LABEL[kind];
    return { kind, count, label: count === 1 ? base : `${base}s` };
  });
}

/** Kind breakdown for a cluster, e.g. "1 Editing session · 3 Large insertions". */
function clusterBreakdown(members: readonly TimelineMarker[]): string {
  return clusterBreakdownRows(members)
    .map((row) => `${row.count} ${row.label}`)
    .join(" · ");
}

// One source of truth for what a seal SAYS — reused by its aria-label and the
// shared popover, so the two never drift. A singleton speaks for its one mark; a
// stack speaks the count, the kind breakdown, and the span it covers.
interface ClusterSummary {
  readonly title: string;
  readonly detail: string | undefined;
  readonly rev: string;
}

function summarizeCluster(cluster: MarkerCluster, max: number): ClusterSummary {
  if (cluster.members.length === 1) {
    const marker = cluster.members[0]!;
    return { title: marker.label, detail: marker.detail, rev: revisionOf(marker.index, max) };
  }
  return {
    title: clusterCountLabel(cluster.members.length),
    detail: clusterBreakdown(cluster.members),
    rev: revisionRangeOf(cluster.span.start, cluster.span.end, max),
  };
}

// The track reserves a horizontal SAFE AREA at each end, put to two distinct uses.
//
//  • EDGE_INSET_PX — the inset of the applied-count AXIS. Markers, the fill ramp,
//    the popovers, and `scrubFromClientX` all map through `posPct`/`fillWidth`
//    into the band [EDGE_INSET_PX, 100% − EDGE_INSET_PX], so a boundary seal
//    stands clear of (and is never half-clipped by) the rounded track ends. Sized
//    to clear a whole seal: half a marker (~9px) + the ~5px rounded-cap radius +
//    breathing room.
//
//  • PLAYHEAD_REST_PX — where the playhead nib RESTS at the two endpoints. The
//    first real marker anchors at applied-count ~1 of hundreds — i.e. essentially
//    index 0 — so on the shared linear axis the index-0 nib and that first marker
//    would coincide; the axis inset alone shifts both inward together and never
//    separates them. So at revision 0 (and at max) the nib parks in the end margin
//    instead: BEFORE the first marker, AFTER the last. For every interior index it
//    still follows the SAME `posPct` as the markers (see `thumbLeft`), so a scrub
//    lands the nib exactly on the marker it points at; only the resting endpoints
//    park, and the nib's `left` transition glides that small step.
const EDGE_INSET_PX = 28;
const PLAYHEAD_REST_PX = 9;

const Timeline: Component<TimelineProps> = (props) => {
  let track: HTMLDivElement | undefined;
  let activePointerId: number | null = null;
  const fraction = createMemo(() => (props.max > 0 ? props.currentIndex / props.max : 0));

  // Map an applied-count `index` to its physical left offset on the markers axis,
  // interpolating across the inset interior: index 0 lands at `EDGE_INSET_PX`,
  // index `max` at `100% − EDGE_INSET_PX`. Expressed as a `calc` so the safe area
  // is a fixed pixel width at any track size (rather than a width-relative %).
  const posPct = (index: number): string => {
    const frac = props.max > 0 ? Math.max(0, Math.min(1, index / props.max)) : 0;
    return `calc(${EDGE_INSET_PX}px + (100% - ${EDGE_INSET_PX * 2}px) * ${frac.toFixed(4)})`;
  };

  // The playhead nib's left offset. It rides the markers axis (`posPct`) for every
  // interior revision so a scrub lands it exactly on its marker, but RESTS in the
  // end margin at the two endpoints — parked before the first marker at revision 0,
  // after the last marker at `max` — so the nib never sits on top of a boundary seal.
  const thumbLeft = (index: number): string => {
    if (props.max <= 0 || index <= 0) {
      return `${PLAYHEAD_REST_PX}px`;
    }
    if (index >= props.max) {
      return `calc(100% - ${PLAYHEAD_REST_PX}px)`;
    }
    return posPct(index);
  };

  // The progress ramp begins at the index-0 axis anchor (left = EDGE_INSET_PX) and
  // its leading edge stays glued to the nib: across the interior it spans the usable
  // band; at `max` it extends the extra end margin out to the parked nib so the
  // filled ramp still meets it; at revision 0 it is empty.
  const fillWidth = createMemo(() => {
    if (props.max <= 0 || props.currentIndex <= 0) {
      return "0px";
    }
    if (props.currentIndex >= props.max) {
      return `calc(100% - ${EDGE_INSET_PX + PLAYHEAD_REST_PX}px)`;
    }
    return `calc((100% - ${EDGE_INSET_PX * 2}px) * ${fraction().toFixed(4)})`;
  });

  // Measured track width feeds collision stacking. It stays 0 until layout is
  // observed (jsdom keeps it 0), so stacking is inert until there is a real width
  // to collide against — clustering never fires on a guessed geometry.
  const [trackWidth, setTrackWidth] = createSignal(0);
  onMount(() => {
    const el = track;
    if (el === undefined) {
      return;
    }
    setTrackWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const measured = entries[0]?.contentRect.width;
        setTrackWidth(
          measured !== undefined && measured > 0 ? measured : el.getBoundingClientRect().width,
        );
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    }
  });

  // Collision stacking runs in the SAME inset band the seals render into, so it
  // measures against the usable interior width, not the raw track width.
  const clusters = createMemo(() =>
    clusterMarkers(props.events, props.max, Math.max(0, trackWidth() - EDGE_INSET_PX * 2)),
  );

  // Hover/focus tooltip: a single popover, driven by the active cluster id, so the
  // seal itself stays a thin jump-to button. Set on enter/focus, cleared on
  // leave/blur — making the revision data reachable by pointer AND keyboard.
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const activeCluster = createMemo(() => {
    const id = activeId();
    return id === null ? undefined : clusters().find((cluster) => cluster.id === id);
  });

  // Pinned expansion: clicking a stacked seal opens an interactive panel listing
  // every mark in the burst as a jump-row. The hover peek is a glance; this is the
  // reading. Only one panel is open at a time (the active stack's id), and the seal
  // is remembered so Escape can return focus to it after dismissal.
  const [pinnedId, setPinnedId] = createSignal<string | null>(null);
  const pinnedCluster = createMemo(() => {
    const id = pinnedId();
    return id === null ? undefined : clusters().find((cluster) => cluster.id === id);
  });
  let panelEl: HTMLDivElement | undefined;
  let pinnedSealEl: HTMLButtonElement | undefined;
  function closePanel(refocus = false): void {
    setPinnedId(null);
    if (refocus) {
      pinnedSealEl?.focus();
    }
  }
  // While a panel is pinned, a click anywhere outside it (and outside any seal) or
  // an Escape press dismisses it — the manuscript-margin equivalent of closing a
  // pulled card. Seal targets are spared so the seal's own click can toggle/switch.
  createEffect(() => {
    if (pinnedId() === null || typeof document === "undefined") {
      return;
    }
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (target && (target.closest("[data-tl-seal]") || panelEl?.contains(target))) {
        return;
      }
      closePanel();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closePanel(true);
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    });
  });

  // Edge-aware horizontal anchoring: a centered popover near a track end would
  // spill off the page, so clamp to the seal's left/right edge in the margins.
  function tipTransform(index: number): string {
    const frac = props.max > 0 ? index / props.max : 0;
    if (frac <= 0.12) {
      return "translateX(0)";
    }
    if (frac >= 0.88) {
      return "translateX(-100%)";
    }
    return "translateX(-50%)";
  }

  function scrubFromClientX(clientX: number): void {
    if (track === undefined || props.max <= 0) {
      props.onScrub(0);
      return;
    }
    const rect = track.getBoundingClientRect();
    // Invert `posPct`: the usable band runs from EDGE_INSET_PX to width −
    // EDGE_INSET_PX, so a click anywhere in either safe-area margin clamps to the
    // nearest bound (index 0 / max) rather than reading as a fractional position.
    const usable = rect.width - EDGE_INSET_PX * 2;
    const ratio = usable > 0 ? (clientX - rect.left - EDGE_INSET_PX) / usable : 0;
    const next = Math.round(Math.max(0, Math.min(1, ratio)) * props.max);
    props.onScrub(next);
  }

  function onPointerDown(event: PointerEvent): void {
    closePanel(); // a scrub on the bare track dismisses any open detail panel
    activePointerId = event.pointerId;
    const target = event.currentTarget as HTMLDivElement;
    target.setPointerCapture(event.pointerId);
    scrubFromClientX(event.clientX);
  }

  function onPointerMove(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) {
      return;
    }
    scrubFromClientX(event.clientX);
  }

  function endPointer(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) {
      return;
    }
    activePointerId = null;
    const target = event.currentTarget as HTMLDivElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    let next: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = props.currentIndex - 1;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = props.currentIndex + 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = props.max;
        break;
      default:
        return;
    }
    event.preventDefault();
    props.onScrub(Math.max(0, Math.min(next, props.max)));
  }

  return (
    <div
      ref={track}
      class="tl-track"
      role="slider"
      tabIndex={0}
      aria-label={strings.timeline.label}
      aria-valuemin={0}
      aria-valuemax={props.max}
      aria-valuenow={props.currentIndex}
      aria-valuetext={revisionOf(props.currentIndex, props.max)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div class="tl-fill" style={{ left: `${EDGE_INSET_PX}px`, width: fillWidth() }} />
      <For each={clusters()}>
        {(cluster) => {
          const single = cluster.members.length === 1 ? cluster.members[0]! : undefined;
          const summary = summarizeCluster(cluster, props.max);
          const ariaLabel = [summary.title, summary.detail, summary.rev]
            .filter((part): part is string => part !== undefined)
            .join(" — ");
          const count = cluster.members.length;
          return (
            <button
              type="button"
              class={
                single === undefined
                  ? `tl-cluster ${clusterToneClass(cluster)}`
                  : `tl-marker ${markerToneClass(single.kind)} p-0`
              }
              style={{ left: posPct(cluster.index) }}
              aria-label={ariaLabel}
              aria-describedby={activeId() === cluster.id ? "tl-tip" : undefined}
              aria-haspopup={single === undefined ? "dialog" : undefined}
              aria-expanded={single === undefined ? pinnedId() === cluster.id : undefined}
              data-tl-seal
              onPointerDown={(event) => event.stopPropagation()}
              onPointerEnter={() => setActiveId(cluster.id)}
              onPointerLeave={() => setActiveId((id) => (id === cluster.id ? null : id))}
              onFocus={() => setActiveId(cluster.id)}
              onBlur={() => setActiveId((id) => (id === cluster.id ? null : id))}
              onClick={(event) => {
                event.stopPropagation();
                // A singleton is its own detail — a click is a quick jump to it.
                if (single !== undefined) {
                  closePanel();
                  props.onScrub(cluster.jumpIndex);
                  return;
                }
                // A stacked seal opens (or toggles) its expanded jump-list instead
                // of guessing one target; the rows inside scrub to a chosen frame.
                pinnedSealEl = event.currentTarget;
                setPinnedId((id) => (id === cluster.id ? null : cluster.id));
              }}
            >
              {single === undefined
                ? count > 99
                  ? "99+"
                  : String(count)
                : markerIcon(single.kind)}
            </button>
          );
        }}
      </For>
      {/* Hover/focus peek — a glance. Suppressed while a panel is pinned so the
          two surfaces never overlap. A stack shows a per-kind ledger (no more
          cramped wrapping `·`-run) and hints that a click opens the full list. */}
      <Show when={pinnedId() === null && activeCluster()}>
        {(cluster) => {
          const summary = createMemo(() => summarizeCluster(cluster(), props.max));
          const isStack = createMemo(() => cluster().members.length > 1);
          return (
            <div
              id="tl-tip"
              class="tl-tip"
              role="tooltip"
              style={{ left: posPct(cluster().index), transform: tipTransform(cluster().index) }}
            >
              <span class="tl-tip-title">{summary().title}</span>
              <Show
                when={isStack()}
                fallback={
                  <Show when={summary().detail}>
                    {(detail) => <span class="tl-tip-detail">{detail()}</span>}
                  </Show>
                }
              >
                <ul class="tl-tip-breakdown">
                  <For each={clusterBreakdownRows(cluster().members)}>
                    {(row) => (
                      <li class="tl-tip-row">
                        <span class={`tl-chip ${markerToneClass(row.kind)}`} aria-hidden="true">
                          {markerIcon(row.kind)}
                        </span>
                        <span class="tl-tip-count">{row.count}</span>
                        <span>{row.label}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <span class="tl-tip-rev">{summary().rev}</span>
              <Show when={isStack()}>
                <span class="tl-tip-hint">{strings.timeline.inspectHint}</span>
              </Show>
            </div>
          );
        }}
      </Show>
      {/* Pinned panel — the reading. Each member is its own jump-row, so a dense
          burst becomes a navigable index instead of one guessed scrub target. */}
      <Show when={pinnedCluster()}>
        {(cluster) => {
          const summary = createMemo(() => summarizeCluster(cluster(), props.max));
          return (
            <div
              ref={panelEl}
              class="tl-panel"
              role="dialog"
              aria-label={summary().title}
              style={{ left: posPct(cluster().index), transform: tipTransform(cluster().index) }}
            >
              <div class="tl-panel-head">
                <div class="tl-panel-heading">
                  <span class="tl-panel-title">{summary().title}</span>
                  <span class="tl-panel-rev">{summary().rev}</span>
                </div>
                <button
                  type="button"
                  class="tl-panel-close"
                  aria-label={strings.timeline.closeDetails}
                  onClick={() => closePanel(true)}
                >
                  <IconClose size={16} />
                </button>
              </div>
              <ul class="tl-panel-list">
                <For each={cluster().members}>
                  {(member) => {
                    const rev = revisionOf(member.index, props.max);
                    const jumpLabel = `${strings.timeline.jumpTo} ${member.label}${
                      member.detail ? ` — ${member.detail}` : ""
                    } — ${rev}`;
                    return (
                      <li>
                        <button
                          type="button"
                          class="tl-panel-row"
                          aria-label={jumpLabel}
                          onClick={() => {
                            props.onScrub(member.index);
                            closePanel(true);
                          }}
                        >
                          <span
                            class={`tl-chip ${markerToneClass(member.kind)}`}
                            aria-hidden="true"
                          >
                            {markerIcon(member.kind)}
                          </span>
                          <span class="tl-panel-row-main">
                            <span class="tl-panel-row-kind">{CLUSTER_KIND_LABEL[member.kind]}</span>
                            <Show when={member.detail}>
                              {(detail) => <span class="tl-panel-row-detail">{detail()}</span>}
                            </Show>
                          </span>
                          <span class="tl-panel-row-rev" aria-hidden="true">
                            → {member.index}
                          </span>
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </div>
          );
        }}
      </Show>
      <div class="tl-thumb" style={{ left: thumbLeft(props.currentIndex) }} />
    </div>
  );
};

export default Timeline;
