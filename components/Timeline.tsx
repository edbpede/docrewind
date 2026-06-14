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
import { createMemo, For, Show } from "solid-js";
import { revisionOf, strings } from "@/lib/i18n/strings";

/** A timeline event projected onto the applied-count axis for rendering. */
export interface TimelineMarker {
  /** Stable key (kind + anchor) for `<For>`. */
  readonly id: string;
  readonly kind: "session" | "large-insertion" | "large-deletion" | "pause";
  /** Applied-count position in [0, max]. */
  readonly index: number;
  /** Accessible description (i18n) for the marker. */
  readonly label: string;
}

export interface TimelineProps {
  readonly currentIndex: number;
  readonly max: number;
  readonly events: readonly TimelineMarker[];
  readonly onScrub: (index: number) => void;
}

/** Glyph per marker kind — a non-color affordance paired with the marker hue. */
function markerGlyph(kind: TimelineMarker["kind"]): string {
  switch (kind) {
    case "session":
      return "●";
    case "large-insertion":
      return "▲";
    case "large-deletion":
      return "▼";
    case "pause":
      return "▮";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function markerClass(kind: TimelineMarker["kind"]): string {
  switch (kind) {
    case "session":
      return "tl-marker tl-marker-session";
    case "large-insertion":
    case "large-deletion":
      return "tl-marker tl-marker-large";
    case "pause":
      return "tl-marker tl-marker-pause";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

const Timeline: Component<TimelineProps> = (props) => {
  const fraction = createMemo(() => (props.max > 0 ? props.currentIndex / props.max : 0));
  const pct = (value: number): string =>
    `${(props.max > 0 ? (value / props.max) * 100 : 0).toFixed(2)}%`;

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
      class="tl-track"
      role="slider"
      tabIndex={0}
      aria-label={strings.timeline.label}
      aria-valuemin={0}
      aria-valuemax={props.max}
      aria-valuenow={props.currentIndex}
      aria-valuetext={revisionOf(props.currentIndex, props.max)}
      onKeyDown={onKeyDown}
    >
      <div class="tl-fill" style={{ width: `${fraction() * 100}%` }} />
      <For each={props.events}>
        {(marker) => (
          <Show when={marker.index >= 0 && marker.index <= props.max}>
            <span
              class={markerClass(marker.kind)}
              style={{ left: pct(marker.index) }}
              title={marker.label}
              aria-hidden="true"
            >
              {markerGlyph(marker.kind)}
            </span>
          </Show>
        )}
      </For>
      <div class="tl-thumb" style={{ left: pct(props.currentIndex) }} />
    </div>
  );
};

export default Timeline;
