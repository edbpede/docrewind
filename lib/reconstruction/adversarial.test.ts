// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Adversarial fixtures (re-audit Phase 1.A). These target the highest-risk
// invariants the original author's tests do NOT exercise: they probe correctness
// independently, not self-consistency. Each expected value is hand-derived from
// the A.2 grammar, not copied from a prior run. A failure here is a real defect
// to fix surgically — never a fixture to weaken.

import { describe, expect, test } from "bun:test";
import { decodeOperations } from "../decoder/decode";
import type { Operation } from "../decoder/types";
import { applyRevision } from "./apply";
import { createModel, type DocumentModel } from "./model";
import { currentText } from "./text";

/** Decode a synthetic changelog and replay every revision into a fresh model. */
function replayAll(parsed: unknown): DocumentModel {
  const model = createModel();
  for (const revision of decodeOperations(parsed)) {
    applyRevision(model, revision);
  }
  return model;
}

function changelog(entries: readonly unknown[]): unknown {
  return { changelog: entries };
}

/** Decode a single-entry changelog and return its one operation (guarded). */
function onlyOp(parsed: unknown): Operation {
  const decoded = decodeOperations(parsed);
  const rev = decoded[0];
  if (rev === undefined) throw new Error("expected one revision");
  const op = rev.operations[0];
  if (op === undefined) throw new Error("expected one operation");
  return op;
}

describe("adversarial A1 — nested mlti recursion across an opaque placeholder", () => {
  test("delete straddling an opaque slot accounts for the slot's position", () => {
    // Live build: "ABCDE", then an opaque image inserted before live position 3.
    // Live order becomes: A(1) B(2) [opaque](3) C(4) D(5) E(6).
    // A depth-first mlti -> mlti -> ds(si=2,ei=4) deletes live positions 2,3,4 =
    // B, [opaque], C. If the opaque did NOT occupy a position the delete would
    // hit B,C,D -> "AE"; correct placeholder accounting yields "ADE".
    const model = replayAll(
      changelog([
        { ty: "is", s: "ABCDE", ibi: 1, revision_id: 1 },
        { ty: "opaque", structure: "image", position: 3, revision_id: 2 },
        {
          ty: "mlti",
          revision_id: 3,
          mts: [{ ty: "mlti", mts: [{ ty: "ds", si: 2, ei: 4 }] }],
        },
      ]),
    );
    expect(currentText(model)).toBe("ADE");
    // The opaque slot is still physically present (tombstoned, not popped).
    expect(model.chars.some((el) => el.kind === "opaque")).toBe(true);
  });
});

describe("adversarial A2 — inverted and out-of-bounds delete ranges are safe", () => {
  test("inverted ds (si > ei) degrades to UnknownOp at decode time", () => {
    const op = onlyOp(changelog([{ ty: "ds", si: 5, ei: 2, revision_id: 1 }]));
    expect(op.ty).toBe("unknown");
  });

  test("ds past the array end is an isolated no-op (no throw, no corruption)", () => {
    const model = replayAll(
      changelog([
        { ty: "is", s: "AB", ibi: 1, revision_id: 1 },
        { ty: "ds", si: 5, ei: 9, revision_id: 2 }, // both past the 2 live chars
      ]),
    );
    expect(currentText(model)).toBe("AB");
  });
});

describe("adversarial A3 — unknown op between two inserts at the same index", () => {
  test("the unknown op carries no text and does not shift the second insert", () => {
    // is "A" at ibi 1; an unknown op; is "B" at ibi 1. The unknown op must not
    // occupy a position or inject text, so the second insert still lands at the
    // head -> "BA". Any position shift would yield "AB".
    const decoded = decodeOperations(
      changelog([
        { ty: "is", s: "A", ibi: 1, revision_id: 1 },
        { ty: "zz", payload: "should never surface", revision_id: 2 },
        { ty: "is", s: "B", ibi: 1, revision_id: 3 },
      ]),
    );
    const unknownRev = decoded[1];
    if (unknownRev === undefined) throw new Error("expected the unknown revision");
    const unknownOp = unknownRev.operations[0];
    if (unknownOp === undefined) throw new Error("expected the unknown op");
    expect(unknownOp.ty).toBe("unknown");
    // Privacy invariant: no verbatim payload text leaks onto the UnknownOp.
    expect(JSON.stringify(unknownOp)).not.toContain("should never surface");

    const model = createModel();
    for (const revision of decoded) {
      applyRevision(model, revision);
    }
    expect(currentText(model)).toBe("BA");
  });
});

describe("adversarial A4 — malformed changelog tuples degrade without mis-mapping", () => {
  test("an over-long (10-element) tuple reads op[0] + revisionId[3], ignoring extras", () => {
    const tuple = [
      { ty: "is", s: "hi", ibi: 1 }, // [0] op
      111, // [1] time
      "user", // [2] userId
      7, // [3] revisionId
      "sess", // [4] sessionId
      "x",
      "y",
      "z",
      "extra",
      "tail", // [5..9] ignored
    ];
    const decoded = decodeOperations(changelog([tuple]));
    const rev = decoded[0];
    if (rev === undefined) throw new Error("expected one revision");
    expect(Number(rev.revisionId)).toBe(7);
    expect(rev.operations[0]).toEqual({ ty: "is", s: "hi", ibi: 1 });
  });

  test("a truncated tuple (op only) falls back to the positional revisionId, no throw", () => {
    const decoded = decodeOperations(changelog([[{ ty: "is", s: "hi", ibi: 1 }]]));
    const rev = decoded[0];
    if (rev === undefined) throw new Error("expected one revision");
    expect(Number(rev.revisionId)).toBe(1); // index 0 -> 1-based fallback
    expect(rev.operations[0]).toEqual({ ty: "is", s: "hi", ibi: 1 });
  });

  test("garbage at op position [0] degrades to UnknownOp rather than throwing", () => {
    const op = onlyOp(changelog([[42, 1, "s", 3]]));
    expect(op.ty).toBe("unknown");
  });
});
