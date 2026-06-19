// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PlaybackControls (plan Phase 5 Step 5b). Play/pause, restart, and a fixed speed
// selector. Fully keyboard-operable: every control is a real <button> (Space/Enter
// activate natively, so Space toggles play/pause when focused) with an accessible
// name and a visible focus ring. Play/pause pairs an icon WITH text, never color
// alone (§9.11). Speed is a friendly segmented control (the selected multiplier is
// a raised pill — clearly "the one"). The speed set is a fixed-length value list,
// so it uses <Index>.

import type { Component } from "solid-js";
import { Index } from "solid-js";
import { IconPause, IconPlay, IconRestart } from "@/components/icons";
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
    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="btn-primary"
        aria-pressed={props.playing}
        aria-label={props.playing ? strings.controls.pause : strings.controls.play}
        onClick={() => props.onPlayPause()}
      >
        <Index each={[props.playing]}>
          {(isPlaying) => (isPlaying() ? <IconPause size={18} /> : <IconPlay size={18} />)}
        </Index>
        <span>{props.playing ? strings.controls.pause : strings.controls.play}</span>
      </button>

      <button
        type="button"
        class="btn-secondary"
        aria-label={strings.controls.restart}
        onClick={() => props.onRestart()}
      >
        <IconRestart size={18} />
        <span>{strings.controls.restart}</span>
      </button>

      {/* A real <fieldset>/<legend> for the speed group (native group semantics —
          biome's useSemanticElements rejects role="group" on a div). The legend is
          a visible, friendly label floated beside the segmented control. */}
      <fieldset class="m-0 ml-auto inline-flex items-center gap-2.5 border-0 p-0">
        <legend class="float-left mr-1 text-[0.8125rem] font-medium text-ink-muted">
          {strings.controls.speedGroup}
        </legend>
        <div class="seg">
          <Index each={SPEEDS}>
            {(speed) => (
              <button
                type="button"
                class={props.speed === speed() ? "seg-item seg-item-active" : "seg-item"}
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
