// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed cross-context messaging (plan §1.3 / PRD §10.9). The content script
// triggers retrieval, the background owns the fetch, and the replay page reads
// progress — all over a single typed `ProtocolMap` via `@webext-core/messaging`
// (WXT's recommended wrapper). Payloads are typed end-to-end; no raw `any`.

import { defineExtensionMessaging } from "@webext-core/messaging";
import type { DocId } from "./domain/ids";
import type { DocumentKind } from "./domain/kind";
import type { CacheRecord } from "./domain/model";
import type { RetrievalError } from "./retrieval/errors";
import type { StorageBudget } from "./settings";
import type { RetrievalCheckpoint } from "./store";

/** Activate the replay surface for a detected document. */
export interface ActivateReplayMessage {
  readonly docId: DocId;
  readonly userIndex: number | null;
  /** Document kind (doc vs sheet); defaults to "doc" when omitted by a legacy sender. */
  readonly kind?: DocumentKind;
}

/** Begin (or resume) background retrieval for a document. */
export interface StartRetrievalMessage {
  readonly docId: DocId;
  readonly userIndex: number | null;
  /** Document kind selects the `/document/` vs `/spreadsheets/` transport prefix. */
  readonly kind?: DocumentKind;
}

/** Cancel an in-flight retrieval. */
export interface CancelRetrievalMessage {
  readonly docId: DocId;
}

/** Look up the persisted retrieval checkpoint for a document. */
export interface GetCheckpointMessage {
  readonly docId: DocId;
}

/** Mark raw chunks for a document as in use by retrieval/decode. */
export interface DecodeLeaseMessage {
  readonly docId: DocId;
}

/** Request raw-cache maintenance through the background lease guard. */
export interface RequestStorageMaintenanceMessage {
  /**
   * Durable retry id, when the sender persisted this request before sending.
   * Background handlers do not trust this for authorization; it is only an ack
   * correlation key for browser-local pending state.
   */
  readonly id?: string;
  /** `null` means apply generic/global options maintenance across all docs. */
  readonly docId: DocId | null;
  readonly keepRawData: boolean;
  readonly budget: StorageBudget;
  readonly reconstructionStatus?: CacheRecord["reconstructionStatus"];
  readonly now?: number;
  readonly queuedAt?: number;
}

/** Request a background-owned destructive clear for one document. */
export interface ClearDocumentCacheMessage {
  readonly id?: string;
  readonly docId: DocId;
  readonly kind?: "document";
  readonly queuedAt?: number;
}

/** Request a background-owned destructive clear for every document. */
export interface ClearAllCachesMessage {
  readonly id?: string;
  readonly kind?: "all";
  readonly queuedAt?: number;
}

export interface StorageMaintenanceAck {
  readonly status: "completed" | "deferred" | "failed";
  readonly reclaimedBytes: number;
}

/** Synchronous-ish acknowledgement returned by `startRetrieval`. */
export type RetrievalAck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RetrievalError };

/** Coarse retrieval lifecycle phase for progress broadcasts. */
export type RetrievalPhase = "discovering" | "fetching" | "decoding" | "done" | "error";

/**
 * A progress broadcast. Content-free by construction (counts + a classified
 * error only) — never carries raw bodies or document fragments (PRD §13.7).
 */
export interface RetrievalProgress {
  readonly docId: DocId;
  readonly phase: RetrievalPhase;
  readonly chunksFetched: number;
  readonly upperBound: number | null;
  readonly error: RetrievalError | null;
}

/** The typed message contract shared across all extension contexts. */
export interface ProtocolMap {
  activateReplay(data: ActivateReplayMessage): void;
  startRetrieval(data: StartRetrievalMessage): RetrievalAck;
  cancelRetrieval(data: CancelRetrievalMessage): void;
  retrievalProgress(data: RetrievalProgress): void;
  getCheckpoint(data: GetCheckpointMessage): RetrievalCheckpoint | null;
  beginDecodeLease(data: DecodeLeaseMessage): void;
  refreshDecodeLease(data: DecodeLeaseMessage): void;
  endDecodeLease(data: DecodeLeaseMessage): StorageMaintenanceAck;
  requestStorageMaintenance(data: RequestStorageMaintenanceMessage): StorageMaintenanceAck;
  clearDocumentCache(data: ClearDocumentCacheMessage): StorageMaintenanceAck;
  clearAllCaches(data: ClearAllCachesMessage): StorageMaintenanceAck;
}

export const { sendMessage, onMessage, removeAllListeners } =
  defineExtensionMessaging<ProtocolMap>();
