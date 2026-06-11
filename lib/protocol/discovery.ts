// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Revision-range discovery contract (plan T2 / A.4). TYPED INTERFACE ONLY — no
// live calls and no committed mechanism in Phase 3. There is no "all revisions"
// call; `start=1&end=-1` is rejected, so a real upper bound is required. The
// 2014-documented method binary-searches on HTTP 500 (range too high) vs 200
// (in range); a revision-count metadata field may also exist today. Which one
// is current is UNCONFIRMED until §24, so the strategy is left as a placeholder
// rather than speculatively encoded.

import type { DocId, RevisionId } from "../domain/ids";

/** Candidate discovery mechanisms (A.4). Which is current is §24-gated. */
export type DiscoveryStrategy =
  | "binary-search-http-500"
  | "revision-count-metadata"
  | "unconfirmed";

/** Default until §24 capture confirms the mechanism. */
export const DEFAULT_DISCOVERY_STRATEGY: DiscoveryStrategy = "unconfirmed";

/**
 * Outcome of probing whether a revision index is within range — the signal a
 * binary search would consume. Implemented against the real endpoint in
 * Phase 4 once §24 confirms the mechanism.
 */
export type RangeProbe = "in-range" | "too-high";

/**
 * Revision-range discovery interface. Phase 4 supplies the concrete strategy +
 * probe once §24 lands; Phase 3 ships only the typed seam (no network).
 */
export interface RevisionRangeDiscovery {
  readonly strategy: DiscoveryStrategy;
  /** Resolve the maximum valid revision id for a document. */
  discoverUpperBound(docId: DocId): Promise<RevisionId>;
}
