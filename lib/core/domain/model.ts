// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed domain model (plan T1 / PRD §10.5). Pure data shapes only: these
// modules import nothing from the extension runtime, and storage/cache types
// are plain data (no IDB handles), so the core stays unit-testable and storage
// stays swappable (PRD §10.2). `interface` for object shapes, `type` for unions.

import type { OpaqueStructure, Operation } from "@/lib/core/docs/decoder/types";
import type { DocId, RevisionId, SessionId, UserId } from "./ids";

// Re-export the operation grammar so consumers can treat the domain model as
// the single import surface for typed core shapes.
export type { OpaqueStructure, Operation } from "@/lib/core/docs/decoder/types";
export type { DocId, RevisionId, SessionId, UserId } from "./ids";

/** A revision-number span. `end` is inclusive. */
export interface RevisionSpan {
  readonly start: RevisionId;
  readonly end: RevisionId;
}

/**
 * Requested vs. received revision spans. They differ when discovery over-
 * or under-shoots the true upper bound (A.4), so both are retained.
 */
export interface RevisionRange {
  readonly requested: RevisionSpan;
  readonly received: RevisionSpan;
}

/** A captured document and the revision range we hold for it. */
export interface Document {
  readonly id: DocId;
  readonly title: string | null; // null when the title is unknown/unread
  readonly range: RevisionRange;
}

/**
 * A raw, already-framed-and-parsed changelog chunk as retrieved from the
 * endpoint, kept for re-decode when `keepRawData` is on (PRD §9.8). This is a
 * storage shape, not a diagnostic one; `body` is opaque to the pure core.
 */
export interface RawPayload {
  readonly docId: DocId;
  readonly range: RevisionRange;
  readonly receivedAt: number; // epoch ms
  readonly body: unknown;
}

/**
 * One decoded revision: its attribution/timing metadata plus the typed
 * operations it applied. Attribution fields are `| null` (always present on the
 * object; null when the wire omitted them) to satisfy
 * `exactOptionalPropertyTypes` without optional-ambiguity.
 */
export interface DecodedRevision {
  readonly revisionId: RevisionId;
  readonly userId: UserId | null;
  readonly sessionId: SessionId | null;
  readonly time: number | null; // epoch ms; null when absent
  readonly operations: readonly Operation[];
}

/** Reconstructed text of the document as of a given revision. */
export interface DocumentState {
  readonly atRevision: RevisionId;
  readonly text: string;
}

// --- Timeline (PRD §9.5) ----------------------------------------------------
// Inferred groupings carry `confidence` (0..1) and a `provenance` string
// describing the inference basis, so the UI can mark derived (vs. literal) data.

/** A run of revisions attributed to one editing session. */
export interface SessionEvent {
  readonly kind: "session";
  readonly sessionId: SessionId | null;
  readonly userId: UserId | null;
  readonly span: RevisionSpan;
  readonly charsInserted: number;
  readonly charsDeleted: number;
  readonly confidence: number;
  readonly provenance: string;
}

/** A single revision whose net character delta crosses the large-edit threshold. */
export interface LargeEditEvent {
  readonly kind: "large-insertion" | "large-deletion";
  readonly atRevision: RevisionId;
  readonly charDelta: number; // signed: positive insert, negative delete
  readonly confidence: number;
  readonly provenance: string;
}

/** A temporal gap between consecutive revisions exceeding the pause threshold. */
export interface PauseEvent {
  readonly kind: "pause";
  readonly afterRevision: RevisionId;
  readonly beforeRevision: RevisionId;
  readonly durationMs: number;
  readonly confidence: number;
  readonly provenance: string;
}

/** A derived timeline marker. */
export type TimelineEvent = SessionEvent | LargeEditEvent | PauseEvent;

/** Replay/playback UI state for a document. */
export interface PlaybackSession {
  readonly docId: DocId;
  readonly currentRevision: RevisionId;
  readonly playing: boolean;
  readonly speed: number; // playback multiplier (1 = realtime-ish)
}

/** Per-document cache metadata for LRU/versioning bookkeeping (PRD §10.6). */
export interface CacheRecord {
  readonly docId: DocId;
  readonly createdAt: number;
  readonly lastAccessedAt: number;
  readonly parserVersion: number;
  readonly estimatedBytes: number;
  readonly reconstructionStatus: "none" | "partial" | "complete";
  readonly rawRetained: boolean;
}

// --- Diagnostics (privacy-safe; R5, §10.8, §13.7) ---------------------------
// Diagnostics NEVER reference verbatim document text or fragments. Unknown ops
// surface only their op-code + byte length; structural notes emit length-only
// position tokens.

/** Summary of one unrecognized operation — op-code + byte length only. */
export interface UnknownOpSummary {
  readonly opCode: string;
  readonly byteLength: number;
  readonly revisionId: RevisionId;
}

/** A length-only note about a non-text structure encountered during decode. */
export interface StructuralDiagnostic {
  readonly structure: OpaqueStructure;
  readonly position: number;
  readonly revisionId: RevisionId;
}

/** A privacy-safe diagnostic report for one document's decode/reconstruct run. */
export interface DiagnosticReport {
  readonly docId: DocId;
  readonly generatedAt: number;
  readonly unknownOperations: readonly UnknownOpSummary[];
  readonly structural: readonly StructuralDiagnostic[];
}
