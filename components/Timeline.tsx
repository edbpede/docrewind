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

import type { Component } from "solid-js";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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

// An editorial pen-mark per kind — a non-color affordance paired with the seal
// hue (§9.11), drawn from a copy-editor's margin vocabulary: a section sign for a
// writing sitting, a caret-up for a surge of inserted text, a caret-down for a
// passage cut, and a caesura (the musical rest bar) for a pause between sittings.
// Exported so the legend keys each mark to its meaning with the same glyphs.
export function markerGlyph(kind: TimelineMarkerKind): string {
  switch (kind) {
    case "session":
      return "§";
    case "large-insertion":
      return "⌃";
    case "large-deletion":
      return "⌄";
    case "pause":
      return "‖";
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
  const tones = new Set(cluster.members.map((m) => markerToneClass(m.kind)));
  return tones.size === 1 ? [...tones][0]! : "tl-cluster-mixed";
}

/** Kind breakdown for a cluster, e.g. "1 editing session · 3 large insertions". */
function clusterBreakdown(members: readonly TimelineMarker[]): string {
  const counts = new Map<TimelineMarkerKind, number>();
  for (const member of members) {
    counts.set(member.kind, (counts.get(member.kind) ?? 0) + 1);
  }
  return CLUSTER_KIND_ORDER.filter((kind) => counts.has(kind))
    .map((kind) => {
      const count = counts.get(kind)!;
      const label = CLUSTER_KIND_LABEL[kind];
      return `${count} ${count === 1 ? label : `${label}s`}`;
    })
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

const Timeline: Component<TimelineProps> = (props) => {
  let track: HTMLDivElement | undefined;
  let activePointerId: number | null = null;
  const fraction = createMemo(() => (props.max > 0 ? props.currentIndex / props.max : 0));
  const pct = (value: number): string =>
    `${(props.max > 0 ? (value / props.max) * 100 : 0).toFixed(2)}%`;

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

  const clusters = createMemo(() => clusterMarkers(props.events, props.max, trackWidth()));

  // Hover/focus tooltip: a single popover, driven by the active cluster id, so the
  // seal itself stays a thin jump-to button. Set on enter/focus, cleared on
  // leave/blur — making the revision data reachable by pointer AND keyboard.
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const activeCluster = createMemo(() => {
    const id = activeId();
    return id === null ? undefined : clusters().find((cluster) => cluster.id === id);
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
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const next = Math.round(Math.max(0, Math.min(1, ratio)) * props.max);
    props.onScrub(next);
  }

  function onPointerDown(event: PointerEvent): void {
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
      <div class="tl-fill" style={{ width: `${fraction() * 100}%` }} />
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
              style={{ left: pct(cluster.index) }}
              aria-label={ariaLabel}
              aria-describedby={activeId() === cluster.id ? "tl-tip" : undefined}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerEnter={() => setActiveId(cluster.id)}
              onPointerLeave={() => setActiveId((id) => (id === cluster.id ? null : id))}
              onFocus={() => setActiveId(cluster.id)}
              onBlur={() => setActiveId((id) => (id === cluster.id ? null : id))}
              onClick={(event) => {
                event.stopPropagation();
                props.onScrub(cluster.jumpIndex);
              }}
            >
              {single === undefined
                ? count > 99
                  ? "99+"
                  : String(count)
                : markerGlyph(single.kind)}
            </button>
          );
        }}
      </For>
      <Show when={activeCluster()}>
        {(cluster) => {
          const summary = createMemo(() => summarizeCluster(cluster(), props.max));
          return (
            <div
              id="tl-tip"
              class="tl-tip"
              role="tooltip"
              style={{ left: pct(cluster().index), transform: tipTransform(cluster().index) }}
            >
              <span class="tl-tip-title">{summary().title}</span>
              <Show when={summary().detail}>
                {(detail) => <span class="tl-tip-detail">{detail()}</span>}
              </Show>
              <span class="tl-tip-rev">{summary().rev}</span>
            </div>
          );
        }}
      </Show>
      <div class="tl-thumb" style={{ left: pct(props.currentIndex) }} />
    </div>
  );
};

export default Timeline;
