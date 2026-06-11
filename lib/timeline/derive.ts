// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Timeline derivation (plan T5 / PRD §9.5). Groups low-level decoded revisions
// into sessions (by session_id + temporal gaps), and detects large insertions /
// deletions and pauses. Every inferred grouping carries a `confidence` (0..1)
// and a `provenance` string so the UI can mark derived data as inferred, not
// literal. Pure and deterministic — no clocks, no randomness.

import type { Operation } from "../decoder/types";
import type {
  DecodedRevision,
  LargeEditEvent,
  PauseEvent,
  SessionEvent,
  TimelineEvent,
} from "../domain/model";

/** A revision inserting/deleting at least this many chars is a large edit. */
export const DEFAULT_LARGE_EDIT_THRESHOLD = 50;
/** An inter-revision time gap above this (ms) is a pause. */
export const DEFAULT_PAUSE_MS = 5 * 60 * 1000;
/** A same-session gap above this (ms) still splits the session. */
export const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;

export interface DeriveOptions {
  readonly largeEditThreshold?: number;
  readonly pauseMs?: number;
  readonly sessionIdleMs?: number;
}

interface CharDelta {
  readonly inserted: number;
  readonly deleted: number;
}

/** Count inserted/deleted characters for one operation (recursing mlti). */
function operationDelta(op: Operation): CharDelta {
  switch (op.ty) {
    case "is":
    case "iss":
      return { inserted: [...op.s].length, deleted: 0 };
    case "ds":
      return { inserted: 0, deleted: op.ei - op.si + 1 };
    case "mlti": {
      let inserted = 0;
      let deleted = 0;
      for (const sub of op.mts) {
        const delta = operationDelta(sub);
        inserted += delta.inserted;
        deleted += delta.deleted;
      }
      return { inserted, deleted };
    }
    default:
      // Suggestion marks / opaque / unknown make no net accepted-text change.
      return { inserted: 0, deleted: 0 };
  }
}

/** Sum the character delta across a revision's operations. */
function revisionDelta(revision: DecodedRevision): CharDelta {
  let inserted = 0;
  let deleted = 0;
  for (const op of revision.operations) {
    const delta = operationDelta(op);
    inserted += delta.inserted;
    deleted += delta.deleted;
  }
  return { inserted, deleted };
}

function sameSession(prev: DecodedRevision, next: DecodedRevision, idleMs: number): boolean {
  // Explicit session ids that differ always split.
  if (prev.sessionId !== null && next.sessionId !== null && prev.sessionId !== next.sessionId) {
    return false;
  }
  // A large temporal gap splits even within the same/absent session id.
  if (prev.time !== null && next.time !== null) {
    return next.time - prev.time <= idleMs;
  }
  return true;
}

function makeSessionEvent(group: readonly DecodedRevision[]): SessionEvent | null {
  const first = group[0];
  const last = group[group.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  let charsInserted = 0;
  let charsDeleted = 0;
  for (const revision of group) {
    const delta = revisionDelta(revision);
    charsInserted += delta.inserted;
    charsDeleted += delta.deleted;
  }
  const groupedBySession = first.sessionId !== null;
  return {
    kind: "session",
    sessionId: first.sessionId,
    userId: first.userId,
    span: { start: first.revisionId, end: last.revisionId },
    charsInserted,
    charsDeleted,
    confidence: groupedBySession ? 0.9 : 0.5,
    provenance: groupedBySession
      ? "grouped by session_id"
      : "inferred from temporal gaps (no session_id)",
  };
}

function deriveSessions(revisions: readonly DecodedRevision[], idleMs: number): SessionEvent[] {
  const sessions: SessionEvent[] = [];
  let group: DecodedRevision[] = [];
  for (const revision of revisions) {
    const prev = group[group.length - 1];
    if (prev === undefined || sameSession(prev, revision, idleMs)) {
      group.push(revision);
    } else {
      const event = makeSessionEvent(group);
      if (event !== null) sessions.push(event);
      group = [revision];
    }
  }
  const last = makeSessionEvent(group);
  if (last !== null) sessions.push(last);
  return sessions;
}

function deriveLargeEdits(
  revisions: readonly DecodedRevision[],
  threshold: number,
): LargeEditEvent[] {
  const events: LargeEditEvent[] = [];
  for (const revision of revisions) {
    const { inserted, deleted } = revisionDelta(revision);
    if (inserted >= threshold) {
      events.push({
        kind: "large-insertion",
        atRevision: revision.revisionId,
        charDelta: inserted,
        confidence: 0.7,
        provenance: `inserted ${inserted} chars (>= ${threshold})`,
      });
    }
    if (deleted >= threshold) {
      events.push({
        kind: "large-deletion",
        atRevision: revision.revisionId,
        charDelta: -deleted,
        confidence: 0.7,
        provenance: `deleted ${deleted} chars (>= ${threshold})`,
      });
    }
  }
  return events;
}

function derivePauses(revisions: readonly DecodedRevision[], pauseMs: number): PauseEvent[] {
  const events: PauseEvent[] = [];
  for (let i = 1; i < revisions.length; i++) {
    const prev = revisions[i - 1];
    const cur = revisions[i];
    if (prev === undefined || cur === undefined) continue;
    if (prev.time === null || cur.time === null) continue;
    const durationMs = cur.time - prev.time;
    if (durationMs > pauseMs) {
      events.push({
        kind: "pause",
        afterRevision: prev.revisionId,
        beforeRevision: cur.revisionId,
        durationMs,
        confidence: 0.8,
        provenance: `inter-revision gap ${durationMs}ms (> ${pauseMs})`,
      });
    }
  }
  return events;
}

/**
 * Derive timeline events from decoded revisions: session groupings, large
 * insertions/deletions, and pauses. Deterministic given the same input.
 */
export function deriveTimeline(
  revisions: readonly DecodedRevision[],
  options: DeriveOptions = {},
): TimelineEvent[] {
  const largeEditThreshold = options.largeEditThreshold ?? DEFAULT_LARGE_EDIT_THRESHOLD;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;

  return [
    ...deriveSessions(revisions, sessionIdleMs),
    ...deriveLargeEdits(revisions, largeEditThreshold),
    ...derivePauses(revisions, pauseMs),
  ];
}
