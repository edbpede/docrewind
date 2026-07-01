// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeOperations } from "@/lib/core/docs/decoder/decode";
import type { LargeEditEvent, PauseEvent, SessionEvent } from "@/lib/core/domain/model";
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

describe("deriveTimeline — cross-kind ordering", () => {
  test("returns session, large-edit and pause events in revision order, not event-type buckets", () => {
    // Mixed corpus producing all three kinds with interleaved revision anchors:
    //   rev 1 — large insertion (60 chars >= 50), session A starts here
    //   rev 2 — small edit, session A
    //   rev 3 — small edit, session B (session_id split → second session spans 3..3)
    // A 10m gap before rev 3 forces a pause anchored at rev 2 (afterRevision).
    //
    // Under the old bucket-concat the order would be
    //   [sessionA(1), sessionB(3), large(1), pause(2)]  → anchors [1, 3, 1, 2]
    // which is NOT non-decreasing. The current revision-ordered output must be.
    const events = deriveTimeline(
      decode([
        { ty: "is", s: "x".repeat(60), ibi: 1, revision_id: 1, session_id: "A", time: 0 },
        { ty: "is", s: "b", ibi: 61, revision_id: 2, session_id: "A", time: 1000 },
        {
          ty: "is",
          s: "c",
          ibi: 62,
          revision_id: 3,
          session_id: "B",
          time: 1000 + 10 * 60 * 1000, // 10m gap → pause beyond the 5m default
        },
      ]),
      { pauseMs: 5 * 60 * 1000, sessionIdleMs: 30 * 60 * 1000 },
    );

    // Sanity: all three event kinds were produced.
    expect(events.filter((e) => e.kind === "session")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "large-insertion")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "pause")).toHaveLength(1);

    const anchorOf = (e: (typeof events)[number]): number => {
      switch (e.kind) {
        case "session":
          return Number(e.span.start);
        case "large-insertion":
        case "large-deletion":
          return Number(e.atRevision);
        case "pause":
          return Number(e.afterRevision);
      }
    };

    const anchors = events.map(anchorOf);
    // Non-decreasing by revision anchor — would fail under bucket-concat ([1,3,1,2]).
    expect(anchors).toEqual([...anchors].sort((a, b) => a - b));

    // The earlier-anchored large insertion (rev 1) precedes the later session (rev 3).
    const largeIdx = events.findIndex((e) => e.kind === "large-insertion");
    const lateSessionIdx = events.findIndex(
      (e) => e.kind === "session" && Number(e.span.start) === 3,
    );
    expect(largeIdx).toBeLessThan(lateSessionIdx);
  });
});
