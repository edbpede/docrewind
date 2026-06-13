// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bulk-store contract (plan §1.2 / PRD §10.2, §10.6). The PURE interface every
// persistence backend implements: the `idb` implementation (lib/db.ts) and the
// in-memory twin (lib/db.memory.ts) both satisfy `RevisionStore`, and the pure
// core + worker depend ONLY on this interface, so storage stays swappable.
//
// This module imports nothing from `idb`, `#imports`, `browser`, or `wxt` — it
// is data shapes + a method contract only. It consumes the existing typed domain
// model (RawPayload, DecodedRevision, CacheRecord, TimelineEvent) and the
// reconstruction working model (DocumentModel) for persisted snapshots.
//
// ── Worker DB-realm write-ownership split (Architect-required) ───────────────
// A Web Worker is a separate module realm with its OWN idb connection — there is
// no shared handle across realms. To avoid transaction-ordering hazards, writes
// are partitioned by owner and MUST stay partitioned:
//
//   • background / orchestrator  →  owns writes to `rawChunks` + `checkpoints`
//   • replay page                →  reads `rawChunks`, verifies the active run,
//                                    then owns writes to `decoded` / `snapshots`
//                                    / `timeline`
//
// `CheckpointStore` (below) is the orchestrator's write surface; replay decode
// uses the raw read + derived-write methods only after page-side run verification.
// Readers (the replay UI) may read anything.

import type {
  CacheRecord,
  DecodedRevision,
  DocId,
  RawPayload,
  RevisionId,
  TimelineEvent,
} from "./domain/model";
import type { DocumentModel } from "./reconstruction/model";

/**
 * One persisted reconstruction snapshot: the document model state after
 * `appliedCount` revisions have been applied (0 = empty document). Mirrors a
 * single entry of the reconstruction `ReplayIndex.snapshots` map so the replay
 * page can resume scrubbing without re-applying from scratch.
 */
export interface StoredSnapshot {
  readonly appliedCount: number;
  readonly model: DocumentModel;
}

/**
 * One atomic replay artifact for a decoded document. Replay rendering reads this
 * single record only; the legacy split decoded/snapshot/timeline stores remain
 * compatibility surfaces and are not authoritative for replay load.
 */
export interface ReplayPublication {
  /** Unique per replay attempt / document epoch; never a bare page-local run id. */
  readonly publicationId: string;
  /** Decode-pipeline version that produced this publication. */
  readonly parserVersion: number;
  readonly revisions: readonly DecodedRevision[];
  readonly snapshots: readonly StoredSnapshot[];
  readonly timeline: readonly TimelineEvent[];
  readonly publishedAt: number;
}

/**
 * Resumable-retrieval checkpoint (PRD §10.6). Persisted after each chunk so a
 * terminated service worker RESUMES rather than restarts. `nextStart` is the
 * resume cursor — the first revision not yet retrieved; retrieval is complete
 * once `completed` is true (equivalently, `nextStart` exceeds `upperBound`).
 */
export interface RetrievalCheckpoint {
  readonly docId: DocId;
  readonly upperBound: RevisionId;
  readonly nextStart: RevisionId;
  readonly completed: boolean;
  readonly updatedAt: number; // epoch ms
}

/** Coarse storage-usage figures (mirrors `navigator.storage.estimate()`). */
export interface UsageEstimate {
  readonly usage: number; // bytes in use (0 when unknown)
  readonly quota: number; // bytes available (0 when unknown)
}

/**
 * The full bulk-store contract. All methods are async (the `idb` backend is
 * promise-based); the in-memory twin resolves immediately. Getters return an
 * empty collection / `null` when nothing is stored — never throw on a miss.
 */
