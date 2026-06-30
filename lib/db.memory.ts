// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-memory bulk store (plan §1.2 / PRD §10.2). A dependency-free twin of the
// `idb` backend that satisfies the SAME `RevisionStore` contract, used by the
// pure-core/orchestrator tests and as a swappable backend. Behavior mirrors
// lib/db.ts exactly (parser-version invalidation, LRU-drops-raw-first), so one
// shared contract suite proves both.

import { PARSER_VERSION } from "./decoder/version";
import type { DocumentKind } from "./domain/kind";
import type {
  CacheRecord,
  DecodedRevision,
  DocId,
  RawPayload,
  RevisionId,
  TimelineEvent,
} from "./domain/model";
import { SHEETS_PARSER_VERSION } from "./sheets-decoder/version";
import type {
  ActiveReplayPublication,
  ReplayPublication,
  RetrievalCheckpoint,
  RevisionStore,
  StoredSnapshot,
  UsageEstimate,
} from "./store";
import { publicationKind, publicationVersion } from "./store";

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
  readonly replayPublications: Map<string, ReplayPublication>;
  readonly activeReplayPublications: Map<string, ActiveReplayPublication>;
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
    replayPublications: new Map(),
    activeReplayPublications: new Map(),
    cacheMeta: new Map(),
    checkpoints: new Map(),
  };
}

function rangeKey(start: RevisionId, end: RevisionId): string {
  return `${start}:${end}`;
}

function publicationKey(docId: DocId, publicationId: string): string {
  return `${docId}\u0000${publicationId}`;
}

/**
 * Deep-copy a value crossing the backend boundary. The idb backend isolates
 * callers from stored state via IndexedDB's structured-clone algorithm; this
 * helper gives the in-memory twin the same value-level isolation so a mutation
 * after a `get` cannot reach back into the store (header parity with lib/db.ts).
 */
function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function estimatePayloadBytes(payload: RawPayload): number {
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
  /** Independent Sheets decode-pipeline version. */
  readonly sheetsParserVersion?: number;
  /** Share an existing backend (e.g. to simulate a parser-version bump). */
  readonly backend?: MemoryBackend;
}

