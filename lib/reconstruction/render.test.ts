// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit test for the pure segment renderer (plan Phase 5 §2/§3). The headline
// invariant: concatenating the `accepted-text` + `suggested-insert` segment text
// equals `currentText(model)` for every corpus fixture — `marked-for-deletion`
// runs render separately and are excluded from the visible text, exactly as
// `text.ts` excludes them. `segmentsAt` is SINGLE-ARG: no test passes an
// applied-count (or any `t`) into it.

import { describe, expect, test } from "bun:test";
import { decodeOperations, decodeSnapshot } from "../decoder/decode";
import { FIXTURES } from "../fixtures/corpus";
import { applyOperation, applyRevision } from "./apply";
import { BASE_REVISION, createModel, type DocumentModel } from "./model";
import { type Segment, segmentsAt } from "./render";
import { currentText } from "./text";

function reconstruct(changelog: ReadonlyArray<Record<string, unknown>>): DocumentModel {
  const model = createModel();
  for (const revision of decodeOperations({ changelog })) {
    applyRevision(model, revision);
  }
  return model;
}

function visibleText(segments: readonly Segment[]): string {
  let out = "";
  for (const seg of segments) {
    if (seg.kind === "accepted-text" || seg.kind === "suggested-insert") {
      out += seg.text;
    }
  }
  return out;
}

