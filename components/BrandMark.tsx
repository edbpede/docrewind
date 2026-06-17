// SPDX-License-Identifier: AGPL-3.0-or-later
//
// BrandMark — the DocRewind logo lockup, a single source of truth for the brand
// glyph wherever it appears in-app (replay masthead, options header, the
// load/error/progress cards). The glyph is the SAME canonical asset shipped as
// the extension icon (served from the public dir at /icon/docrewind.svg), so the
// manifest PNGs and the UI never drift apart.
//
// The art carries light highlights and deep navies that would lose contrast on
// either the paper-light or stone-dark page, so it is seated on the `dr-brandmark`
// "app chip" (always-light, ringed tile) — see uno.config.ts.
//
// Solid idioms: `props.x` (never destructured), `class` (never `className`).
// The mark is DECORATIVE by default (it always sits beside the visible product
// name), so its `alt` is empty and it leaves the accessibility tree. Pass
// `label` for a standalone, name-carrying instance.

import type { Component, JSX } from "solid-js";

/** The brand glyph, served from the public dir (same asset as the manifest icon). */
const ICON_URL = "/icon/docrewind.svg";

export interface BrandMarkProps {
  /** Edge length of the chip in px. Default 36 (masthead/header scale). */
  readonly size?: number;
  /** Accessible name for a STANDALONE mark. Omit when paired with visible text. */
  readonly label?: string;
  /** Extra classes on the chip (e.g. spacing utilities from the caller). */
  readonly class?: string;
}

const BrandMark: Component<BrandMarkProps> = (props) => {
  const size = (): number => props.size ?? 36;
  const style = (): JSX.CSSProperties => ({
    width: `${size()}px`,
    height: `${size()}px`,
  });
  return (
    <span class={`dr-brandmark ${props.class ?? ""}`} style={style()}>
      <img
        src={ICON_URL}
        alt={props.label ?? ""}
        class="block size-full object-contain"
        draggable={false}
      />
    </span>
  );
};

export default BrandMark;
