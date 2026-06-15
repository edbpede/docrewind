// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PlaybackControls (plan Phase 5 Step 5b). Play/pause, restart, and a fixed speed
// selector. Fully keyboard-operable: every control is a real <button> (Space/Enter
// activate natively, so Space toggles play/pause when focused) with an accessible
// name and a visible focus ring. Play/pause pairs an icon WITH text, never color
// alone (§9.11). The speed set is a fixed-length value list, so it uses <Index>.

import type { Component } from "solid-js";
import { Index } from "solid-js";
import { speedLabel, strings } from "@/lib/i18n/strings";

/** The fixed playback-speed multipliers. */
export const SPEEDS = [0.5, 1, 2, 4] as const;

export interface PlaybackControlsProps {
  readonly playing: boolean;
  readonly speed: number;
  readonly onPlayPause: () => void;
  readonly onRestart: () => void;
  readonly onSpeed: (speed: number) => void;
}

const PlaybackControls: Component<PlaybackControlsProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn-primary"
        aria-pressed={props.playing}
        aria-label={props.playing ? strings.controls.pause : strings.controls.play}
        onClick={() => props.onPlayPause()}
      >
        <span aria-hidden="true">{props.playing ? "⏸" : "▶"}</span>
        <span>{props.playing ? strings.controls.pause : strings.controls.play}</span>
      </button>

      <button
        type="button"
        class="btn-secondary"
        aria-label={strings.controls.restart}
        onClick={() => props.onRestart()}
      >
        <span aria-hidden="true">⤺</span>
        <span>{strings.controls.restart}</span>
      </button>

      <fieldset class="m-0 ml-auto inline-flex items-center gap-2 border-0 p-0">
        <legend class="dr-eyebrow float-left mr-1">{strings.controls.speedGroup}</legend>
        <div class="inline-flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
          <Index each={SPEEDS}>
            {(speed) => (
              <button
                type="button"
                class={props.speed === speed() ? "btn-ghost btn-active" : "btn-ghost"}
                aria-pressed={props.speed === speed()}
                aria-label={speedLabel(speed())}
                onClick={() => props.onSpeed(speed())}
              >
                {speedLabel(speed())}
              </button>
            )}
          </Index>
        </div>
      </fieldset>
    </div>
  );
};

export default PlaybackControls;
