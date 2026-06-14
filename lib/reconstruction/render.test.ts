// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit test for the pure segment renderer (plan Phase 5 §2/§3). The headline
// invariant: concatenating the `accepted-text` + `suggested-insert` segment text
// equals `currentText(model)` for every corpus fixture — `marked-for-deletion`
// runs render separately and are excluded from the visible text, exactly as
// `text.ts` excludes them. `segmentsAt` is SINGLE-ARG: no test passes an
// applied-count (or any `t`) into it.

import { describe, expect, test } from "bun:test";
import { decodeOperations } from "../decoder/decode";
import { FIXTURES } from "../fixtures/corpus";
import { applyRevision } from "./apply";
import { createModel, type DocumentModel } from "./model";
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
  });
});
