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

import type { Component } from "solid-js";
import { createMemo, createSignal, For, Show } from "solid-js";
import { revisionOf, strings } from "@/lib/i18n/strings";

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

const Timeline: Component<TimelineProps> = (props) => {
  let track: HTMLDivElement | undefined;
  let activePointerId: number | null = null;
  const fraction = createMemo(() => (props.max > 0 ? props.currentIndex / props.max : 0));
  const pct = (value: number): string =>
    `${(props.max > 0 ? (value / props.max) * 100 : 0).toFixed(2)}%`;

  // Hover/focus tooltip: a single popover, driven by the active marker id, so the
  // mark itself stays a thin jump-to button. Set on enter/focus, cleared on
  // leave/blur — making the revision data reachable by pointer AND keyboard.
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const activeMarker = createMemo(() => {
    const id = activeId();
    return id === null ? undefined : props.events.find((event) => event.id === id);
  });
  // Edge-aware horizontal anchoring: a centered popover near a track end would
  // spill off the page, so clamp to the marker's left/right edge in the margins.
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
      <For each={props.events}>
        {(marker) => (
          <Show when={marker.index >= 0 && marker.index <= props.max}>
            <button
              type="button"
              class={`tl-marker ${markerToneClass(marker.kind)} p-0`}
              style={{ left: pct(marker.index) }}
              aria-label={
                marker.detail === undefined
                  ? `${marker.label} — ${revisionOf(marker.index, props.max)}`
                  : `${marker.label} — ${marker.detail} — ${revisionOf(marker.index, props.max)}`
              }
              aria-describedby={activeId() === marker.id ? "tl-tip" : undefined}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerEnter={() => setActiveId(marker.id)}
              onPointerLeave={() => setActiveId((id) => (id === marker.id ? null : id))}
              onFocus={() => setActiveId(marker.id)}
              onBlur={() => setActiveId((id) => (id === marker.id ? null : id))}
              onClick={(event) => {
                event.stopPropagation();
                props.onScrub(marker.index);
              }}
            >
              {markerGlyph(marker.kind)}
            </button>
          </Show>
        )}
      </For>
      <Show when={activeMarker()}>
        {(marker) => (
          <div
            id="tl-tip"
            class="tl-tip"
            role="tooltip"
            style={{ left: pct(marker().index), transform: tipTransform(marker().index) }}
          >
            <span class="tl-tip-title">{marker().label}</span>
            <Show when={marker().detail}>
              {(detail) => <span class="tl-tip-detail">{detail()}</span>}
            </Show>
            <span class="tl-tip-rev">{revisionOf(marker().index, props.max)}</span>
          </div>
        )}
      </Show>
      <div class="tl-thumb" style={{ left: pct(props.currentIndex) }} />
    </div>
  );
};

export default Timeline;
