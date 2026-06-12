// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Endpoint URL construction (plan T2 / A.1, A.5). The `revisions/load` URL
// template lives ONLY here. CONFIRMED by the §24 live capture (2026-06-12): the
// single-account `…/document/d/{id}/revisions/load?…` shape returns 200 JSON, and
// the multi-account `/document/u/{N}/d/…` path variant is now LIVE-CONFIRMED (Firefox, two
// signed-in accounts; §24 Q8) — a `/document/u/1/d/` read returned 200 `application/json`,
// and `detectUserIndex`/`buildRevisionsLoadUrl` were re-verified against the live
// `/document/u/1/d/` URL. Hardcoded single-account paths break on multi-login sessions, so the
// variant must be detected or requests silently fail (the documented 2017 breakage).

import type { DocId, RevisionId } from "../domain/ids";

const DOCS_ORIGIN = "https://docs.google.com";

/** Parameters for a `revisions/load` request. `userIndex` is the `/document/u/{N}/d/` slot. */
export interface RevisionsLoadParams {
  readonly docId: DocId;
  readonly start: RevisionId;
  readonly end: RevisionId;
  // null = single-account path (no `/document/u/{N}/d/`); a number selects the slot (A.5).
  readonly userIndex: number | null;
}

/**
 * Build the `revisions/load` changelog URL (A.1). CONFIRMED live 2026-06-12 — the
 * single-account and `/document/u/{N}/d/` (§24 Q8) shapes both return 200 `application/json`.
 */
export function buildRevisionsLoadUrl(params: RevisionsLoadParams): string {
  if (params.userIndex !== null && (!Number.isInteger(params.userIndex) || params.userIndex < 0)) {
    throw new TypeError("buildRevisionsLoadUrl: userIndex must be a non-negative integer or null");
  }
  const userSegment = params.userIndex !== null ? `/u/${params.userIndex}` : "";
  const query = new URLSearchParams({
    id: params.docId,
    start: String(params.start),
    end: String(params.end),
  });
  return `${DOCS_ORIGIN}/document${userSegment}/d/${params.docId}/revisions/load?${query.toString()}`;
}

// Extracts the multi-account slot from a `/document/u/{N}/d/` path segment (A.5).
const USER_INDEX_PATTERN = /\/document\/u\/(\d+)\/d\//;

/**
 * Detect the multi-account `/document/u/{N}/d/` index in a Docs URL, or null if the URL is
 * a single-account path. LIVE-CONFIRMED (§24 Q8, 2026-06-12): a real
 * `/document/u/1/d/` URL yields `1`, and the resulting read returns 200 JSON.
 */
export function detectUserIndex(url: string): number | null {
  // Match against the pathname only, so a `/document/u/{N}/d/` embedded in a query or
  // fragment can't masquerade as the multi-account slot. Path-only/relative
  // inputs are resolved against the Docs origin to keep the pathname-only guarantee.
  let haystack: string;
  try {
    haystack = new URL(url).pathname;
  } catch {
    try {
      haystack = new URL(url, DOCS_ORIGIN).pathname;
    } catch {
      haystack = url;
    }
  }
  const match = USER_INDEX_PATTERN.exec(haystack);
  if (match?.[1] === undefined) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}
