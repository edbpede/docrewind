<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // PlaybackControls (plan Phase 5 Step 5b). Play/pause, restart, and a fixed speed
  // selector. Fully keyboard-operable: every control is a real <button> (Space/Enter
  // activate natively, so Space toggles play/pause when focused) with an accessible
  // name and a visible focus ring. Play/pause pairs an icon WITH text, never color
  // alone (§9.11). Speed is a friendly segmented control (the selected multiplier is
  // a raised pill — clearly "the one"). The speed set is a fixed-length value list,
  // so it renders through a KEYLESS `{#each}` (Solid's `<Index>`).

  /** The fixed playback-speed multipliers. */
  export const SPEEDS = [0.5, 1, 2, 4] as const;
</script>

<script lang="ts">
  import { IconCrosshair, IconPause, IconPlay, IconRestart } from "@/components/common/icons";
  import { speedLabel, strings } from "@/lib/core/i18n/strings";

  export interface PlaybackControlsProps {
    readonly playing: boolean;
    readonly speed: number;
    readonly onPlayPause: () => void;
    readonly onRestart: () => void;
    readonly onSpeed: (speed: number) => void;
    readonly follow: boolean;
    readonly onFollowChange: (follow: boolean) => void;
  }

  const {
    playing,
    speed,
    onPlayPause,
    onRestart,
    onSpeed,
    follow,
    onFollowChange,
  }: PlaybackControlsProps = $props();
</script>

<div class="flex flex-wrap items-center gap-3">
  <button
    type="button"
    class="btn-primary"
    aria-pressed={playing}
    aria-label={playing ? strings.controls.pause : strings.controls.play}
    onclick={() => onPlayPause()}
  >
    {#if playing}
      <IconPause size={18} />
    {:else}
      <IconPlay size={18} />
    {/if}
    <span>{playing ? strings.controls.pause : strings.controls.play}</span>
  </button>

  <button
    type="button"
    class="btn-secondary"
    aria-label={strings.controls.restart}
    onclick={() => onRestart()}
  >
    <IconRestart size={18} />
    <span>{strings.controls.restart}</span>
  </button>

  <!-- "Follow edits": a sticky lock-to-caret toggle (like a video game's "lock to
       player"). On by default; the viewport auto-scrolls to keep the active edit in
       view during non-linear playback. A real toggle — aria-pressed carries the state,
       paired with a brand tint and the crosshair icon (never colour alone, §9.11). -->
  <button
    type="button"
    class={follow
      ? "btn-base bg-brand-soft text-brand-text ring-1 ring-brand-ring"
      : "btn-base bg-surface text-ink ring-1 ring-hairline-strong hover:bg-hover"}
    aria-pressed={follow}
    aria-label={strings.controls.followCaret}
    onclick={() => onFollowChange(!follow)}
  >
    <IconCrosshair size={18} />
    <span>{strings.controls.followCaret}</span>
  </button>

  <!-- A real <fieldset>/<legend> for the speed group (native group semantics —
       biome's useSemanticElements rejects role="group" on a div). The legend is
       a visible, friendly label floated beside the segmented control. -->
  <fieldset class="m-0 ml-auto inline-flex items-center gap-2.5 border-0 p-0">
    <legend class="float-left mr-1 text-[0.8125rem] font-medium text-ink-muted">
      {strings.controls.speedGroup}
    </legend>
    <div class="seg">
      <!-- A KEYLESS `{#each}` — the exact equivalent of the `<Index>` this replaced.
           `SPEEDS` is a fixed-length, never-reordered tuple of primitives, so keying
           it would buy nothing and keying by VALUE on a primitive array is precisely
           the pattern that throws `each_key_duplicate` in Svelte. DO NOT ADD A KEY HERE. -->
      {#each SPEEDS as option}
        <button
          type="button"
          class={speed === option ? "seg-item seg-item-active" : "seg-item"}
          aria-pressed={speed === option}
          aria-label={speedLabel(option)}
          onclick={() => onSpeed(option)}
        >
          {speedLabel(option)}
        </button>
      {/each}
    </div>
  </fieldset>
</div>
