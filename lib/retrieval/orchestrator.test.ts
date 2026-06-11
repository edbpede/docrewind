// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../db.memory";
import { asDocId, asRevisionId } from "../domain/ids";
import type { DocId, RawPayload, RevisionSpan } from "../domain/model";
import type { RevisionRangeDiscovery } from "../protocol/discovery";
import { ok, type Result, type RetrievalError, retrievalError } from "./errors";
import {
  type CancellationToken,
  NEVER_CANCELLED,
  type OrchestratorDeps,
  type RetrievalRequest,
  runRetrieval,
} from "./orchestrator";
import type { ChunkFetcher, ChunkRequest } from "./transport";
import { createGatedChunkFetcher } from "./transport";

const DOC = asDocId("docTEST");

function payloadFor(docId: DocId, span: RevisionSpan): RawPayload {
  return { docId, range: { requested: span, received: span }, receivedAt: 0, body: {} };
}

interface FakeFetcher extends ChunkFetcher {
  readonly spans: RevisionSpan[];
}

function makeFetcher(
  handler: (req: ChunkRequest, call: number) => Result<RawPayload, RetrievalError>,
): FakeFetcher {
  const spans: RevisionSpan[] = [];
  let call = 0;
  return {
    spans,
    async fetchChunk(req: ChunkRequest): Promise<Result<RawPayload, RetrievalError>> {
      const result = handler(req, call);
      call += 1;
      spans.push(req.span);
      return result;
    },
  };
}

function successFetcher(): FakeFetcher {
  return makeFetcher((req) => ok(payloadFor(req.docId, req.span)));
}

function discovery(upperBound: number, throws = false): RevisionRangeDiscovery {
  return {
    strategy: "unconfirmed",
    async discoverUpperBound() {
      if (throws) throw new Error("discovery unavailable");
      return asRevisionId(upperBound);
    },
  };
}

function fakeSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

function request(cancellation: CancellationToken = NEVER_CANCELLED): RetrievalRequest {
  return { docId: DOC, userIndex: null, cancellation };
}

describe("runRetrieval — happy path", () => {
  test("fetches every chunk, persists raw + a completed checkpoint", async () => {
    const store = createMemoryStore();
    const fetcher = successFetcher();
    const deps: OrchestratorDeps = {
      fetcher,
      discovery: discovery(10),
      store,
      sleep: async () => {},
      now: () => 1,
      initialChunkSize: 2,
    };

    const result = await runRetrieval(deps, request());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.upperBound).toBe(asRevisionId(10));
      expect(result.value.resumed).toBe(false);
      expect(result.value.chunksFetched).toBeGreaterThan(0);
    }
    // Spans are contiguous and cover 1..10.
    expect(fetcher.spans[0]?.start).toBe(asRevisionId(1));
    expect(fetcher.spans[fetcher.spans.length - 1]?.end).toBe(asRevisionId(10));
    // Checkpoint is terminal.
    const cp = await store.readCheckpoint(DOC);
    expect(cp?.completed).toBe(true);
    // Raw chunks were persisted.
    expect((await store.getRawChunks(DOC)).length).toBe(fetcher.spans.length);
  });

  test("adaptive sizing grows the chunk after each clean fetch", async () => {
    const store = createMemoryStore();
    const fetcher = successFetcher();
    const deps: OrchestratorDeps = {
      fetcher,
      discovery: discovery(100),
      store,
      sleep: async () => {},
      now: () => 1,
      initialChunkSize: 2,
    };
    await runRetrieval(deps, request());
    // First span width 2, second width 4 (doubled).
    const w0 = (fetcher.spans[0]?.end ?? 0) - (fetcher.spans[0]?.start ?? 0) + 1;
    const w1 = (fetcher.spans[1]?.end ?? 0) - (fetcher.spans[1]?.start ?? 0) + 1;
    expect(w0).toBe(2);
    expect(w1).toBe(4);
  });
});