describe("segmentsAt visible-text invariant", () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.name}: accepted+suggested concat === currentText`, () => {
      const model = reconstruct(fixture.changelog);
      const segments = segmentsAt(model);
      expect(visibleText(segments)).toBe(currentText(model));
    });
  }
});

describe("segmentsAt segment kinds", () => {
  test("dss marks a range as marked-for-deletion (text excluded from visible)", () => {
    // "abcdef" with 'abc' suggestion-deleted -> visible "def".
    const model = reconstruct([
      { ty: "is", s: "abcdef", ibi: 1, revision_id: 1 },
      { ty: "dss", si: 1, ei: 3, revision_id: 2 },
    ]);
    const segments = segmentsAt(model);
    const deletion = segments.find((s) => s.kind === "marked-for-deletion");
    expect(deletion).toBeDefined();
    expect(deletion?.kind === "marked-for-deletion" ? deletion.text : "").toBe("abc");
    expect(visibleText(segments)).toBe("def");
  });

  test("iss renders as a suggested-insert segment and stays visible", () => {
    const model = reconstruct([
      { ty: "is", s: "ab", ibi: 1, revision_id: 1 },
      { ty: "iss", s: "X", ibi: 3, revision_id: 2 },
    ]);
    const segments = segmentsAt(model);
    const suggested = segments.find((s) => s.kind === "suggested-insert");
    expect(suggested?.kind === "suggested-insert" ? suggested.text : "").toBe("X");
    expect(visibleText(segments)).toBe(currentText(model));
  });

  test("opaque slots render as labeled placeholders, not text", () => {
    const model = reconstruct([
      { ty: "is", s: "AB", ibi: 1, revision_id: 1 },
      { ty: "opaque", structure: "image", position: 2, revision_id: 2 },
      { ty: "is", s: "C", ibi: 4, revision_id: 3 },
    ]);
    const segments = segmentsAt(model);
    const opaque = segments.find((s) => s.kind === "opaque-placeholder");
    expect(opaque).toBeDefined();
    if (opaque?.kind === "opaque-placeholder") {
      expect(opaque.structure).toBe("image");
      expect(opaque.label).toBe("Image");
    }
    // Opaque contributes no text; visible text is still the accepted run.
    expect(visibleText(segments)).toBe("ABC");
  });

  test("accepted-delete elements are tombstoned out (not rendered)", () => {
    // "Hello world" with 'Hello ' hard-deleted -> only "world" remains.
    const model = reconstruct([
      { ty: "is", s: "Hello world", ibi: 1, revision_id: 1 },
      { ty: "ds", si: 1, ei: 6, revision_id: 2 },
    ]);
    const segments = segmentsAt(model);
    expect(segments).toHaveLength(1);
    expect(visibleText(segments)).toBe("world");
    expect(segments.every((s) => s.kind !== "marked-for-deletion")).toBe(true);
  });

  test("consecutive same-kind chars coalesce into one run", () => {
    const model = reconstruct([{ ty: "is", s: "hello", ibi: 1, revision_id: 1 }]);
    const segments = segmentsAt(model);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("accepted-text");
    expect(segments[0]?.kind === "accepted-text" ? segments[0].fromRevision : -1).toBe(1);
    // A single-revision run opens and closes at the same revision.
    expect(segments[0]?.kind === "accepted-text" ? segments[0].toRevision : -1).toBe(1);
  });

  test("base/template content renders as accepted-text under the pre-history revision (0)", () => {
    // Seed 5 chars of base content (chunkedSnapshot) under revision 0, then a real edit.
    const model = createModel();
    for (const op of decodeSnapshot({
      chunkedSnapshot: [[{ ty: "is", s: "Base ", ibi: 1 }]],
      changelog: [],
    })) {
      applyOperation(model, op, BASE_REVISION);
    }
    for (const revision of decodeOperations({
      changelog: [{ ty: "is", s: "edit", ibi: 6, revision_id: 1 }],
    })) {
      applyRevision(model, revision);
    }
    const segments = segmentsAt(model);
    // Base (rev 0) and the rev-1 edit are both accepted, so they coalesce into one
    // run opened by base content (fromRevision 0) and extended by the edit (toRevision 1).
    expect(segments).toHaveLength(1);
    const run = segments[0];
    expect(run?.kind).toBe("accepted-text");
    if (run?.kind !== "accepted-text") return;
    expect(run.text).toBe("Base edit");
    expect(run.fromRevision).toBe(0);
    expect(run.toRevision).toBe(1);
    expect([...run.revisions].sort((a, b) => a - b)).toEqual([0, 1]);
    // The visible-text invariant still holds with base content present.
    expect(visibleText(segments)).toBe(currentText(model));
  });

  test("a run extended across revisions records from/to as the opening/closing revision", () => {
    // Revision 2 appends onto revision 1's run — they coalesce into one accepted run
    // whose tail belongs to revision 2 (the writing-caret's join key on sequential typing).
    const model = reconstruct([
      { ty: "is", s: "Hello", ibi: 1, revision_id: 1 },
      { ty: "is", s: " world", ibi: 6, revision_id: 2 },
    ]);
    const segments = segmentsAt(model);
    expect(segments).toHaveLength(1);
    const run = segments[0];
    expect(run?.kind === "accepted-text" ? run.text : "").toBe("Hello world");
    expect(run?.kind === "accepted-text" ? run.fromRevision : -1).toBe(1);
    expect(run?.kind === "accepted-text" ? run.toRevision : -1).toBe(2);
  });

  // ── Threaded inserts into pre-existing / base (Revision 0) content ───────────
  // Regression: a real revision inserting INTO an older run must break that run so
  // its `toRevision` names the inserting revision and the run ends exactly at the
  // insertion point — otherwise the trailing base content overwrites `toRevision`
  // back to 0 and the writing caret (painted after a run) is swept past the edit.
  function baseThenChangelog(
    base: string,
    changelog: ReadonlyArray<Record<string, unknown>>,
  ): DocumentModel {
    const model = createModel();
    for (const op of decodeSnapshot({
      chunkedSnapshot: [[{ ty: "is", s: base, ibi: 1 }]],
      changelog: [],
    })) {
      applyOperation(model, op, BASE_REVISION);
    }
    for (const revision of decodeOperations({ changelog })) {
      applyRevision(model, revision);
    }
    return model;
  }

  test("an edit threaded INTO base content breaks the run at the insertion point", () => {
    // Base "Hello World" (rev 0); rev 1 inserts "XYZ" before 'W' -> "Hello XYZWorld".
    const model = baseThenChangelog("Hello World", [
      { ty: "is", s: "XYZ", ibi: 7, revision_id: 1 },
    ]);
    const segments = segmentsAt(model);
    // The run carrying the edit closes at the insertion point; the trailing base
    // content is a SEPARATE run (it would otherwise reset toRevision back to 0).
    expect(segments).toHaveLength(2);
    const head = segments[0];
    const tail = segments[1];
    expect(head?.kind).toBe("accepted-text");
    expect(tail?.kind).toBe("accepted-text");
    if (head?.kind !== "accepted-text" || tail?.kind !== "accepted-text") return;
    expect(head.text).toBe("Hello XYZ");
    // The inserting revision (1) is the run's tail — the writing-caret join key.
    expect(head.toRevision).toBe(1);
    expect(head.fromRevision).toBe(0);
    // The trailing base content stays pure pre-history (no spurious caret latch).
    expect(tail.text).toBe("World");
    expect(tail.fromRevision).toBe(0);
    expect(tail.toRevision).toBe(0);
    // Visibility is unchanged — only the run grouping differs.
    expect(visibleText(segments)).toBe(currentText(model));
  });

  test("an edit PREPENDED before base content opens its own run carrying the revision", () => {
    // Base "World" (rev 0); rev 1 inserts "Hi " at the very start -> "Hi World".
    const model = baseThenChangelog("World", [{ ty: "is", s: "Hi ", ibi: 1, revision_id: 1 }]);
    const segments = segmentsAt(model);
    expect(segments).toHaveLength(2);
    const head = segments[0];
    if (head?.kind !== "accepted-text") throw new Error("expected leading accepted run");
    expect(head.text).toBe("Hi ");
    expect(head.fromRevision).toBe(1);
    expect(head.toRevision).toBe(1);
    expect(visibleText(segments)).toBe(currentText(model));
  });

  test("sequential typing across rising revisions still coalesces into one run", () => {
    // No backward step: rev 1 then rev 2 appended onto base "x" -> a single run, so
    // the monotonic-forward optimization (and the existing caret join) is preserved.
    const model = baseThenChangelog("x", [
      { ty: "is", s: "ab", ibi: 2, revision_id: 1 },
      { ty: "is", s: "cd", ibi: 4, revision_id: 2 },
    ]);
    const segments = segmentsAt(model);
    expect(segments).toHaveLength(1);
    const run = segments[0];
    if (run?.kind !== "accepted-text") throw new Error("expected one accepted run");
    expect(run.text).toBe("xabcd");
    expect(run.fromRevision).toBe(0);
    expect(run.toRevision).toBe(2);
    expect(visibleText(segments)).toBe(currentText(model));
  });
});
