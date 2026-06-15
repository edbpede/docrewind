// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay-page parse Worker shell (plan §1.7 / PRD §10.9). A THIN transport
// wrapper: it owns its OWN idb realm (a Worker is a separate module realm — no
// shared connection with the background), READS rawChunks, runs the PURE
// pipeline (lib/worker/pipeline.ts), and posts run-tagged derived data back to
// the replay page. The page owns derived writes after verifying the run tag, so
// stale worker results from a retried run cannot publish decoded/snapshot/
// timeline data.
//
// The replay page (Phase 5) instantiates this via
//   new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" })
// — WXT resolves the worker bundle by inspecting this constructor pattern.

import { createIdbStore } from "@/lib/db";
import { asDocId } from "@/lib/domain/ids";
import type { DecodedRevision, TimelineEvent } from "@/lib/domain/model";
import type { StoredSnapshot } from "@/lib/store";
import { runPipelineOverBodies } from "@/lib/worker/pipeline";

/** Request: decode + reconstruct the document with this id from its raw chunks. */
interface ParseRequest {
  readonly docId: string;
  readonly runId: number;
}

/** Run-tagged result posted back to the replay page for verified publication. */
type ParseResultMessage =
  | {
      readonly kind: "done";
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: number;
      readonly revisions: readonly DecodedRevision[];
      readonly snapshots: readonly StoredSnapshot[];
      readonly timeline: readonly TimelineEvent[];
    }
  | {
      readonly kind: "unsupported" | "empty" | "failed";
      readonly docId: string;
      readonly runId: number;
      readonly revisionCount: 0;
    };

// `self` is the dedicated worker global. We type a minimal local surface and
// cast to avoid pulling the `webworker` lib (which conflicts with `dom` in this
// shared tsconfig); the shell is intentionally tiny.
interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}
const scope = self as unknown as WorkerScope;

// The worker's own store connection (separate realm from background).
const store = createIdbStore();

/** Runtime guard: the worker boundary is untyped, so validate the shape. */
function isParseRequest(value: unknown): value is ParseRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { docId?: unknown }).docId === "string" &&
    Number.isInteger((value as { runId?: unknown }).runId)
  );
}

scope.addEventListener("message", (event: MessageEvent) => {
  const request: unknown = event.data;
  if (!isParseRequest(request)) {
    // Malformed message — no usable docId, so we cannot post a per-doc signal;
    // drop it rather than crash the worker with an unhandled rejection.
    return;
  }
  // Async rejections (invalid docId, store I/O) would otherwise be unhandled and
  // leave the page waiting forever; post a terminal signal instead.
  void handleParse(request).catch(() => {
    post({ kind: "failed", docId: request.docId, runId: request.runId, revisionCount: 0 });
  });
});

async function handleParse(request: ParseRequest): Promise<void> {
  const docId = asDocId(request.docId);
  const chunks = await store.getRawChunks(docId);
  if (chunks.length === 0) {
    post({ kind: "empty", docId: request.docId, runId: request.runId, revisionCount: 0 });
    return;
  }

  const result = runPipelineOverBodies(chunks.map((chunk) => chunk.body));
  if (result.kind === "unsupported") {
    // Unknown/parse-failed format — surface a content-free diagnostic signal.
    post({ kind: "unsupported", docId: request.docId, runId: request.runId, revisionCount: 0 });
    return;
  }

  const snapshots: StoredSnapshot[] = [...result.replayIndex.snapshots.entries()].map(
    ([appliedCount, model]) => ({ appliedCount, model }),
  );
  post({
    kind: "done",
    docId: request.docId,
    runId: request.runId,
    revisionCount: result.revisions.length,
    revisions: result.revisions,
    snapshots,
    timeline: result.timeline,
  });
}

function post(message: ParseResultMessage): void {
  // Phase 5 streams reconstructed frames using Transferable buffers; the Phase 4
  // shell posts only a small structured-clone completion signal.
  scope.postMessage(message);
}
