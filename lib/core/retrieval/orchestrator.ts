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

import { asRevisionId, unsafeAsRevisionId } from "@/lib/core/domain/ids";
import type { DocId, RevisionId } from "@/lib/core/domain/model";
import type { RevisionRangeDiscovery } from "@/lib/core/protocol/discovery";
import type { CheckpointStore } from "@/lib/core/store";
import {
  backoffDelay,
  DEFAULT_CHUNK_SIZE,
  growChunkSize,
  nextChunkSpan,
  shrinkChunkSize,
} from "./chunking";
import {
  fail,
  isRetrievalError,
  ok,
  type Result,
  type RetrievalError,
  retrievalError,
} from "./errors";
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
  } catch (caught) {
    // Discovery may throw a classified RetrievalError to surface a specific
    // category (e.g. an auth failure must reach the UI as `insufficient-
    // permission`, not be flattened to a recoverable `endpoint-unavailable`).
    // Any other throw is an opaque transport problem ⇒ endpoint-unavailable.
    return fail(isRetrievalError(caught) ? caught : retrievalError("endpoint-unavailable"));
  }

  // Resume from a checkpoint if one exists. The resume cursor is the first
  // revision not yet retrieved; absent a checkpoint we start at revision 1.
  const checkpoint = await deps.store.readCheckpoint(docId);
  const checkpointNextStart: RevisionId = checkpoint?.nextStart ?? asRevisionId(1);
  const resumed = checkpoint !== null && checkpointNextStart > asRevisionId(1);

  // Short-circuit a completed checkpoint ONLY when its cursor is already past
  // the freshly discovered upper bound. If the document grew since we finished
  // (upperBound now exceeds the stored cursor), fall through and fetch the new
  // revisions instead of falsely reporting a no-op success (silent data loss).
  if (checkpoint?.completed && checkpointNextStart > upperBound) {
    return ok({ docId, upperBound, chunksFetched: 0, resumed: false });
  }

  let nextStart: RevisionId = checkpointNextStart;
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

      if (cancellation.isCancelled()) {
        return fail(retrievalError("cancellation"));
      }

      if (result.ok) {
        // Persist raw + advance the resume cursor past the ACTUALLY-received
        // end, so a transport that narrows the range can't leave a silent gap
        // in `(received.end, requested.end]`. The payload body stays opaque.
        // Guard: `received.end` must lie in `[span.start, upperBound]`. The
        // lower bound guarantees strict forward progress (received.end + 1 >
        // span.start), so a server that fails to advance can't spin the loop;
        // an out-of-range end is unparseable range data we stop on safely.
        const receivedEnd = result.value.range.received.end;
        if (receivedEnd < span.start || receivedEnd > upperBound) {
          return fail(retrievalError("unsupported-format"));
        }
        await deps.store.saveRawChunk(result.value);
        if (cancellation.isCancelled()) {
          return fail(retrievalError("cancellation"));
        }
        chunksFetched += 1;
        nextStart = unsafeAsRevisionId(receivedEnd + 1);
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
