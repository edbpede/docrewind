// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Follow-caret geometry (pure, browser-free). The replay viewport keeps the
// active writing caret legible during NON-LINEAR playback — a student jumping
// page 1 → page 5 → page 2 — by scrolling the page only when the caret strays
// out of a comfortable reading BAND. The band is a dead zone (hysteresis): the
// caret may wander freely inside it without moving the page, so the view never
// twitches on every keystroke-sized edit; it recenters only when the caret
// crosses an edge. All decisions are computed from plain numbers here so the
// hysteresis is unit-testable without a layout engine — the DOM read and the
// `window.scrollTo` call live in `components/DocumentViewport.tsx`.

/** The comfortable reading band + recenter anchor, as fractions of viewport
 *  height. A caret between {@link BAND_TOP} and {@link BAND_BOTTOM} sits still;
 *  once it crosses out, the page recenters it to {@link BAND_ANCHOR}. The anchor
 *  sits a little above centre so the freshly written run and the text growing
 *  after it both stay in view. */
export const BAND_TOP = 0.2;
export const BAND_BOTTOM = 0.78;
export const BAND_ANCHOR = 0.38;

/** Sub-pixel scrolls are pointless churn (and a wasted smooth animation). */
const MIN_SCROLL_DELTA_PX = 1;

export interface BandOptions {
  readonly top?: number;
  readonly bottom?: number;
  readonly anchor?: number;
}

export interface FollowScroll {
  /** Whether the caret is outside the band and a scroll is warranted. */
  readonly scroll: boolean;
  /** Target document scrollY (clamped ≥ 0); equals `scrollY` when not scrolling. */
  readonly top: number;
}

/**
 * Decide whether (and where) to scroll so the caret rests in the reading band.
 * `caretTop`/`caretBottom` are viewport-relative (a `getBoundingClientRect`),
 * `scrollY` the current document scroll. Returns `scroll: false` while the caret
 * is comfortably inside the band — the hysteresis that prevents jarring motion.
 */
export function followScroll(
  caretTop: number,
  caretBottom: number,
  viewportHeight: number,
  scrollY: number,
  band: BandOptions = {},
): FollowScroll {
  const bandTopPx = viewportHeight * (band.top ?? BAND_TOP);
  const bandBottomPx = viewportHeight * (band.bottom ?? BAND_BOTTOM);
  // Inside the dead zone → leave the page exactly where it is.
  if (caretTop >= bandTopPx && caretBottom <= bandBottomPx) {
    return { scroll: false, top: scrollY };
  }
  const target = Math.max(0, scrollY + caretTop - viewportHeight * (band.anchor ?? BAND_ANCHOR));
  if (Math.abs(target - scrollY) < MIN_SCROLL_DELTA_PX) {
    return { scroll: false, top: scrollY };
  }
  return { scroll: true, top: target };
}

/** Where the caret sits relative to the viewport — drives the off-screen pill. */
export type CaretVisibility = "visible" | "above" | "below";

/**
 * Classify the caret against the viewport edges. `above`/`below` mean fully
 * off-screen in that direction (so a "Jump to edit" pill can point the right
 * way); any overlap with the viewport counts as `visible`.
 */
export function caretVisibility(
  caretTop: number,
  caretBottom: number,
  viewportHeight: number,
): CaretVisibility {
  if (caretBottom <= 0) return "above";
  if (caretTop >= viewportHeight) return "below";
  return "visible";
}
