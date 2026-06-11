// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Background service worker (plan §1.5 / PRD §10.9). Owns retrieval wiring: it
// registers the typed messaging listeners and instantiates the resumable
// orchestrator with the idb checkpoint store. Per the WXT background contract,
// ALL browser.*/fetch usage stays inside `defineBackground` — never at module
// top level (top-level runs in WXT's Node build context and throws).
//
// ─────────────────────────────────────────────────────────────────────────────
// This file is the SINGLE `// BLOCKED §24` live-retrieval activation site. Today
// it injects the PURE gated stubs (no network I/O), so `startRetrieval` resolves
// to a typed `endpoint-unavailable` error — honest and surfaced in the UI, never
// a silent success. When the §24 capture lands and no stop-condition fires, the
// live `ChunkFetcher` (built from `fetch(url, { credentials: "include" })` +
// `buildRevisionsLoadUrl`) and the confirmed discovery mechanism replace the
// stubs HERE — a localized swap; the orchestrator and lib/retrieval do not change.
// ─────────────────────────────────────────────────────────────────────────────

import { createIdbStore } from "@/lib/db";
import type { RevisionId } from "@/lib/domain/model";
import { onMessage } from "@/lib/messaging";
import type { RevisionRangeDiscovery } from "@/lib/protocol/discovery";
import { type CancellationToken, runRetrieval } from "@/lib/retrieval/orchestrator";
import { createGatedChunkFetcher } from "@/lib/retrieval/transport";

export default defineBackground(() => {
  const store = createIdbStore();

  // Per-document cancellation flags for in-flight retrievals.
  const cancelledDocs = new Set<string>();

  // ── BLOCKED §24 — live-retrieval activation site ─────────────────────────
  // Replace these two pure stubs with the live `fetch` adapter +
  // `buildRevisionsLoadUrl` and the confirmed discovery mechanism once §24
  // lands and no stop-condition fires. Nothing else in retrieval changes.
  const fetcher = createGatedChunkFetcher();
  const discovery: RevisionRangeDiscovery = {
    strategy: "unconfirmed",
    discoverUpperBound(): Promise<RevisionId> {
      // BLOCKED §24: no confirmed discovery mechanism — surface a gated error
      // (the orchestrator maps a discovery failure to `endpoint-unavailable`).
      return Promise.reject(new Error("revision discovery unavailable (BLOCKED §24)"));
    },
  };
  // ─────────────────────────────────────────────────────────────────────────

  onMessage("cancelRetrieval", ({ data }) => {
    cancelledDocs.add(data.docId);
  });

  onMessage("startRetrieval", async ({ data }) => {
    cancelledDocs.delete(data.docId);
    const cancellation: CancellationToken = {
      isCancelled: () => cancelledDocs.has(data.docId),
    };
    const result = await runRetrieval(
      {
        fetcher,
        discovery,
        store,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        maxRetriesPerChunk: 0,
      },
      { docId: data.docId, userIndex: data.userIndex, cancellation },
    );
    // The error is content-free by construction — never log raw bodies (§13.7).
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  onMessage("getCheckpoint", ({ data }) => store.readCheckpoint(data.docId));
});
