// SPDX-License-Identifier: AGPL-3.0-or-later
//
// IndexedDB bulk store (plan §1.2 / PRD §10.6, §9.8). The `idb`-backed
// implementation of the pure `RevisionStore` contract. Bulk/queryable data lives
// here — NEVER in `storage.local` (settings only) and NEVER `localStorage`.
//
// Realm note (see lib/core/store.ts): a Web Worker opens its OWN connection to this
// same database; there is no shared handle across realms. Writes are partitioned
// by owner (background owns rawChunks/checkpoints; worker owns decoded/snapshots/
// timeline) to avoid transaction-ordering hazards.

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { PARSER_VERSION } from "@/lib/core/docs/decoder/version";
import type { DocumentKind } from "@/lib/core/domain/kind";
import type {
  CacheRecord,
  DecodedRevision,
  DocId,
  RawPayload,
  RevisionId,
  TimelineEvent,
} from "@/lib/core/domain/model";
import { SHEETS_PARSER_VERSION } from "@/lib/core/sheets/decoder/version";
import { SLIDES_PARSER_VERSION } from "@/lib/core/slides/decoder/version";
import type {
  ActiveReplayPublication,
  ReplayPublication,
  RetrievalCheckpoint,
  RevisionStore,
  StoredSnapshot,
  UsageEstimate,
} from "@/lib/core/store";
import { publicationKind, publicationVersion } from "@/lib/core/store";

const DB_NAME = "docrewind";
const DB_VERSION = 4;

/** A raw chunk row: the composite `[docId,start,end]` key fields + the payload. */
interface RawChunkRecord {
  readonly docId: DocId;
  readonly start: RevisionId;
  readonly end: RevisionId;
  readonly payload: RawPayload;
}

/** Derived-data rows carry the `parserVersion` they were produced under. */
interface DecodedRecord {
  readonly docId: DocId;
  readonly parserVersion: number;
  readonly revisions: readonly DecodedRevision[];
}
interface SnapshotsRecord {
  readonly docId: DocId;
  readonly parserVersion: number;
  readonly snapshots: readonly StoredSnapshot[];
}
interface TimelineRecord {
  readonly docId: DocId;
  readonly parserVersion: number;
  readonly events: readonly TimelineEvent[];
}
interface ReplayPublicationRecord {
  readonly docId: DocId;
  readonly publicationId: string;
  readonly publication: ReplayPublication;
}
interface ActiveReplayPublicationRecord extends ActiveReplayPublication {
  readonly docId: DocId;
}

interface DocRewindDB extends DBSchema {
  rawChunks: {
    key: [string, number, number];
    value: RawChunkRecord;
    indexes: { "by-doc": string };
  };
  decoded: { key: string; value: DecodedRecord; indexes: { "by-doc": string } };
  snapshots: { key: string; value: SnapshotsRecord; indexes: { "by-doc": string } };
  timeline: { key: string; value: TimelineRecord; indexes: { "by-doc": string } };
  replayPublications: {
    key: [string, string];
    value: ReplayPublicationRecord;
    indexes: { "by-doc": string };
  };
  activeReplayPublications: {
    key: string;
    value: ActiveReplayPublicationRecord;
  };
  cacheMeta: { key: string; value: CacheRecord; indexes: { "by-last-accessed": number } };
  checkpoints: { key: string; value: RetrievalCheckpoint };
}

function openDocRewindDb(name: string): Promise<IDBPDatabase<DocRewindDB>> {
  return openDB<DocRewindDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains("rawChunks")) {
        const rawChunks = db.createObjectStore("rawChunks", {
          keyPath: ["docId", "start", "end"],
        });
        rawChunks.createIndex("by-doc", "docId");
      }

      if (!db.objectStoreNames.contains("decoded")) {
        const decoded = db.createObjectStore("decoded", { keyPath: "docId" });
        decoded.createIndex("by-doc", "docId");
      }

      if (!db.objectStoreNames.contains("snapshots")) {
        const snapshots = db.createObjectStore("snapshots", { keyPath: "docId" });
        snapshots.createIndex("by-doc", "docId");
      }

      if (!db.objectStoreNames.contains("timeline")) {
        const timeline = db.createObjectStore("timeline", { keyPath: "docId" });
        timeline.createIndex("by-doc", "docId");
      }

      if (db.objectStoreNames.contains("replayPublications") && oldVersion < 3) {
        // v2 keyed replay publications only by docId. Recreate the store rather
        // than migrating those single-slot rows into authoritative replay truth.
        db.deleteObjectStore("replayPublications");
      }

      if (!db.objectStoreNames.contains("replayPublications")) {
        const replayPublications = db.createObjectStore("replayPublications", {
          keyPath: ["docId", "publicationId"],
        });
        replayPublications.createIndex("by-doc", "docId");
      }

      if (!db.objectStoreNames.contains("activeReplayPublications")) {
        db.createObjectStore("activeReplayPublications", { keyPath: "docId" });
      }

      if (!db.objectStoreNames.contains("cacheMeta")) {
        const cacheMeta = db.createObjectStore("cacheMeta", { keyPath: "docId" });
        cacheMeta.createIndex("by-last-accessed", "lastAccessedAt");
      }

      if (!db.objectStoreNames.contains("checkpoints")) {
        db.createObjectStore("checkpoints", { keyPath: "docId" });
      }
    },
  });
}

