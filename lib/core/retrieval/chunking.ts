// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Adaptive chunk sizing + exponential backoff (plan §1.4). PURE math/state: no
// clocks, no randomness, no I/O — so the orchestrator's pacing is fully unit-
// testable. The orchestrator grows the chunk size after a clean fetch and
// shrinks it after a failure, and waits `backoffDelay(attempt)` between retries.

import { unsafeAsRevisionId } from "@/lib/core/domain/ids";
import type { RevisionId, RevisionSpan } from "@/lib/core/domain/model";

/** Default revisions-per-chunk before any adaptation. */
export const DEFAULT_CHUNK_SIZE = 100;
/** Floor for adaptive shrinking. */
export const MIN_CHUNK_SIZE = 10;
/** Ceiling for adaptive growth. */
export const MAX_CHUNK_SIZE = 1000;

/** Base backoff delay (ms) for attempt 0. */
export const BASE_BACKOFF_MS = 500;
/** Maximum backoff delay (ms). */
export const MAX_BACKOFF_MS = 30_000;

/** Grow the chunk size after a successful fetch (doubles, capped at `max`). */
export function growChunkSize(current: number, max: number = MAX_CHUNK_SIZE): number {
  return Math.min(current * 2, max);
}

/** Shrink the chunk size after a failed fetch (halves, floored at `min`). */
export function shrinkChunkSize(current: number, min: number = MIN_CHUNK_SIZE): number {
  return Math.max(Math.floor(current / 2), min);
}

/**
 * Deterministic exponential backoff: `base * 2^attempt`, capped at `max`.
 * `attempt` is 0-indexed (attempt 0 waits `base`). No jitter — jitter, if
 * wanted, is added by the impure caller so this stays testable.
 */
export function backoffDelay(
  attempt: number,
  base: number = BASE_BACKOFF_MS,
  max: number = MAX_BACKOFF_MS,
): number {
  if (attempt < 0) return base;
  const raw = base * 2 ** attempt;
  return Math.min(raw, max);
}

/**
 * The next chunk span to fetch, `[nextStart, end]` inclusive, where
 * `end = min(nextStart + size - 1, upperBound)`. Returns `null` when
 * `nextStart` is already past `upperBound` (retrieval complete).
 */
export function nextChunkSpan(
  nextStart: RevisionId,
  size: number,
  upperBound: RevisionId,
): RevisionSpan | null {
  if (nextStart > upperBound) return null;
  const clampedSize = Math.max(1, Math.floor(size));
  const endValue = Math.min(nextStart + clampedSize - 1, upperBound);
  // nextStart >= 1 and endValue >= nextStart, so both stay positive integers;
  // the blind cast skips redundant revalidation of an arithmetic-derived id.
  return { start: nextStart, end: unsafeAsRevisionId(endValue) };
}
