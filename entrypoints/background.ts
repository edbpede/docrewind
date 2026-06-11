// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Background service worker (plan §1.5 / PRD §10.9). Owns retrieval wiring: it
// registers the typed messaging listeners and instantiates the resumable
// orchestrator with the idb checkpoint store. Per the WXT background contract,
// ALL browser.*/fetch usage stays inside `defineBackground` — never at module
// top level (top-level runs in WXT's Node build context and throws).
//
// ─────────────────────────────────────────────────────────────────────────────
// LIVE retrieval activation site. The §24 transport capture landed 2026-06-12
// and NO stop-condition fired (no protobuf, no `batchexecute` wrapper, no
// page-derived read token, no endpoint restriction — see docs/protocol-capture.md).
// The two pure gated stubs have been replaced HERE with the live `ChunkFetcher`
// (`fetch(url, { credentials: "include" })` + `buildRevisionsLoadUrl`) and the
// confirmed revision-count discovery. The orchestrator and all of lib/retrieval
// are UNCHANGED — the swap is localized to this one file, exactly as the seam
// intended (the purity guard forbids `fetch(` inside lib/retrieval by design).
//
// Confirmed transport facts (also encoded as typed constants in
// lib/protocol/types.ts / discovery.ts):
//   • Framing: `)]}'`-guarded JSON; top-level object `{ chunkedSnapshot, changelog }`.
//   • Read needs ONLY the first-party session cookie — no custom header, no token.
//   • Out-of-range `end` ⇒ HTTP 400 (was 500 in 2014); in-range ⇒ 200.
//   • The current revision count is published in the editor bootstrap as `"revision":N`.
// ─────────────────────────────────────────────────────────────────────────────

import { createIdbStore } from "@/lib/db";
import { asRevisionId } from "@/lib/domain/ids";
import type { DocId, RawPayload, RevisionId } from "@/lib/domain/model";
import { onMessage } from "@/lib/messaging";
import type { RevisionRangeDiscovery } from "@/lib/protocol/discovery";
import { buildRevisionsLoadUrl } from "@/lib/protocol/endpoints";
import { fail, ok, type Result, type RetrievalError, retrievalError } from "@/lib/retrieval/errors";
import { type CancellationToken, runRetrieval } from "@/lib/retrieval/orchestrator";
import type { ChunkFetcher, ChunkRequest } from "@/lib/retrieval/transport";

