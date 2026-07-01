// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeOperations } from "@/lib/core/docs/decoder/decode";
import { applyRevision } from "./apply";
import { createModel, type DocumentModel } from "./model";
import { currentText, stateAt } from "./text";

/** Decode a synthetic changelog and replay every revision into a fresh model. */
function replayAll(parsed: unknown): DocumentModel {
  const model = createModel();
  for (const revision of decodeOperations(parsed)) {
    applyRevision(model, revision);
  }
  return model;
}

function changelog(entries: ReadonlyArray<Record<string, unknown>>): unknown {
  return { changelog: entries };
}

describe("apply — insert/delete semantics (A.2)", () => {
  test("is splices at ibi-1; consecutive inserts build text", () => {
    const model = replayAll(
      changelog([
        { ty: "is", s: "Hello", ibi: 1, revision_id: 1 },
        { ty: "is", s: " world", ibi: 6, revision_id: 2 },
      ]),
    );
    // [x:hand-derived] A.2 insert: "Hello" then " world" before EndOfBody.
    expect(currentText(model)).toBe("Hello world");
  });

  test("ds tombstones the inclusive live range si..ei", () => {
    const model = replayAll(
      changelog([
        { ty: "is", s: "Hello world", ibi: 1, revision_id: 1 },
        { ty: "ds", si: 1, ei: 6, revision_id: 2 }, // delete "Hello "
      ]),
    );
    // [x:hand-derived] A.2 delete pops "Hello " (positions 1..6) -> "world".
    expect(currentText(model)).toBe("world");
  });
});

describe("apply — suggestion semantics (R3)", () => {
  const CORPUS = changelog([
    { ty: "is", s: "Hello", ibi: 1, revision_id: 1 },
    { ty: "is", s: " world", ibi: 6, revision_id: 2 },
    { ty: "ds", si: 1, ei: 6, revision_id: 3 }, // -> "world"
    { ty: "iss", s: "!", ibi: 6, revision_id: 4 }, // suggested insert -> "world!"
    { ty: "msfd", si: 1, ei: 5, revision_id: 5 }, // mark "world" -> "!"
    { ty: "usfd", si: 1, ei: 5, revision_id: 6 }, // unmark -> "world!"
  ]);

  test("suggested-insert is visible; msfd hides without deleting; usfd restores", () => {
    // [x:hand-derived] end-of-timeline text after the full corpus.
    expect(currentText(replayAll(CORPUS))).toBe("world!");
  });

  test("msfd sets suggestionState but NOT deleteRevision (reversible)", () => {
    const model = createModel();
    const revisions = decodeOperations(CORPUS);
    // Apply the first five revisions (through msfd, before usfd).
    for (let i = 0; i < 5; i++) {
      const revision = revisions[i];
      if (revision !== undefined) applyRevision(model, revision);
    }
    expect(currentText(model)).toBe("!"); // "world" is marked-for-deletion
    const wChar = model.chars.find((el) => el.kind === "char" && el.char === "w");
    expect(wChar?.kind).toBe("char");
    if (wChar?.kind !== "char") return;
    expect(wChar.suggestionState).toBe("marked-for-deletion");
    expect(wChar.deleteRevision).toBeNull(); // NOT a hard delete (R3)
  });
});

describe("apply — mlti recursion + opaque slots", () => {
  test("mlti applies sub-ops depth-first under the parent revision", () => {
    const model = replayAll(
      changelog([
        {
          ty: "mlti",
          revision_id: 1,
          mts: [
            { ty: "is", s: "ab", ibi: 1 },
            { ty: "is", s: "c", ibi: 3 },
          ],
        },
      ]),
    );
    // [x:hand-derived] "ab" then "c" before EndOfBody -> "abc".
    expect(currentText(model)).toBe("abc");
  });

  test("opaque occupies a position slot but contributes no text", () => {
    const model = replayAll(
      changelog([
        { ty: "is", s: "AB", ibi: 1, revision_id: 1 },
        { ty: "opaque", structure: "image", position: 2, revision_id: 2 },
      ]),
    );
    expect(currentText(model)).toBe("AB");
    expect(model.chars.some((el) => el.kind === "opaque")).toBe(true);
  });
});

describe("apply — rplc replace-with-snapshot (pre-existing/template content)", () => {
  test("rplc seeds the embedded content; a later insert aligns to the seeded positions", () => {
    const model = replayAll(
      changelog([
        // Revision 1 loads a 4-char template ("Q1. ") via the bulk replace op.
        { ty: "rplc", snapshot: [{ ty: "is", s: "Q1. ", ibi: 1 }], revision_id: 1 },
        // Revision 2 types after it — ibi=5 is the live position just past "Q1. ".
        { ty: "is", s: "answer", ibi: 5, revision_id: 2 },
      ]),
    );
    // [x:hand-derived] the seeded base is present, so the rev-2 insert lands after
    // it -> "Q1. answer". Dropping the rplc (old UnknownOp path) would seed nothing
    // and the rev-2 ibi=5 would land in an empty doc — the reported misalignment.
    expect(currentText(model)).toBe("Q1. answer");
  });

  test("rplc resets the document (replaces any prior content)", () => {
    const model = replayAll(
      changelog([
        { ty: "is", s: "old text", ibi: 1, revision_id: 1 },
        { ty: "rplc", snapshot: [{ ty: "is", s: "fresh", ibi: 1 }], revision_id: 2 },
      ]),
    );
    // [x:hand-derived] rplc clears the body then applies its snapshot -> "fresh".
    expect(currentText(model)).toBe("fresh");
  });

  test("rplc-seeded content time-travels under the replace revision id", () => {
    const model = replayAll(
      changelog([
        { ty: "rplc", snapshot: [{ ty: "is", s: "Tpl", ibi: 1 }], revision_id: 1 },
        { ty: "is", s: "!", ibi: 4, revision_id: 2 },
      ]),
    );
    expect(stateAt(model, 1)).toBe("Tpl"); // template present at its load revision
    expect(stateAt(model, 2)).toBe("Tpl!"); // the rev-2 edit appears after
  });
});

describe("text — tombstone time-travel (stateAt)", () => {
  const model = replayAll(
    changelog([
      { ty: "is", s: "Hello", ibi: 1, revision_id: 1 },
      { ty: "is", s: " world", ibi: 6, revision_id: 2 },
      { ty: "ds", si: 1, ei: 6, revision_id: 3 }, // delete "Hello "
    ]),
  );

  test("stateAt(1) excludes later-inserted text", () => {
    expect(stateAt(model, 1)).toBe("Hello");
  });

  test("stateAt(2) includes chars not yet deleted at that revision", () => {
    expect(stateAt(model, 2)).toBe("Hello world");
  });

  test("currentText reflects the accepted delete", () => {
    expect(currentText(model)).toBe("world");
  });
});
