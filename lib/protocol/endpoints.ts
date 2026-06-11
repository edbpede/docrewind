// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Endpoint URL construction (plan T2 / A.1, A.5). The `revisions/load` URL
// template lives ONLY here. PROVISIONAL — pending §24 capture — except the
// multi-account `/u/{N}/` path variant, which is confirmed-historical (A.5):
// hardcoded single-account paths break on multi-login sessions, so the variant
// must be detected or requests silently fail.

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
 * Build the `revisions/load` changelog URL (A.1). PROVISIONAL — pending §24;
 * the path/query shape is confirmed-historical but not live-settled for 2026.
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
 * a single-account path. Confirmed-historical (A.5).
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