describe("runRetrieval — resumability (SW termination)", () => {
  test("a second run resumes from the checkpoint instead of restarting", async () => {
    const store = createMemoryStore();

    // Run 1: cancel after two chunks land (simulated SW kill).
    const fetcher1 = successFetcher();
    const cancelAfterTwo: CancellationToken = { isCancelled: () => fetcher1.spans.length >= 2 };
    const deps1: OrchestratorDeps = {
      fetcher: fetcher1,
      discovery: discovery(10),
      store,
      sleep: async () => {},
      now: () => 1,
      initialChunkSize: 2,
    };
    const r1 = await runRetrieval(deps1, request(cancelAfterTwo));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.category).toBe("cancellation");
    const mid = await store.readCheckpoint(DOC);
    expect(mid?.completed).toBe(false);

    // Run 2: a fresh orchestrator invocation over the SAME store.
    const fetcher2 = successFetcher();
    const deps2: OrchestratorDeps = {
      fetcher: fetcher2,
      discovery: discovery(10),
      store,
      sleep: async () => {},
      now: () => 1,
      initialChunkSize: 2,
    };
    const r2 = await runRetrieval(deps2, request());

    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.resumed).toBe(true);
    // It CONTINUED: the first requested span starts at the resume cursor, not 1.
    expect(fetcher2.spans[0]?.start).toBe(mid?.nextStart);
    expect(Number(fetcher2.spans[0]?.start)).toBeGreaterThan(1);
    expect((await store.readCheckpoint(DOC))?.completed).toBe(true);
  });

  test("a run over an already-completed checkpoint is a no-op success", async () => {
    const store = createMemoryStore();
    await store.writeCheckpoint({
      docId: DOC,
      upperBound: asRevisionId(10),
      nextStart: asRevisionId(11),
      completed: true,
      updatedAt: 0,
    });
    const fetcher = successFetcher();
    const deps: OrchestratorDeps = {
      fetcher,
      discovery: discovery(10),
      store,
      sleep: async () => {},
      now: () => 1,
    };
    const result = await runRetrieval(deps, request());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chunksFetched).toBe(0);
    expect(fetcher.spans).toHaveLength(0); // never fetched
  });
});

describe("runRetrieval — cancellation", () => {
  test("an already-cancelled token returns a cancellation error before fetching", async () => {
    const store = createMemoryStore();
    const fetcher = successFetcher();
    const cancelled: CancellationToken = { isCancelled: () => true };
    const deps: OrchestratorDeps = {
      fetcher,
      discovery: discovery(10),
      store,
      sleep: async () => {},
      now: () => 1,
    };
    const result = await runRetrieval(deps, request(cancelled));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("cancellation");
    expect(fetcher.spans).toHaveLength(0);
  });
});

describe("runRetrieval — error handling", () => {
  test("a non-recoverable error propagates without retry", async () => {
    const store = createMemoryStore();
    const fetcher = makeFetcher(() => ({ ok: false, error: retrievalError("unsupported-format") }));
    const { sleep, delays } = fakeSleep();
    const deps: OrchestratorDeps = {
      fetcher,
      discovery: discovery(10),
      store,
      sleep,
      now: () => 1,
    };
    const result = await runRetrieval(deps, request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("unsupported-format");
    expect(fetcher.spans).toHaveLength(1); // one attempt, no retry
    expect(delays).toHaveLength(0); // no backoff
  });

  test("a recoverable error is retried with exponential backoff, shrinking the chunk", async () => {
    const store = createMemoryStore();
    // Fail (network) on calls 0 and 1, succeed on call 2.
    const fetcher = makeFetcher((req, call) =>
      call < 2
        ? { ok: false, error: retrievalError("network-failure") }
        : ok(payloadFor(req.docId, req.span)),
    );
    const { sleep, delays } = fakeSleep();
    const deps: OrchestratorDeps = {
      fetcher,
      discovery: discovery(1000),
      store,
      sleep,
      now: () => 1,
      initialChunkSize: 100,
    };
    const result = await runRetrieval(deps, request());
    expect(result.ok).toBe(true);
    // Two backoff waits, doubling: 500 then 1000.
    expect(delays).toEqual([500, 1000]);
    // Size shrank 100 -> 50 -> 25 across the two failures; the successful fetch
    // used the 25-wide span.
    const span = fetcher.spans[2];
    expect((span?.end ?? 0) - (span?.start ?? 0) + 1).toBe(25);
  });

  test("the gated stub fetcher surfaces endpoint-unavailable (no silent success)", async () => {
    const store = createMemoryStore();
    const { sleep } = fakeSleep();
    const deps: OrchestratorDeps = {
      fetcher: createGatedChunkFetcher(),
      discovery: discovery(10),
      store,
      sleep,
      now: () => 1,
      maxRetriesPerChunk: 2,
    };
    const result = await runRetrieval(deps, request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("endpoint-unavailable");
  });

  test("a discovery failure maps to endpoint-unavailable", async () => {
    const store = createMemoryStore();
    const fetcher = successFetcher();
    const deps: OrchestratorDeps = {
      fetcher,
      discovery: discovery(10, true),
      store,
      sleep: async () => {},
      now: () => 1,
    };
    const result = await runRetrieval(deps, request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("endpoint-unavailable");
    expect(fetcher.spans).toHaveLength(0);
  });
});
