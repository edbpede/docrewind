// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Revision-range discovery contract (plan T2 / A.4). There is no "all revisions"
// call; `start=1&end=-1` is rejected, so a real upper bound is required.
//
// CONFIRMED by the §24 live capture (2026-06-12):
//   • The current revision count is published in the editor bootstrap as
//     `"revision":N` — a single-request metadata read (the gentlest path, A.9).
//   • Out-of-range `end` now returns HTTP 400 (the 2014 teardown saw 500); an
//     in-range `end` returns 200. That 200/400 boundary is the binary-search
//     signal used as a fallback when the bootstrap shape ever drifts.
// The live adapter (entrypoints/background.ts) implements metadata-primary with
// the binary-search fallback; the orchestrator consumes `discoverUpperBound`
// only and never branches on the strategy, so a future Q5 change is an adapter
// swap, not an orchestrator rewrite.

import type { DocId, RevisionId } from "@/lib/core/domain/ids";

/** Candidate discovery mechanisms (A.4). The confirmed default is metadata. */
export type DiscoveryStrategy =
  | "binary-search-http-400"
  | "revision-count-metadata"
  | "unconfirmed";

/** Default confirmed by §24 (2026-06-12): bootstrap `"revision":N` metadata. */
export const DEFAULT_DISCOVERY_STRATEGY: DiscoveryStrategy = "revision-count-metadata";

/**
 * Outcome of probing whether a revision index is within range — the signal the
 * binary-search fallback consumes: HTTP 200 ⇒ in-range, HTTP 400 ⇒ too-high.
 */
export type RangeProbe = "in-range" | "too-high";

/**
 * Revision-range discovery interface. The live adapter supplies the concrete
 * strategy + probe (entrypoints/background.ts); the pure core depends only on
 * this typed seam (no network).
 */
export interface RevisionRangeDiscovery {
  readonly strategy: DiscoveryStrategy;
  /** Resolve the maximum valid revision id for a document. */
  discoverUpperBound(docId: DocId): Promise<RevisionId>;
}