export interface RevisionStore {
  // --- Raw chunks (owner: background/orchestrator) -------------------------
  /** Persist one raw chunk, keyed by `[docId, received.start, received.end]`. */
  saveRawChunk(chunk: RawPayload): Promise<void>;
  /** All raw chunks held for a document, ascending by received range. */
  getRawChunks(docId: DocId): Promise<readonly RawPayload[]>;
  /**
   * Best-effort byte estimate for one document's retained raw chunks. Uses
   * lengths only; never exposes or logs raw content.
   */
  estimateRawBytes(docId: DocId): Promise<number>;
  /**
   * Remove only raw chunks for one document, preserving decoded/snapshots/
   * timeline/checkpoints. Returns best-effort reclaimed bytes.
   */
  deleteRawForDoc(docId: DocId): Promise<number>;
  /**
   * Remove only raw chunks for every document, preserving derived data and
   * checkpoints. Returns best-effort reclaimed bytes.
   */
  deleteRawAll(): Promise<number>;
  /**
   * Coarse per-document raw budget enforcement. If the retained raw bytes for
   * `docId` exceed `capBytes`, drops all raw for that document (derived data is
   * preserved) and returns reclaimed bytes.
   */
  pruneRawToCap(docId: DocId, capBytes: number): Promise<number>;
  /**
   * Apply the coarse per-document raw cap to every document known to the store.
   * Used by the generic Options page where no current docId is available.
   */
  pruneRawToCapAll(capBytes: number): Promise<number>;

  // --- Atomic replay publication (owner: replay page after active-run proof) -
  /** Persist one full replay artifact as a single publication record. */
  saveReplayPublication(docId: DocId, publication: ReplayPublication): Promise<void>;
  /**
   * Read the replay publication only when its unique attempt id matches. A miss,
   * stale parser version, or id mismatch returns null rather than falling back to
   * legacy split stores.
   */
  getReplayPublication(
    docId: DocId,
    expectedPublicationId: string,
  ): Promise<ReplayPublication | null>;

  // --- Legacy split decoded data (compatibility / explicit consumption only) -
  saveDecoded(docId: DocId, revisions: readonly DecodedRevision[]): Promise<void>;
  getDecoded(docId: DocId): Promise<readonly DecodedRevision[]>;
  saveSnapshots(docId: DocId, snapshots: readonly StoredSnapshot[]): Promise<void>;
  getSnapshots(docId: DocId): Promise<readonly StoredSnapshot[]>;
  saveTimeline(docId: DocId, events: readonly TimelineEvent[]): Promise<void>;
  getTimeline(docId: DocId): Promise<readonly TimelineEvent[]>;

  // --- Cache metadata / LRU bookkeeping -----------------------------------
  getCacheMeta(docId: DocId): Promise<CacheRecord | null>;
  putCacheMeta(record: CacheRecord): Promise<void>;
  /** Update a document's `lastAccessedAt` to `now` (no-op if absent). */
  touch(docId: DocId, now: number): Promise<void>;

  // --- Resumable-retrieval checkpoints (owner: background/orchestrator) ----
  readCheckpoint(docId: DocId): Promise<RetrievalCheckpoint | null>;
  writeCheckpoint(checkpoint: RetrievalCheckpoint): Promise<void>;

  // --- Maintenance --------------------------------------------------------
  /** Coarse usage/quota figures for the LRU/quota path. */
  estimateUsage(): Promise<UsageEstimate>;
  /**
   * Evict to stay under budget. Drops RAW chunks FIRST (re-fetchable), least-
   * recently-accessed document first, preserving decoded/snapshots/timeline
   * (PRD §9.8). Returns the number of bytes (best-effort) reclaimed.
   */
  pruneLRU(targetBytes: number): Promise<number>;
  /** Remove every store record for one document. */
  deleteDocument(docId: DocId): Promise<void>;
  /** Remove every record for every document (clear-all). */
  deleteAll(): Promise<void>;
}

/**
 * The orchestrator's narrow write surface (plan §1.4). It owns exactly the raw-
 * chunk + checkpoint writes per the realm-ownership split above, and reads the
 * checkpoint to resume — nothing else. Keeping it a `Pick` means the orchestrator
 * cannot accidentally write derived (worker-owned) stores.
 */
export type CheckpointStore = Pick<
  RevisionStore,
  "saveRawChunk" | "readCheckpoint" | "writeCheckpoint"
>;
