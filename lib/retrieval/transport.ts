// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chunk-transport seam (plan §1.4, §0 / PRD §10.9). The orchestrator depends ONLY
// on the `ChunkFetcher` interface — never on a concrete network call. This module
// is PURE: it defines the interface and a `GatedChunkFetcher` that performs NO
// network I/O and no extension-API access, returning the gated
// `endpoint-unavailable` error. The single LIVE network adapter is constructed in
// `entrypoints/background.ts` (the live activation site). The §24 capture landed
// (2026-06-12) and that adapter is now live; this pure stub stays as a test fixture
// and a safe fallback — no network I/O ever reaches this module.

import type { DocId, RawPayload, RevisionSpan } from "../domain/model";
import { fail, type Result, type RetrievalError, retrievalError } from "./errors";

/** A request for one inclusive span of revisions. */
export interface ChunkRequest {
  readonly docId: DocId;
  readonly span: RevisionSpan;
  /** Multi-account `/u/{N}/` slot, or null for a single-account session (A.5). */
  readonly userIndex: number | null;
}

/**
 * Fetches one raw chunk. The sole transport dependency of the orchestrator.
 * Implementations: the pure {@link createGatedChunkFetcher} stub (here), test
 * fakes, and — post-§24 — the live adapter in `entrypoints/background.ts`.
 */
export interface ChunkFetcher {
  fetchChunk(request: ChunkRequest): Promise<Result<RawPayload, RetrievalError>>;
}

/**
 * A pure, no-I/O `ChunkFetcher` that always resolves to the typed
 * `endpoint-unavailable` error. Used by the orchestrator tests and as a safe
 * fallback; the live network adapter lives in `entrypoints/background.ts`.
 */
export function createGatedChunkFetcher(): ChunkFetcher {
  return {
    async fetchChunk(): Promise<Result<RawPayload, RetrievalError>> {
      // No network I/O here by design — the live adapter is injected in
      // entrypoints/background.ts (post-§24). This stub keeps the seam pure.
      return fail(retrievalError("endpoint-unavailable"));
    },
  };
}
