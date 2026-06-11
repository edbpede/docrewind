// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chunk-transport seam (plan §1.4, §0 / PRD §10.9). The orchestrator depends ONLY
// on the `ChunkFetcher` interface — never on a concrete network call. This module
// is PURE: it defines the interface and a `GatedChunkFetcher` that performs NO
// network I/O and no extension-API access, returning the gated
// `endpoint-unavailable` error. The single LIVE network adapter is constructed in
// `entrypoints/background.ts` (the one `// BLOCKED §24` activation site) and
// swapped in once the §24 capture lands — a localized change, no edit here.

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
 * The §24-gated stub. Performs NO network I/O and commits NO transport
 * assumptions; every request resolves to a typed `endpoint-unavailable` error so
 * the UI surfaces an honest "unavailable" state rather than a silent success.
 */
export function createGatedChunkFetcher(): ChunkFetcher {
  return {
    async fetchChunk(): Promise<Result<RawPayload, RetrievalError>> {
      // BLOCKED §24: no live retrieval until the protocol capture confirms the
      // transport. The real adapter is injected in entrypoints/background.ts.
      return fail(retrievalError("endpoint-unavailable"));
    },
  };
}
