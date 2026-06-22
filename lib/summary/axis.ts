// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Document-summary axis math — PURE and browser-free (no DOM, no network, no
// clock beyond the timestamps it is handed). The time-axis tick generation and
// the hover nearest-point search are split out of the rendering component so both
// stay deterministically unit-testable. Uses LOCAL time deliberately (a teacher
// reads ticks in their own timezone), exactly like the i18n day/hour label
// formatters that consume these timestamps. Metadata only (timestamps) — never any
// document text — so it stays inside the privacy model like the rest of lib/summary.

import type { SummaryPoint } from "./derive";

export const ONE_HOUR_MS = 3_600_000;
export const ONE_DAY_MS = 86_400_000;

/**
 * Below this total span the day axis is too coarse — a single-day document
 * collapses into one undivided band with no hour cues — so the axis switches to
 * hour ticks. 36h spans a day with a little spill into the next, keeping a
 * single-session document legible without crowding a normal multi-day axis.
 */
export const SHORT_SPAN_MS = 36 * ONE_HOUR_MS;

/** True when [start, end] is a real, short span that warrants hour (vs day) ticks. */
export function isShortSpan(start: number, end: number): boolean {
  const span = end - start;
  return span > 0 && span <= SHORT_SPAN_MS;
}

/** Local start-of-day (midnight) for a timestamp — used to decide when a granular
 *  (hour) tick must re-establish the calendar day in its label. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Day-boundary ticks (local midnights) spanning [start, end], thinned to a
 *  bounded count. The first tick is the midnight of the start day (≤ start), so it
 *  anchors the leftmost label. For spans under ~800 days the stride is 1 (every
 *  day); beyond that it widens just enough to keep the iteration count capped. */
export function buildDayTicks(start: number, end: number): readonly number[] {
  if (!(end > start)) return [];
  const ticks: number[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const totalDays = Math.ceil((end - cursor.getTime()) / ONE_DAY_MS) + 1;
  const stepDays = Math.max(1, Math.ceil(totalDays / 800));
  for (let i = 0; i < totalDays; i += stepDays) {
    const ms = cursor.getTime();
    if (ms > end) break;
    ticks.push(ms);
    cursor.setDate(cursor.getDate() + stepDays);
    cursor.setHours(0, 0, 0, 0);
  }
  return ticks;
}

/** Hour stride for the granular axis: finer for tight sessions, coarser as the
 *  span grows toward the day threshold, so a short doc still gets a handful of
 *  legible ticks (the caller thins any that would overprint). */
export function hourStepHours(spanMs: number): number {
  if (spanMs <= 6 * ONE_HOUR_MS) return 1;
  if (spanMs <= 12 * ONE_HOUR_MS) return 2;
  if (spanMs <= 24 * ONE_HOUR_MS) return 3;
  return 6;
}

/** Hour-boundary ticks spanning [start, end] for short-span documents, anchored to
 *  tidy multiples of the stride from local midnight (…, 9:00, 12:00, 15:00, …) and
 *  re-aligned by wall clock each step so a DST shift never skews the labels. Every
 *  tick lands within [start, end] (no left-clamped sliver). */
export function buildHourTicks(start: number, end: number): readonly number[] {
  if (!(end > start)) return [];
  const step = hourStepHours(end - start);
  const cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);
  // Advance to the first stride-aligned hour at or after `start`. Bounded by a day
  // of single-hour steps so a pathological clock can never spin the loop.
  let guard = 0;
  while ((cursor.getHours() % step !== 0 || cursor.getTime() < start) && guard < 48) {
    cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
    guard += 1;
  }
  const ticks: number[] = [];
  while (cursor.getTime() <= end) {
    ticks.push(cursor.getTime());
    cursor.setHours(cursor.getHours() + step, 0, 0, 0);
  }
  return ticks;
}

/** Nearest plotted point to a target timestamp (binary search; `series` is
 *  time-sorted, as `deriveDocumentSummary` emits it). Drives the shared hover
 *  scrub without scanning every revision, so cost is O(log n) per pointer move. */
export function nearestPoint(
  series: readonly SummaryPoint[],
  targetT: number,
): SummaryPoint | null {
  if (series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const point = series[mid];
    if (point === undefined) break;
    if (point.t < targetT) lo = mid + 1;
    else hi = mid;
  }
  const at = series[lo];
  const before = lo > 0 ? series[lo - 1] : undefined;
  if (at === undefined) return before ?? null;
  if (before === undefined) return at;
  return Math.abs(before.t - targetT) <= Math.abs(at.t - targetT) ? before : at;
}

/** A "nice" axis step ≥ `rawStep`, snapped to 1 / 2 / 5 × a power of ten — the
 *  canonical gridline rounding so a quantitative axis reads as tidy round numbers
 *  (…, 50, 100, 200, 500, …) instead of arbitrary fractions. */
export function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const factor = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return factor * magnitude;
}

/** Quantitative Y-axis ticks for a `[0, max]` range: a tidy rounded ceiling
 *  (`axisMax`, ≥ `max`) plus the ascending gridline values from 0 up to it (about
 *  `maxCount` + 1 ticks). Lets the activity chart show a readable length SCALE
 *  rather than only its peak. Pure — no DOM, no clock; integer-rounded so character
 *  counts never label a fractional gridline. */
export function linearTicks(
  max: number,
  maxCount = 4,
): { readonly axisMax: number; readonly ticks: readonly number[] } {
  if (!(max > 0) || !Number.isFinite(max) || !(maxCount >= 1)) {
    return { axisMax: 1, ticks: [0, 1] };
  }
  const step = niceStep(max / maxCount);
  const axisMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  let prev = Number.NaN;
  // The tiny epsilon lets the ceiling tick survive float accumulation error.
  for (let v = 0; v <= axisMax + step * 1e-9; v += step) {
    const rounded = Math.round(v);
    if (rounded !== prev) {
      ticks.push(rounded);
      prev = rounded;
    }
  }
  return { axisMax, ticks };
}
