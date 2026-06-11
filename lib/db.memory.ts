// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-memory bulk store (plan §1.2 / PRD §10.2). A dependency-free twin of the
// `idb` backend that satisfies the SAME `RevisionStore` contract, used by the
// pure-core/orchestrator tests and as a swappable backend. Behavior mirrors
// lib/db.ts exactly (parser-version invalidation, LRU-drops-raw-first), so one
// shared contract suite proves both.

import { PARSER_VERSION } from "./decoder/version";
import type {
  CacheRecord,
  DecodedRevision,
  DocId,
  RawPayload,
  RevisionId,
  TimelineEvent,
} from "./domain/model";
import type { RetrievalCheckpoint, RevisionStore, StoredSnapshot, UsageEstimate } from "./store";

interface VersionedDecoded {
  readonly parserVersion: number;
  readonly revisions: readonly DecodedRevision[];
}
interface VersionedSnapshots {
  readonly parserVersion: number;
  readonly snapshots: readonly StoredSnapshot[];
}
interface VersionedTimeline {
  readonly parserVersion: number;
  readonly events: readonly TimelineEvent[];
}

/**
 * The mutable backing state shared across {@link createMemoryStore} instances.
 * Sharing one backend lets a test open a second store at a higher parser version
 * over the same data — exactly how a parser-version bump is simulated.
 */
export interface MemoryBackend {
  readonly rawChunks: Map<string, Map<string, RawPayload>>;
  readonly decoded: Map<string, VersionedDecoded>;
  readonly snapshots: Map<string, VersionedSnapshots>;
  readonly timeline: Map<string, VersionedTimeline>;
  readonly cacheMeta: Map<string, CacheRecord>;
  readonly checkpoints: Map<string, RetrievalCheckpoint>;
}

/** A fresh, empty backend. */
export function createMemoryBackend(): MemoryBackend {
  return {
    rawChunks: new Map(),
    decoded: new Map(),
    snapshots: new Map(),
    timeline: new Map(),
    cacheMeta: new Map(),
    checkpoints: new Map(),
  };
}

function rangeKey(start: RevisionId, end: RevisionId): string {
  return `${start}:${end}`;
}

function estimateRawBytes(payload: RawPayload): number {
  try {
    const serialized = JSON.stringify(payload.body);
    return typeof serialized === "string" ? serialized.length : 0;
  } catch {
    return 0;
  }
}

/** Options for {@link createMemoryStore}. */
export interface MemoryStoreOptions {
  readonly parserVersion?: number;
  /** Share an existing backend (e.g. to simulate a parser-version bump). */
  readonly backend?: MemoryBackend;
}

