// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed cross-context messaging (plan §1.3 / PRD §10.9). The content script
// triggers retrieval, the background owns the fetch, and the replay page reads
// progress — all over a single typed `ProtocolMap` via `@webext-core/messaging`
// (WXT's recommended wrapper). Payloads are typed end-to-end; no raw `any`.

import { defineExtensionMessaging } from "@webext-core/messaging";
import type { DocId } from "./domain/ids";
import type { RetrievalError } from "./retrieval/errors";
import type { RetrievalCheckpoint } from "./store";

/** Activate the replay surface for a detected document. */
export interface ActivateReplayMessage {
  readonly docId: DocId;
  readonly userIndex: number | null;
}

/** Begin (or resume) background retrieval for a document. */
export interface StartRetrievalMessage {
  readonly docId: DocId;
  readonly userIndex: number | null;
}

/** Cancel an in-flight retrieval. */
export interface CancelRetrievalMessage {
  readonly docId: DocId;
}

/** Look up the persisted retrieval checkpoint for a document. */
export interface GetCheckpointMessage {
  readonly docId: DocId;
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
}

export const { sendMessage, onMessage, removeAllListeners } =
  defineExtensionMessaging<ProtocolMap>();