/** Construct an in-memory {@link RevisionStore} over a (possibly shared) backend. */
export function createMemoryStore(options: MemoryStoreOptions = {}): RevisionStore {
  const parserVersion = options.parserVersion ?? PARSER_VERSION;
  const sheetsParserVersion = options.sheetsParserVersion ?? SHEETS_PARSER_VERSION;
  const baselineFor = (kind: DocumentKind): number =>
    kind === "sheet" ? sheetsParserVersion : parserVersion;
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
    perDoc.set(rangeKey(chunk.range.received.start, chunk.range.received.end), cloneValue(chunk));
    backend.rawChunks.set(docKey, perDoc);
  }

  async function getRawChunks(docId: DocId): Promise<readonly RawPayload[]> {
    const perDoc = backend.rawChunks.get(docId);
    if (perDoc === undefined) return [];
    return [...perDoc.values()]
      .sort(
        (a, b) =>
          a.range.received.start - b.range.received.start ||
          a.range.received.end - b.range.received.end,
      )
      .map(cloneValue);
  }

  async function estimateRawBytes(docId: DocId): Promise<number> {
    const perDoc = backend.rawChunks.get(docId);
    if (perDoc === undefined) return 0;
    let total = 0;
    for (const payload of perDoc.values()) {
      total += estimatePayloadBytes(payload);
    }
    return total;
  }

  async function saveReplayPublication(
    docId: DocId,
    publication: ReplayPublication,
  ): Promise<void> {
    const stamped: ReplayPublication =
      publication.kind === "sheet"
        ? { ...publication, sheetsParserVersion }
        : { ...publication, parserVersion };
    backend.replayPublications.set(
      publicationKey(docId, publication.publicationId),
      cloneValue(stamped),
    );
  }

  async function getReplayPublication(
    docId: DocId,
    expectedPublicationId: string,
  ): Promise<ReplayPublication | null> {
    const publication = backend.replayPublications.get(
      publicationKey(docId, expectedPublicationId),
    );
    if (
      publication === undefined ||
      publicationVersion(publication) < baselineFor(publicationKind(publication)) ||
      publication.publicationId !== expectedPublicationId
    ) {
      return null;
    }
    return cloneValue(publication);
  }

  async function setActiveReplayPublication(
    docId: DocId,
    publicationId: string,
    kind: DocumentKind = "doc",
  ): Promise<void> {
    backend.activeReplayPublications.set(docId, {
      publicationId,
      parserVersion: baselineFor(kind),
      activatedAt: Date.now(),
      kind,
    });
  }

  async function getActiveReplayPublication(docId: DocId): Promise<ReplayPublication | null> {
    const active = backend.activeReplayPublications.get(docId);
    if (active === undefined || active.parserVersion < baselineFor(active.kind ?? "doc")) {
      return null;
    }
    return getReplayPublication(docId, active.publicationId);
  }

  async function deleteReplayPublication(docId: DocId, publicationId: string): Promise<void> {
    backend.replayPublications.delete(publicationKey(docId, publicationId));
    if (backend.activeReplayPublications.get(docId)?.publicationId === publicationId) {
      backend.activeReplayPublications.delete(docId);
    }
  }

  async function saveDecoded(docId: DocId, revisions: readonly DecodedRevision[]): Promise<void> {
    backend.decoded.set(docId, { parserVersion, revisions: cloneValue(revisions) });
  }

  async function getDecoded(docId: DocId): Promise<readonly DecodedRevision[]> {
    const rec = backend.decoded.get(docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return cloneValue(rec.revisions);
  }

  async function saveSnapshots(docId: DocId, snapshots: readonly StoredSnapshot[]): Promise<void> {
    backend.snapshots.set(docId, { parserVersion, snapshots: cloneValue(snapshots) });
  }

  async function getSnapshots(docId: DocId): Promise<readonly StoredSnapshot[]> {
    const rec = backend.snapshots.get(docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return cloneValue(rec.snapshots);
  }

  async function saveTimeline(docId: DocId, events: readonly TimelineEvent[]): Promise<void> {
    backend.timeline.set(docId, { parserVersion, events: cloneValue(events) });
  }

  async function getTimeline(docId: DocId): Promise<readonly TimelineEvent[]> {
    const rec = backend.timeline.get(docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return cloneValue(rec.events);
  }

  async function getCacheMeta(docId: DocId): Promise<CacheRecord | null> {
    const meta = backend.cacheMeta.get(docId);
    return meta === undefined ? null : cloneValue(meta);
  }

  async function putCacheMeta(record: CacheRecord): Promise<void> {
    backend.cacheMeta.set(record.docId, cloneValue(record));
  }

  async function touch(docId: DocId, now: number): Promise<void> {
    const meta = backend.cacheMeta.get(docId);
    if (meta === undefined) return;
    backend.cacheMeta.set(docId, { ...meta, lastAccessedAt: now });
  }

  async function readCheckpoint(docId: DocId): Promise<RetrievalCheckpoint | null> {
    const checkpoint = backend.checkpoints.get(docId);
    return checkpoint === undefined ? null : cloneValue(checkpoint);
  }

  async function writeCheckpoint(checkpoint: RetrievalCheckpoint): Promise<void> {
    backend.checkpoints.set(checkpoint.docId, cloneValue(checkpoint));
  }

  async function deleteCheckpoint(docId: DocId): Promise<void> {
    backend.checkpoints.delete(docId);
  }

  async function deleteRawForDoc(docId: DocId): Promise<number> {
    const perDoc = backend.rawChunks.get(docId);
    let reclaimed = 0;
    if (perDoc !== undefined) {
      for (const payload of perDoc.values()) {
        reclaimed += estimatePayloadBytes(payload);
      }
      backend.rawChunks.delete(docId);
    }
    const meta = backend.cacheMeta.get(docId);
    if (meta !== undefined) {
      backend.cacheMeta.set(docId, { ...meta, estimatedBytes: 0, rawRetained: false });
    }
    backend.checkpoints.delete(docId);
    return reclaimed;
  }

  async function deleteRawAll(): Promise<number> {
    let reclaimed = 0;
    for (const perDoc of backend.rawChunks.values()) {
      for (const payload of perDoc.values()) {
        reclaimed += estimatePayloadBytes(payload);
      }
    }
    backend.rawChunks.clear();
    backend.checkpoints.clear();
    for (const meta of backend.cacheMeta.values()) {
      backend.cacheMeta.set(meta.docId, { ...meta, estimatedBytes: 0, rawRetained: false });
    }
    return reclaimed;
  }

  async function hasCompleteActivePublication(docId: DocId): Promise<boolean> {
    const meta = backend.cacheMeta.get(docId);
    return (
      meta?.reconstructionStatus === "complete" &&
      (await getActiveReplayPublication(docId)) !== null
    );
  }

  async function pruneRawToCap(docId: DocId, capBytes: number): Promise<number> {
    if (!(await hasCompleteActivePublication(docId))) {
      return 0;
    }
    const target = Math.max(0, Math.floor(capBytes));
    const retained = await estimateRawBytes(docId);
    return retained > target ? deleteRawForDoc(docId) : 0;
  }

  async function pruneRawToCapAll(capBytes: number): Promise<number> {
    const docs = new Set<DocId>([
      ...backend.rawChunks.keys(),
      ...backend.cacheMeta.keys(),
    ] as DocId[]);
    let reclaimed = 0;
    for (const docId of docs) {
      reclaimed += await pruneRawToCap(docId, capBytes);
    }
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
      if (meta.reconstructionStatus !== "complete") continue;
      if ((await getActiveReplayPublication(meta.docId)) === null) continue;
      const freed = await deleteRawForDoc(meta.docId);
      if (freed > 0) {
        reclaimed += freed;
        usage -= freed;
      }
    }
    return reclaimed;
  }

  async function deleteDocument(docId: DocId): Promise<void> {
    backend.rawChunks.delete(docId);
    backend.decoded.delete(docId);
    backend.snapshots.delete(docId);
    backend.timeline.delete(docId);
    const prefix = `${docId}\u0000`;
    for (const key of backend.replayPublications.keys()) {
      if (key.startsWith(prefix)) {
        backend.replayPublications.delete(key);
      }
    }
    backend.activeReplayPublications.delete(docId);
    backend.cacheMeta.delete(docId);
    backend.checkpoints.delete(docId);
  }

  async function deleteAll(): Promise<void> {
    backend.rawChunks.clear();
    backend.decoded.clear();
    backend.snapshots.clear();
    backend.timeline.clear();
    backend.replayPublications.clear();
    backend.activeReplayPublications.clear();
    backend.cacheMeta.clear();
    backend.checkpoints.clear();
  }

  return {
    saveRawChunk,
    getRawChunks,
    estimateRawBytes,
    deleteRawForDoc,
    deleteRawAll,
    pruneRawToCap,
    pruneRawToCapAll,
    saveReplayPublication,
    getReplayPublication,
    setActiveReplayPublication,
    getActiveReplayPublication,
    deleteReplayPublication,
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
    deleteCheckpoint,
    estimateUsage,
    pruneLRU,
    deleteDocument,
    deleteAll,
  };
}