/** True for a `QuotaExceededError` DOMException; false for anything else. */
export function isQuotaExceededError(err: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "QuotaExceededError"
  );
}

/** Best-effort byte size of a raw chunk's opaque body (length only, never content). */
function estimatePayloadBytes(payload: RawPayload): number {
  try {
    const serialized = JSON.stringify(payload.body);
    return typeof serialized === "string" ? serialized.length : 0;
  } catch {
    return 0;
  }
}

/** Options for {@link createIdbStore}. `parserVersion` defaults to PARSER_VERSION. */
export interface IdbStoreOptions {
  /** DB name (override only for isolated tests). */
  readonly name?: string;
  /** Effective Docs decode-pipeline version for cache invalidation. */
  readonly parserVersion?: number;
  /** Effective Sheets decode-pipeline version (independent of Docs). */
  readonly sheetsParserVersion?: number;
  /** Effective Slides decode-pipeline version (independent of Docs). */
  readonly slidesParserVersion?: number;
}

/**
 * Construct an `idb`-backed {@link RevisionStore}. Multiple instances over the
 * same `name` share one underlying database (the realm-split model relies on
 * this). The connection is opened lazily on first use.
 */
export function createIdbStore(options: IdbStoreOptions = {}): RevisionStore {
  const name = options.name ?? DB_NAME;
  const parserVersion = options.parserVersion ?? PARSER_VERSION;
  const sheetsParserVersion = options.sheetsParserVersion ?? SHEETS_PARSER_VERSION;
  const slidesParserVersion = options.slidesParserVersion ?? SLIDES_PARSER_VERSION;
  // Select the version baseline a publication/pointer is gated by, per its kind.
  const baselineFor = (kind: DocumentKind): number => {
    if (kind === "sheet") return sheetsParserVersion;
    if (kind === "slides") return slidesParserVersion;
    return parserVersion;
  };
  let dbPromise: Promise<IDBPDatabase<DocRewindDB>> | undefined;
  let persistRequested = false;

  const db = (): Promise<IDBPDatabase<DocRewindDB>> => {
    dbPromise ??= openDocRewindDb(name);
    return dbPromise;
  };

  // Ask the agent for durable storage once, lazily (best-effort, never throws).
  async function ensurePersisted(): Promise<void> {
    if (persistRequested) return;
    persistRequested = true;
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.persist) {
        await navigator.storage.persist();
      }
    } catch {
      // persistence is advisory — ignore failures
    }
  }

  async function estimateUsage(): Promise<UsageEstimate> {
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
      }
    } catch {
      // fall through to the unknown estimate
    }
    return { usage: 0, quota: 0 };
  }

  async function saveRawChunk(chunk: RawPayload): Promise<void> {
    await ensurePersisted();
    const record: RawChunkRecord = {
      docId: chunk.docId,
      start: chunk.range.received.start,
      end: chunk.range.received.end,
      payload: chunk,
    };
    const d = await db();
    try {
      await d.put("rawChunks", record);
    } catch (err) {
      if (!isQuotaExceededError(err)) throw err;
      // Over quota: evict to ~80% of quota (raw chunks first), then retry once.
      const { quota, usage } = await estimateUsage();
      const target = quota > 0 ? Math.floor(quota * 0.8) : usage;
      await pruneLRU(target);
      await d.put("rawChunks", record);
    }
  }

  async function getRawChunks(docId: DocId): Promise<readonly RawPayload[]> {
    const d = await db();
    const records = await d.getAllFromIndex("rawChunks", "by-doc", docId);
    return records
      .slice()
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map((r) => r.payload);
  }

  async function estimateRawBytes(docId: DocId): Promise<number> {
    const d = await db();
    const records = await d.getAllFromIndex("rawChunks", "by-doc", docId);
    return records.reduce((total, record) => total + estimatePayloadBytes(record.payload), 0);
  }

  async function saveReplayPublication(
    docId: DocId,
    publication: ReplayPublication,
  ): Promise<void> {
    const d = await db();
    // Re-stamp the version that produced this publication, keyed by its kind, so a
    // sheet publication carries the Sheets version, a slides the Slides version,
    // and a doc the Docs version.
    const currentPublication: ReplayPublication =
      publication.kind === "sheet"
        ? { ...publication, sheetsParserVersion }
        : publication.kind === "slides"
          ? { ...publication, slidesParserVersion }
          : { ...publication, parserVersion };
    await d.put("replayPublications", {
      docId,
      publicationId: currentPublication.publicationId,
      publication: currentPublication,
    });
  }

  async function getReplayPublication(
    docId: DocId,
    expectedPublicationId: string,
  ): Promise<ReplayPublication | null> {
    const d = await db();
    const rec = await d.get("replayPublications", [docId, expectedPublicationId]);
    if (
      rec === undefined ||
      publicationVersion(rec.publication) < baselineFor(publicationKind(rec.publication)) ||
      rec.publication.publicationId !== expectedPublicationId
    ) {
      return null;
    }
    return rec.publication;
  }

  async function setActiveReplayPublication(
    docId: DocId,
    publicationId: string,
    kind: DocumentKind = "doc",
  ): Promise<void> {
    const d = await db();
    await d.put("activeReplayPublications", {
      docId,
      publicationId,
      // Stamp the version baseline for this kind so the pointer is gated correctly.
      parserVersion: baselineFor(kind),
      activatedAt: Date.now(),
      kind,
    });
  }

  async function getActiveReplayPublication(docId: DocId): Promise<ReplayPublication | null> {
    const d = await db();
    const active = await d.get("activeReplayPublications", docId);
    // Select the version baseline by the POINTER's kind (legacy → "doc") BEFORE
    // comparing, so a sheet pointer is never compared against the Docs baseline.
    if (active === undefined || active.parserVersion < baselineFor(active.kind ?? "doc")) {
      return null;
    }
    return getReplayPublication(docId, active.publicationId);
  }

  async function deleteReplayPublication(docId: DocId, publicationId: string): Promise<void> {
    const d = await db();
    const tx = d.transaction(["replayPublications", "activeReplayPublications"], "readwrite");
    await tx.objectStore("replayPublications").delete([docId, publicationId]);
    const active = await tx.objectStore("activeReplayPublications").get(docId);
    if (active?.publicationId === publicationId) {
      await tx.objectStore("activeReplayPublications").delete(docId);
    }
    await tx.done;
  }

  async function saveDecoded(docId: DocId, revisions: readonly DecodedRevision[]): Promise<void> {
    const d = await db();
    await d.put("decoded", { docId, parserVersion, revisions });
  }

  async function getDecoded(docId: DocId): Promise<readonly DecodedRevision[]> {
    const d = await db();
    const rec = await d.get("decoded", docId);
    // Logical cache invalidation: a record decoded under an older parser version
    // is stale — treat it as absent (raw is retained for re-decode).
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return rec.revisions;
  }

  async function saveSnapshots(docId: DocId, snapshots: readonly StoredSnapshot[]): Promise<void> {
    const d = await db();
    await d.put("snapshots", { docId, parserVersion, snapshots });
  }

  async function getSnapshots(docId: DocId): Promise<readonly StoredSnapshot[]> {
    const d = await db();
    const rec = await d.get("snapshots", docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return rec.snapshots;
  }

  async function saveTimeline(docId: DocId, events: readonly TimelineEvent[]): Promise<void> {
    const d = await db();
    await d.put("timeline", { docId, parserVersion, events });
  }

  async function getTimeline(docId: DocId): Promise<readonly TimelineEvent[]> {
    const d = await db();
    const rec = await d.get("timeline", docId);
    if (rec === undefined || rec.parserVersion < parserVersion) return [];
    return rec.events;
  }

  async function getCacheMeta(docId: DocId): Promise<CacheRecord | null> {
    const d = await db();
    return (await d.get("cacheMeta", docId)) ?? null;
  }

  async function putCacheMeta(record: CacheRecord): Promise<void> {
    const d = await db();
    await d.put("cacheMeta", record);
  }

  async function touch(docId: DocId, now: number): Promise<void> {
    const d = await db();
    const meta = await d.get("cacheMeta", docId);
    if (meta === undefined) return;
    await d.put("cacheMeta", { ...meta, lastAccessedAt: now });
  }

  async function readCheckpoint(docId: DocId): Promise<RetrievalCheckpoint | null> {
    const d = await db();
    return (await d.get("checkpoints", docId)) ?? null;
  }

  async function writeCheckpoint(checkpoint: RetrievalCheckpoint): Promise<void> {
    const d = await db();
    await d.put("checkpoints", checkpoint);
  }

  async function deleteCheckpoint(docId: DocId): Promise<void> {
    const d = await db();
    await d.delete("checkpoints", docId);
  }

  async function deleteRawForDoc(docId: DocId): Promise<number> {
    const d = await db();
    const tx = d.transaction(["rawChunks", "cacheMeta", "checkpoints"], "readwrite");
    const raw = tx.objectStore("rawChunks");
    const metaStore = tx.objectStore("cacheMeta");
    const checkpointStore = tx.objectStore("checkpoints");
    const records = await raw.index("by-doc").getAll(docId);
    let reclaimed = 0;
    for (const r of records) {
      reclaimed += estimatePayloadBytes(r.payload);
      await raw.delete([r.docId, r.start, r.end]);
    }
    const meta = await metaStore.get(docId);
    if (meta !== undefined) {
      await metaStore.put({ ...meta, estimatedBytes: 0, rawRetained: false });
    }
    await checkpointStore.delete(docId);
    await tx.done;
    return reclaimed;
  }

  async function deleteRawAll(): Promise<number> {
    const d = await db();
    const records = await d.getAll("rawChunks");
    const reclaimed = records.reduce(
      (total, record) => total + estimatePayloadBytes(record.payload),
      0,
    );
    const tx = d.transaction(["rawChunks", "cacheMeta", "checkpoints"], "readwrite");
    const raw = tx.objectStore("rawChunks");
    const metaStore = tx.objectStore("cacheMeta");
    await raw.clear();
    const metas = await metaStore.getAll();
    await Promise.all(
      metas.map((meta) => metaStore.put({ ...meta, estimatedBytes: 0, rawRetained: false })),
    );
    await tx.objectStore("checkpoints").clear();
    await tx.done;
    return reclaimed;
  }

  async function hasCompleteActivePublication(docId: DocId): Promise<boolean> {
    const d = await db();
    const meta = await d.get("cacheMeta", docId);
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
    const d = await db();
    const rawDocs = (await d.getAll("rawChunks")).map((record) => record.docId);
    const metaDocs = (await d.getAll("cacheMeta")).map((record) => record.docId);
    const docs = new Set<DocId>([...rawDocs, ...metaDocs]);
    let reclaimed = 0;
    for (const docId of docs) {
      reclaimed += await pruneRawToCap(docId, capBytes);
    }
    return reclaimed;
  }

  async function pruneLRU(targetBytes: number): Promise<number> {
    const d = await db();
    // Least-recently-accessed documents first (ascending lastAccessedAt).
    const docsByAge = await d.getAllFromIndex("cacheMeta", "by-last-accessed");
    let usage = (await estimateUsage()).usage;
    let reclaimed = 0;
    for (const meta of docsByAge) {
      if (usage <= targetBytes) break;
      if (meta.reconstructionStatus !== "complete") continue;
      if ((await getActiveReplayPublication(meta.docId)) === null) continue;
      // Drop RAW chunks first (re-fetchable); preserve decoded/snapshots/timeline.
      const freed = await deleteRawForDoc(meta.docId);
      if (freed > 0) {
        reclaimed += freed;
        usage -= freed;
      }
    }
    return reclaimed;
  }

  async function deleteDocument(docId: DocId): Promise<void> {
    const d = await db();
    await deleteRawForDoc(docId);
    const tx = d.transaction(
      [
        "decoded",
        "snapshots",
        "timeline",
        "replayPublications",
        "activeReplayPublications",
        "cacheMeta",
        "checkpoints",
      ],
      "readwrite",
    );
    const publicationStore = tx.objectStore("replayPublications");
    const publicationKeys = await publicationStore.index("by-doc").getAllKeys(docId);
    await Promise.all([
      tx.objectStore("decoded").delete(docId),
      tx.objectStore("snapshots").delete(docId),
      tx.objectStore("timeline").delete(docId),
      ...publicationKeys.map((key) => publicationStore.delete(key as [string, string])),
      tx.objectStore("activeReplayPublications").delete(docId),
      tx.objectStore("cacheMeta").delete(docId),
      tx.objectStore("checkpoints").delete(docId),
    ]);
    await tx.done;
  }

  async function deleteAll(): Promise<void> {
    const d = await db();
    const tx = d.transaction(
      [
        "rawChunks",
        "decoded",
        "snapshots",
        "timeline",
        "replayPublications",
        "activeReplayPublications",
        "cacheMeta",
        "checkpoints",
      ],
      "readwrite",
    );
    await Promise.all([
      tx.objectStore("rawChunks").clear(),
      tx.objectStore("decoded").clear(),
      tx.objectStore("snapshots").clear(),
      tx.objectStore("timeline").clear(),
      tx.objectStore("replayPublications").clear(),
      tx.objectStore("activeReplayPublications").clear(),
      tx.objectStore("cacheMeta").clear(),
      tx.objectStore("checkpoints").clear(),
      tx.done,
    ]);
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