export default defineBackground(() => {
  const store = createIdbStore();

  // Per-document cancellation flags for in-flight retrievals.
  const cancelledDocs = new Set<string>();
  // Per-document run epoch. A fresh `startRetrieval` bumps the epoch, so any
  // still-pending earlier run for the same docId sees `isCancelled() === true`
  // and stops — preventing two concurrent runs from racing the IDB store when
  // MV3 dispatches overlapping messages (handlers are not serialized).
  const runEpochByDoc = new Map<string, number>();

  // ── LIVE §24 transport adapters ──────────────────────────────────────────
  const DOCS_ORIGIN = "https://docs.google.com";
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // The editor bootstrap URL, multi-account `/u/{N}/`-aware (A.5). Discovery
  // reads the published `"revision":N` count from this page.
  const buildEditUrl = (docId: DocId, userIndex: number | null): string => {
    const userSegment = userIndex !== null ? `/u/${userIndex}` : "";
    return `${DOCS_ORIGIN}${userSegment}/document/d/${docId}/edit`;
  };

  // Map an HTTP status to the typed error taxonomy. Recoverable categories let
  // the orchestrator back off + shrink the chunk before retrying — so a soft
  // rate limit (429) or a too-large-range 400 self-heals (A.9), while an auth
  // failure surfaces immediately.
  const classifyStatus = (status: number): RetrievalError => {
    if (status === 401 || status === 403) return retrievalError("insufficient-permission");
    if (status === 429 || status === 400 || status >= 500) return retrievalError("network-failure");
    return retrievalError("endpoint-unavailable");
  };

  // Live chunk fetcher: one credentialed `revisions/load` GET per span. Cookies
  // attach via `credentials: "include"` given the `*://docs.google.com/*` host
  // permission; no custom header / read token is required (§24 Q3/Q4). The raw
  // `)]}'`-framed text is stored opaque as `body` for the worker to parse/decode
  // — this adapter commits NO wire-format assumption beyond the URL shape.
  const liveFetcher: ChunkFetcher = {
    async fetchChunk(request: ChunkRequest): Promise<Result<RawPayload, RetrievalError>> {
      const url = buildRevisionsLoadUrl({
        docId: request.docId,
        start: request.span.start,
        end: request.span.end,
        userIndex: request.userIndex,
      });
      let response: Response;
      try {
        response = await fetch(url, { credentials: "include" });
      } catch {
        return fail(retrievalError("network-failure"));
      }
      if (!response.ok) {
        return fail(classifyStatus(response.status));
      }
      let body: string;
      try {
        body = await response.text();
      } catch {
        return fail(retrievalError("network-failure"));
      }
      // The endpoint returns exactly the requested inclusive span, so
      // received === requested; the orchestrator re-validates this against the
      // upper bound and advances its resume cursor from `received.end`.
      return ok({
        docId: request.docId,
        range: { requested: request.span, received: request.span },
        receivedAt: Date.now(),
        body,
      });
    },
  };

  // Probe whether revision `end` is in range: 200 ⇒ in-range, any 4xx (the 2026
  // out-of-range signal is HTTP 400, §24 Q5) ⇒ over. Throws on a transport error
  // so discovery can surface it rather than mis-bound the range.
  const probeInRange = async (
    docId: DocId,
    userIndex: number | null,
    end: number,
  ): Promise<"in" | "over"> => {
    const url = buildRevisionsLoadUrl({
      docId,
      start: asRevisionId(1),
      end: asRevisionId(end),
      userIndex,
    });
    const response = await fetch(url, { credentials: "include" });
    if (response.ok) return "in";
    if (response.status >= 400 && response.status < 500) return "over";
    throw new Error(`revisions/load probe failed (${response.status})`);
  };

  // Revision-range discovery (§24 Q5). Primary: read the published `"revision":N`
  // count from the editor bootstrap — a single request, the gentlest path (A.9).
  // Fallback: exponential-bracket + binary-search the in-range(200)/over(400)
  // boundary if the bootstrap shape ever changes. Both are encapsulated here so
  // the orchestrator stays strategy-agnostic (it consumes `discoverUpperBound`
  // only). `userIndex` is captured per request for the multi-account path.
  const createLiveDiscovery = (userIndex: number | null): RevisionRangeDiscovery => ({
    strategy: "revision-count-metadata",
    async discoverUpperBound(docId: DocId): Promise<RevisionId> {
      // Primary: bootstrap metadata.
      try {
        const response = await fetch(buildEditUrl(docId, userIndex), { credentials: "include" });
        if (response.ok) {
          const html = await response.text();
          const match = html.match(/"revision":(\d+)/);
          const count = match ? Number(match[1]) : Number.NaN;
          if (Number.isInteger(count) && count >= 1) {
            return asRevisionId(count);
          }
        }
      } catch {
        // fall through to the binary-search fallback
      }

      // Fallback: confirm revision 1 is in range, then bracket + binary-search.
      if ((await probeInRange(docId, userIndex, 1)) === "over") {
        throw new Error("no revisions in range");
      }
      let lo = 1; // always in range
      let hi = 2;
      for (let guard = 0; guard < 40; guard += 1) {
        await pause(200); // gentle spacing — undocumented soft limits (A.9)
        if ((await probeInRange(docId, userIndex, hi)) === "over") break;
        lo = hi;
        hi *= 2;
      }
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        await pause(200);
        if ((await probeInRange(docId, userIndex, mid)) === "in") lo = mid;
        else hi = mid;
      }
      return asRevisionId(lo);
    },
  });
  // ─────────────────────────────────────────────────────────────────────────

  onMessage("cancelRetrieval", ({ data }) => {
    cancelledDocs.add(data.docId);
    // Bump the epoch too: a later `startRetrieval` clears `cancelledDocs`, but
    // the in-flight run is pinned to its own epoch and still observes the bump.
    runEpochByDoc.set(data.docId, (runEpochByDoc.get(data.docId) ?? 0) + 1);
  });

  onMessage("startRetrieval", async ({ data }) => {
    cancelledDocs.delete(data.docId);
    // Claim a fresh epoch; any earlier run for this docId is now stale and will
    // self-cancel on its next `isCancelled()` check.
    const epoch = (runEpochByDoc.get(data.docId) ?? 0) + 1;
    runEpochByDoc.set(data.docId, epoch);
    const cancellation: CancellationToken = {
      isCancelled: () => cancelledDocs.has(data.docId) || runEpochByDoc.get(data.docId) !== epoch,
    };
    const result = await runRetrieval(
      {
        fetcher: liveFetcher,
        discovery: createLiveDiscovery(data.userIndex),
        store,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
      },
      { docId: data.docId, userIndex: data.userIndex, cancellation },
    );
    // Drop our epoch entry if still current (a newer start would have replaced
    // it), and clear any cancel flag this run consumed — keeps both maps bounded.
    if (runEpochByDoc.get(data.docId) === epoch) {
      runEpochByDoc.delete(data.docId);
      cancelledDocs.delete(data.docId);
    }
    // The error is content-free by construction — never log raw bodies (§13.7).
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  onMessage("getCheckpoint", ({ data }) => store.readCheckpoint(data.docId));
});
