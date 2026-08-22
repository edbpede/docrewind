// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Timeline marker vocabulary — the PURE half of the timeline scrubber, split out
// of `Timeline.svelte` so it stays importable (and unit-testable) without the
// Svelte compiler in the loop: `test/replay.components.test.ts` exercises
// `clusterMarkers` directly, and `TimelineLegend.svelte` reuses the tone classes
// and kind ordering. Everything here is a pure function or a frozen constant; the
// component owns all state, geometry and markup. The kind→icon switch could not
// come along because it returns markup — it lives in `MarkerIcon.svelte`.

import { clusterCountLabel, revisionOf, revisionRangeOf, strings } from "@/lib/core/i18n/strings";

/** The four kinds of writing-activity mark drawn onto the timeline stratum. */
export type TimelineMarkerKind = "session" | "large-insertion" | "large-deletion" | "pause";

/** A timeline event projected onto the applied-count axis for rendering. */
export interface TimelineMarker {
  /**
   * Kind + anchor, used for tooltip/cluster identity.
   *
   * NOT unique: two events of the same kind anchored at the same revision produce
   * the SAME id (see `buildMarkers` in `entrypoints/replay/replay-app.ts`). Never key a
   * Svelte `{#each}` by it — `each_key_duplicate` is a hard runtime crash. Cluster
   * members are keyed by INDEX for exactly this reason.
   */
  readonly id: string;
  readonly kind: TimelineMarkerKind;
  /** Applied-count position in [0, max]. */
  readonly index: number;
  /** Accessible description (i18n) for the marker. */
  readonly label: string;
  /** Content-free revision data shown on hover/focus (e.g. "+1,240 characters"). */
  readonly detail?: string;
}

/**
 * A run of one-or-more marks rendered as a single entry. A single-member cluster
 * draws the familiar per-kind seal; a multi-member cluster draws a stacked count
 * seal. The `index` is the render anchor (the burst's mean position); `jumpIndex`
 * is the scrub target (the burst's first frame) so activating it lands the reader
 * at where the activity began.
 */
export interface MarkerCluster {
  /** Tooltip/`{#each}` key derived from the member ids — distinct per cluster
   *  because clusters partition a position-sorted list. */
  readonly id: string;
  readonly members: readonly TimelineMarker[];
  /** Mean applied-count position — where the seal is drawn. */
  readonly index: number;
  /** Earliest member index — where activation scrubs to. */
  readonly jumpIndex: number;
  /** Inclusive applied-count span of the members. */
  readonly span: { readonly start: number; readonly end: number };
}

/** One kind's tally within a cluster — the unit of both the peek ledger and aria. */
export interface ClusterBreakdownRow {
  readonly kind: TimelineMarkerKind;
  readonly count: number;
  /** Count-aware kind name, e.g. "Editing session" / "Large insertions". */
  readonly label: string;
}

// One source of truth for what a seal SAYS — reused by its aria-label and the
// shared popover, so the two never drift. A singleton speaks for its one mark; a
// stack speaks the count, the kind breakdown, and the span it covers.
export interface ClusterSummary {
  readonly title: string;
  readonly detail: string | undefined;
  readonly rev: string;
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
export const EDGE_INSET_PX = 28;
export const PLAYHEAD_REST_PX = 9;

// Stable display order for a cluster's kind breakdown (independent of the order
// the events arrive in). Mirrors the legend's ordering vocabulary.
export const CLUSTER_KIND_ORDER: readonly TimelineMarkerKind[] = [
  "session",
  "large-insertion",
  "large-deletion",
  "pause",
];

export const CLUSTER_KIND_LABEL: Record<TimelineMarkerKind, string> = {
  session: strings.timeline.markerSession,
  "large-insertion": strings.timeline.markerLargeInsertion,
  "large-deletion": strings.timeline.markerLargeDeletion,
  pause: strings.timeline.markerPause,
};

// A seal is ~16px; require a touch of breathing room before two are treated as
// colliding so the stacked seals never visually kiss.
const DEFAULT_COLLISION_PX = 18;

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
    const first = members[0];
    const last = members[members.length - 1];
    // groups only ever holds non-empty member arrays
    if (first === undefined || last === undefined) {
      throw new Error("clusterMarkers: unexpected empty group");
    }
    const start = first.index; // sorted ascending
    const end = last.index;
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
export function clusterToneClass(cluster: MarkerCluster): string {
  const kinds = new Set(cluster.members.map((m) => m.kind));
  const first = cluster.members[0];
  return kinds.size === 1 && first ? markerToneClass(first.kind) : "tl-cluster-mixed";
}

/**
 * Per-kind tallies in stable display order. Drives the structured hover-peek
 * ledger (one chip-row per kind) and, joined, the seal's accessible breakdown —
 * so the visible rows and the spoken summary can never drift apart.
 */
export function clusterBreakdownRows(
  members: readonly TimelineMarker[],
): readonly ClusterBreakdownRow[] {
  const counts = new Map<TimelineMarkerKind, number>();
  for (const member of members) {
    counts.set(member.kind, (counts.get(member.kind) ?? 0) + 1);
  }
  return CLUSTER_KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => {
    const count = counts.get(kind) ?? 0;
    const base = CLUSTER_KIND_LABEL[kind];
    return { kind, count, label: count === 1 ? base : `${base}s` };
  });
}

/** Kind breakdown for a cluster, e.g. "1 Editing session · 3 Large insertions". */
export function clusterBreakdown(members: readonly TimelineMarker[]): string {
  return clusterBreakdownRows(members)
    .map((row) => `${row.count} ${row.label}`)
    .join(" · ");
}

export function summarizeCluster(cluster: MarkerCluster, max: number): ClusterSummary {
  const [first] = cluster.members;
  if (cluster.members.length === 1 && first) {
    return { title: first.label, detail: first.detail, rev: revisionOf(first.index, max) };
  }
  return {
    title: clusterCountLabel(cluster.members.length),
    detail: clusterBreakdown(cluster.members),
    rev: revisionRangeOf(cluster.span.start, cluster.span.end, max),
  };
}

/**
 * The seal's accessible name: title, kind breakdown and revision span joined into
 * one line. A pure helper rather than three statements in the render loop, because
 * Svelte's `{@const}` accepts only expressions — the construction has to live
 * somewhere callable, and next to `summarizeCluster` is where it belongs.
 */
export function clusterAriaLabel(cluster: MarkerCluster, max: number): string {
  const summary = summarizeCluster(cluster, max);
  return [summary.title, summary.detail, summary.rev]
    .filter((part): part is string => part !== undefined)
    .join(" — ");
}
