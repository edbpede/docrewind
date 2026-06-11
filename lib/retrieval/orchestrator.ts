// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Resumable retrieval orchestrator (plan §1.4 / PRD §10.6, §10.9). A PURE,
// browser-free chunk loop whose every dependency is INJECTED, so the full state
// machine (discover → loop → checkpoint → resume → cancel → backoff) is unit-
// tested with fakes and is live, exercised code — never dead scaffolding.
//
// Architect invariants honored here:
//   • Transport enters ONLY through the injected `ChunkFetcher`; `RawPayload.body`
//     is treated as opaque. No wire-format assumption reaches this control flow.
//   • Discovery is consumed ONLY via `discoverUpperBound(docId)`. This loop NEVER
//     branches on `DiscoveryStrategy` — the binary-search-vs-metadata choice (§24
//     Q5) lives inside the discovery implementation, so a Q5 surprise is an
//     adapter swap, not an orchestrator rewrite.
//   • State lives in the `CheckpointStore`, not in this function, so a terminated
//     service worker RESUMES by simply re-invoking `runRetrieval` with the same
//     store — there is no in-memory instance to reconstruct.

import { asRevisionId, unsafeAsRevisionId } from "../domain/ids";
import type { DocId, RevisionId } from "../domain/model";
import type { RevisionRangeDiscovery } from "../protocol/discovery";
import type { CheckpointStore } from "../store";
import {
  backoffDelay,
  DEFAULT_CHUNK_SIZE,
  growChunkSize,
  nextChunkSpan,
  shrinkChunkSize,
} from "./chunking";
import { fail, ok, type Result, type RetrievalError, retrievalError } from "./errors";
import type { ChunkFetcher } from "./transport";

/** Signals cooperative cancellation; checked between and within chunks. */
export interface CancellationToken {
  isCancelled(): boolean;
}

/** A token that never cancels (the default for fire-and-forget runs). */
export const NEVER_CANCELLED: CancellationToken = { isCancelled: () => false };

/** Injected dependencies for {@link runRetrieval}. */
export interface OrchestratorDeps {
  readonly fetcher: ChunkFetcher;
  readonly discovery: RevisionRangeDiscovery;
  readonly store: CheckpointStore;
  /** Wait helper (real `setTimeout` in the background; instant/fake in tests). */
  readonly sleep: (ms: number) => Promise<void>;
  /** Monotonic clock for checkpoint timestamps. */
  readonly now: () => number;
  readonly initialChunkSize?: number;
  readonly maxRetriesPerChunk?: number;
}

/** One retrieval request. */
export interface RetrievalRequest {
  readonly docId: DocId;
  readonly userIndex: number | null;
  readonly cancellation: CancellationToken;
}

/** Outcome of a completed retrieval run. */
export interface RetrievalSummary {
  readonly docId: DocId;
  readonly upperBound: RevisionId;
  readonly chunksFetched: number;
  readonly resumed: boolean;
}

const DEFAULT_MAX_RETRIES = 5;

/**
 * Run (or resume) a resumable, chunked retrieval. Returns a typed `Result`:
 * success with a summary, or a classified {@link RetrievalError}. Never throws
 * for an expected failure (cancellation, gated endpoint, discovery failure).
 */
export async function runRetrieval(
  deps: OrchestratorDeps,
  request: RetrievalRequest,
): Promise<Result<RetrievalSummary, RetrievalError>> {
  const { docId, cancellation } = request;
  const maxRetries = deps.maxRetriesPerChunk ?? DEFAULT_MAX_RETRIES;

  if (cancellation.isCancelled()) {
    return fail(retrievalError("cancellation"));
  }

  // Discover the upper bound (control flow is strategy-agnostic by design).
  let upperBound: RevisionId;
  try {
    upperBound = await deps.discovery.discoverUpperBound(docId);
  } catch {
    return fail(retrievalError("endpoint-unavailable"));
  }

  // Resume from a checkpoint if one exists and isn't already complete.
  const checkpoint = await deps.store.readCheckpoint(docId);
  const resumed = checkpoint !== null && !checkpoint.completed;
  if (checkpoint?.completed) {
    return ok({ docId, upperBound, chunksFetched: 0, resumed: false });
  }

  let nextStart: RevisionId =
    resumed && checkpoint !== null ? checkpoint.nextStart : asRevisionId(1);
  let size = deps.initialChunkSize ?? DEFAULT_CHUNK_SIZE;
  let chunksFetched = 0;

  while (nextStart <= upperBound) {
    if (cancellation.isCancelled()) {
      return fail(retrievalError("cancellation"));
    }

    let attempt = 0;
    // Retry loop for the chunk anchored at `nextStart`.
    for (;;) {
      if (cancellation.isCancelled()) {
        return fail(retrievalError("cancellation"));
      }
      const span = nextChunkSpan(nextStart, size, upperBound);
      if (span === null) break; // nextStart <= upperBound guarantees this is non-null
      const result = await deps.fetcher.fetchChunk({ docId, span, userIndex: request.userIndex });

      if (result.ok) {
        // Persist raw + advance the resume cursor past the requested span. The
        // payload body stays opaque; advancement is by the requested range, so a
        // discovery over/under-shoot can't stall the loop.
        await deps.store.saveRawChunk(result.value);
        chunksFetched += 1;
        nextStart = unsafeAsRevisionId(span.end + 1);
        await deps.store.writeCheckpoint({
          docId,
          upperBound,
          nextStart,
          completed: nextStart > upperBound,
          updatedAt: deps.now(),
        });
        size = growChunkSize(size); // adapt up after a clean fetch
        break;
      }

      // Failure: give up on a non-recoverable error or once retries are spent.
      if (!result.error.recoverable || attempt >= maxRetries) {
        return fail(result.error);
      }
      await deps.sleep(backoffDelay(attempt));
      size = shrinkChunkSize(size); // adapt down before retrying
      attempt += 1;
    }
  }

  // Idempotent terminal checkpoint (covers the resume-already-at-end edge).
  await deps.store.writeCheckpoint({
    docId,
    upperBound,
    nextStart,
    completed: true,
    updatedAt: deps.now(),
  });

  return ok({ docId, upperBound, chunksFetched, resumed });
}