/** Construct an in-memory {@link RevisionStore} over a (possibly shared) backend. */
export function createMemoryStore(options: MemoryStoreOptions = {}): RevisionStore {
  const parserVersion = options.parserVersion ?? PARSER_VERSION;
  const backend = options.backend ?? createMemoryBackend();

  // An in-memory store is ephemeral, so there is nothing to persist; only
  // `estimateUsage` is mirrored from the idb backend (the LRU path reads it).
  async function estimateUsage(): Promise<UsageEstimate> {
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
      }
    } catch {
      // fall through
    }
    return { usage: 0, quota: 0 };
  }

  async function saveRawChunk(chunk: RawPayload): Promise<void> {
    const docKey = chunk.docId;
    const perDoc = backend.rawChunks.get(docKey) ?? new Map<string, RawPayload>();
    perDoc.set(rangeKey(chunk.range.received.start, chunk.range.received.end), chunk);
    backend.rawChunks.set(docKey, perDoc);
  }

  async function getRawChunks(docId: DocId): Promise<readonly RawPayload[]> {
    const perDoc = backend.rawChunks.get(docId);
    if (perDoc === undefined) return [];
    return [...perDoc.values()].sort(
      (a, b) =>
        a.range.received.start - b.range.received.start ||
        a.range.received.end - b.range.received.end,
    );
  }

  async function saveDecoded(docId: DocId, revisions: readonly DecodedRevision[]): Promise<void> {
    backend.decoded.set(docId, { parserVersion, revisions });
  }

  async function getDecoded(docId: DocId): Promise<readonly DecodedRevision[]> {
    const rec = backend.decoded.get(docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return rec.revisions;
  }

  async function saveSnapshots(docId: DocId, snapshots: readonly StoredSnapshot[]): Promise<void> {
    backend.snapshots.set(docId, { parserVersion, snapshots });
  }

  async function getSnapshots(docId: DocId): Promise<readonly StoredSnapshot[]> {
    const rec = backend.snapshots.get(docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return rec.snapshots;
  }

  async function saveTimeline(docId: DocId, events: readonly TimelineEvent[]): Promise<void> {
    backend.timeline.set(docId, { parserVersion, events });
  }

  async function getTimeline(docId: DocId): Promise<readonly TimelineEvent[]> {
    const rec = backend.timeline.get(docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return rec.events;
  }

  async function getCacheMeta(docId: DocId): Promise<CacheRecord | null> {
    return backend.cacheMeta.get(docId) ?? null;
  }

  async function putCacheMeta(record: CacheRecord): Promise<void> {
    backend.cacheMeta.set(record.docId, record);
  }

  async function touch(docId: DocId, now: number): Promise<void> {
    const meta = backend.cacheMeta.get(docId);
    if (meta === undefined) return;
    backend.cacheMeta.set(docId, { ...meta, lastAccessedAt: now });
  }

  async function readCheckpoint(docId: DocId): Promise<RetrievalCheckpoint | null> {
    return backend.checkpoints.get(docId) ?? null;
  }

  async function writeCheckpoint(checkpoint: RetrievalCheckpoint): Promise<void> {
    backend.checkpoints.set(checkpoint.docId, checkpoint);
  }

  function deleteRawForDoc(docId: DocId): number {
    const perDoc = backend.rawChunks.get(docId);
    if (perDoc === undefined) return 0;
    let reclaimed = 0;
    for (const payload of perDoc.values()) {
      reclaimed += estimateRawBytes(payload);
    }
    backend.rawChunks.delete(docId);
    return reclaimed;
  }

  async function pruneLRU(targetBytes: number): Promise<number> {
    // Least-recently-accessed documents first.
    const docsByAge = [...backend.cacheMeta.values()].sort(
      (a, b) => a.lastAccessedAt - b.lastAccessedAt,
    );
    let usage = (await estimateUsage()).usage;
    let reclaimed = 0;
    for (const meta of docsByAge) {
      if (usage <= targetBytes) break;
      const freed = deleteRawForDoc(meta.docId);
      if (freed > 0) {
        reclaimed += freed;
        usage -= freed;
        backend.cacheMeta.set(meta.docId, { ...meta, rawRetained: false });
      }
    }
    return reclaimed;
  }

  async function deleteDocument(docId: DocId): Promise<void> {
    backend.rawChunks.delete(docId);
    backend.decoded.delete(docId);
    backend.snapshots.delete(docId);
    backend.timeline.delete(docId);
    backend.cacheMeta.delete(docId);
    backend.checkpoints.delete(docId);
  }

  async function deleteAll(): Promise<void> {
    backend.rawChunks.clear();
    backend.decoded.clear();
    backend.snapshots.clear();
    backend.timeline.clear();
    backend.cacheMeta.clear();
    backend.checkpoints.clear();
  }

  return {
    saveRawChunk,
    getRawChunks,
    saveDecoded,
    getDecoded,
    saveSnapshots,
    getSnapshots,
    saveTimeline,
    getTimeline,
    getCacheMeta,
    putCacheMeta,
    touch,
    readCheckpoint,
    writeCheckpoint,
    estimateUsage,
    pruneLRU,
    deleteDocument,
    deleteAll,
  };
}
