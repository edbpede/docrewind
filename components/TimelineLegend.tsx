// SPDX-License-Identifier: AGPL-3.0-or-later
//
// TimelineLegend — a quiet marginalia key beneath the scrubber. It names each
// writing-activity seal-mark (§ caret-up caret-down caesura) so a first-time
// reader can decode the stratum without hovering. Only the kinds ACTUALLY
// present in this document's timeline are listed (a key for marks that never
// appear would be noise), and the row renders nothing when there are no marks,
// so the legend never clutters a markerless replay. The hover/focus data lives
// on the marks themselves (Timeline tooltips); this is meaning, not data.

import type { Component } from "solid-js";
import { createMemo, For, Show } from "solid-js";
import {
  markerIcon,
  markerToneClass,
  type TimelineMarker,
  type TimelineMarkerKind,
} from "@/components/Timeline";
import { strings } from "@/lib/i18n/strings";

// Stable display order, independent of first-appearance order in the timeline.
const KIND_ORDER: readonly TimelineMarkerKind[] = [
  "session",
  "large-insertion",
  "large-deletion",
  "pause",
];

const KIND_LABEL: Record<TimelineMarkerKind, string> = {
  session: strings.timeline.markerSession,
  "large-insertion": strings.timeline.markerLargeInsertion,
  "large-deletion": strings.timeline.markerLargeDeletion,
  pause: strings.timeline.markerPause,
};

export interface TimelineLegendProps {
  readonly events: readonly TimelineMarker[];
}

const TimelineLegend: Component<TimelineLegendProps> = (props) => {
  const presentKinds = createMemo(() => {
    const present = new Set<TimelineMarkerKind>();
    for (const event of props.events) {
      present.add(event.kind);
    }
    return KIND_ORDER.filter((kind) => present.has(kind));
  });

  return (
    <Show when={presentKinds().length > 0}>
      <ul class="tl-legend" aria-label={strings.timeline.legendLabel}>
        <li class="text-xs font-medium text-ink-muted" aria-hidden="true">
          {strings.timeline.legendLabel}
        </li>
        <For each={presentKinds()}>
          {(kind) => (
            <li class="tl-legend-item">
              <span class={`tl-seal ${markerToneClass(kind)}`} aria-hidden="true">
                {markerIcon(kind)}
              </span>
              <span>{KIND_LABEL[kind]}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
};

export default TimelineLegend;
