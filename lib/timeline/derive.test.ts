// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeOperations } from "../decoder/decode";
import type { LargeEditEvent, PauseEvent, SessionEvent } from "../domain/model";
import { deriveTimeline } from "./derive";

function decode(entries: ReadonlyArray<Record<string, unknown>>) {
  return decodeOperations({ changelog: entries });
}

describe("deriveTimeline — session grouping", () => {
  test("splits sessions on a changed session_id", () => {
    const events = deriveTimeline(
      decode([
        { ty: "is", s: "a", ibi: 1, revision_id: 1, session_id: "A", time: 1000 },
        { ty: "is", s: "b", ibi: 2, revision_id: 2, session_id: "A", time: 2000 },
        { ty: "is", s: "c", ibi: 3, revision_id: 3, session_id: "B", time: 3000 },
      ]),
    );
    const sessions = events.filter((e): e is SessionEvent => e.kind === "session");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.span).toEqual({ start: 1 as never, end: 2 as never });
    expect(sessions[0]?.charsInserted).toBe(2);
    expect(sessions[0]?.confidence).toBeGreaterThan(0);
    expect(sessions[0]?.provenance).toContain("session_id");
    expect(sessions[1]?.span).toEqual({ start: 3 as never, end: 3 as never });
  });

  test("splits a same-session run on a large temporal gap", () => {
    const events = deriveTimeline(
      decode([
        { ty: "is", s: "a", ibi: 1, revision_id: 1, session_id: "A", time: 0 },
        {
          ty: "is",
          s: "b",
          ibi: 2,
          revision_id: 2,
          session_id: "A",
          time: 60 * 60 * 1000, // 1h later, beyond the 30m idle default
        },
      ]),
    );
    const sessions = events.filter((e): e is SessionEvent => e.kind === "session");
    expect(sessions).toHaveLength(2);
  });
});

describe("deriveTimeline — large edit detection", () => {
  test("flags a large insertion", () => {
    const events = deriveTimeline(
      decode([{ ty: "is", s: "x".repeat(60), ibi: 1, revision_id: 1 }]),
    );
    const large = events.filter((e): e is LargeEditEvent => e.kind === "large-insertion");
    expect(large).toHaveLength(1);
    expect(large[0]?.charDelta).toBe(60);
  });

  test("flags a large deletion with a negative charDelta", () => {
    const events = deriveTimeline(
      decode([
        { ty: "is", s: "y".repeat(80), ibi: 1, revision_id: 1 },
        { ty: "ds", si: 1, ei: 70, revision_id: 2 },
      ]),
    );
    const deletions = events.filter((e): e is LargeEditEvent => e.kind === "large-deletion");
    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.charDelta).toBe(-70);
  });

  test("does not flag edits below the threshold", () => {
    const events = deriveTimeline(decode([{ ty: "is", s: "small", ibi: 1, revision_id: 1 }]), {
      largeEditThreshold: 50,
    });
    expect(events.some((e) => e.kind.startsWith("large"))).toBe(false);
  });
});

describe("deriveTimeline — pause detection", () => {
  test("emits a pause for an inter-revision gap beyond the threshold", () => {
    const events = deriveTimeline(
      decode([
        { ty: "is", s: "a", ibi: 1, revision_id: 1, time: 0 },
        { ty: "is", s: "b", ibi: 2, revision_id: 2, time: 10 * 60 * 1000 }, // 10m
      ]),
      { pauseMs: 5 * 60 * 1000, sessionIdleMs: 60 * 60 * 1000 },
    );
    const pauses = events.filter((e): e is PauseEvent => e.kind === "pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0]?.afterRevision).toBe(1 as never);
    expect(pauses[0]?.beforeRevision).toBe(2 as never);
    expect(pauses[0]?.durationMs).toBe(10 * 60 * 1000);
  });

  test("does not emit a pause when timing is absent", () => {
    const events = deriveTimeline(
      decode([
        { ty: "is", s: "a", ibi: 1, revision_id: 1 },
        { ty: "is", s: "b", ibi: 2, revision_id: 2 },
      ]),
    );
    expect(events.some((e) => e.kind === "pause")).toBe(false);
  });
});
