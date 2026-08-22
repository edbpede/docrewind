// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shared prop contract for the DocRewind icon set — see `./index.ts` for the
// set-wide provenance and style contract, and `./Icon.svelte` for the frame every
// icon renders through.
//
// This lives in a plain `.ts` rather than in `Icon.svelte`'s `<script module>` so
// that `./index.ts` can re-export it: `tsc` resolves a `.svelte` specifier through
// the ambient `*.svelte` shim, which declares a default export only, so a named
// export read from a `.ts` file fails to typecheck even though `svelte-check`
// resolves it. Same reasoning as `components/replay/timeline-markers.ts`.

export interface IconProps {
  /** Edge length in px. Default 20. */
  readonly size?: number | undefined;
  /** Extra classes (color via `text-*`, since paths use `currentColor`). */
  readonly class?: string | undefined;
  /** Stroke width for outline icons. Default 1.75. */
  readonly stroke?: number | undefined;
}
