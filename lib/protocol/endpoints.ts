// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Endpoint URL construction (plan T2 / A.1, A.5). The `revisions/load` URL
// template lives ONLY here. CONFIRMED by the §24 live capture (2026-06-12): the
// single-account `…/document/d/{id}/revisions/load?…` shape returns 200 JSON, and
// the multi-account `/u/{N}/` path variant is now LIVE-CONFIRMED (Firefox, two
// signed-in accounts; §24 Q8) — a `/u/1/` read returned 200 `application/json`,
// and `detectUserIndex`/`buildRevisionsLoadUrl` were re-verified against the live
// `/u/1/` URL. Hardcoded single-account paths break on multi-login sessions, so the
// variant must be detected or requests silently fail (the documented 2017 breakage).

import type { DocId, RevisionId } from "../domain/ids";

const DOCS_ORIGIN = "https://docs.google.com";

/** Parameters for a `revisions/load` request. `userIndex` is the `/u/{N}/` slot. */
export interface RevisionsLoadParams {
  readonly docId: DocId;
  readonly start: RevisionId;
  readonly end: RevisionId;
  // null = single-account path (no `/u/{N}/`); a number selects the slot (A.5).
  readonly userIndex: number | null;
}

/**
 * Build the `revisions/load` changelog URL (A.1). CONFIRMED live 2026-06-12 — the
 * single-account and `/u/{N}/` (§24 Q8) shapes both return 200 `application/json`.
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
  return `${DOCS_ORIGIN}${userSegment}/document/d/${params.docId}/revisions/load?${query.toString()}`;
}

// Extracts the multi-account slot from a `/u/{N}/` path segment (A.5).
const USER_INDEX_PATTERN = /\/u\/(\d+)\//;

/**
 * Detect the multi-account `/u/{N}/` index in a Docs URL, or null if the URL is
 * a single-account path. LIVE-CONFIRMED (§24 Q8, 2026-06-12): a real `/u/1/` URL
 * yields `1`, and the resulting `/u/1/` read returns 200 JSON.
 */
export function detectUserIndex(url: string): number | null {
  // Match against the pathname only, so a `/u/{N}/` embedded in a query or
  // fragment can't masquerade as the multi-account slot. Path-only/relative
  // inputs throw in `new URL` (no base); fall back to the raw string for them.
  let haystack: string;
  try {
    haystack = new URL(url).pathname;
  } catch {
    haystack = url;
  }
  const match = USER_INDEX_PATTERN.exec(haystack);
  if (match?.[1] === undefined) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}
