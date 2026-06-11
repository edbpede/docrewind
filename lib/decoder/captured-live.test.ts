// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-of-timeline text-equality proof against a REAL captured document
// (PRD §15.3 MUST; plan R4 tier [x:live]; docs/phase-3-acceptance.md
// "[BLOCKED:live]"). Runs the sanitized §24 capture (lib/fixtures/captured.ts)
// through the SAME production pipeline the worker uses
// (parseFramed → detectSchema → decodeOperations → buildReplayIndex →
// currentText) and asserts the reconstructed end-of-timeline text equals the
// source document's verbatim current text. This is the live counterpart to the
// hand-derived synthetic corpus: the input here is the real 2026 wire format
// (the 9-element changelog tuple), so it also proves the decoder's tuple-envelope
// adapter (decode.ts#normalizeEntry) against ground truth.

import { describe, expect, test } from "bun:test";
import { CAPTURED_SIMPLE_DOC } from "../fixtures/captured";
import { textAtRevisionIndex } from "../reconstruction/snapshot";
import { runPipeline } from "../worker/pipeline";
import { decodeOperations } from "./decode";

describe("captured live revisions/load — §24 (2026-06-12)", () => {
  test("decodes the live changelog TUPLE envelope (op + positional metadata)", () => {
    const decoded = decodeOperations(CAPTURED_SIMPLE_DOC.envelope);
    // Four revisions; revisionId is read from tuple position [3], not the index.
    expect(decoded.map((r) => Number(r.revisionId))).toEqual([1, 2, 3, 4]);
    // Revision 1 wraps document/heading setup as `mlti` of (style) ops.
    expect(decoded[0]?.operations[0]?.ty).toBe("mlti");
    // The three text insertions decode to real InsertString ops — NOT UnknownOp,
    // which is what would happen if the tuple envelope were read as a bare op.
    expect(decoded[1]?.operations[0]).toEqual({ ty: "is", s: "Probe one two three.", ibi: 1 });
    expect(decoded[2]?.operations[0]).toEqual({ ty: "is", s: " Second sentence.", ibi: 21 });
    expect(decoded[3]?.operations[0]).toEqual({ ty: "is", s: " Third one.", ibi: 38 });
  });

  test("isolates the live `as` (ApplyStyle) ops via the open-world UnknownOp path", () => {
    const decoded = decodeOperations(CAPTURED_SIMPLE_DOC.envelope);
    const mlti = decoded[0]?.operations[0];
    if (mlti?.ty !== "mlti") throw new Error("expected revision 1 to be mlti");
    // Every style sub-op degrades to UnknownOp(opCode "as") — never aborts decode.
    expect(mlti.mts.length).toBeGreaterThan(0);
    for (const sub of mlti.mts) {
      expect(sub.ty).toBe("unknown");
      if (sub.ty === "unknown") expect(sub.opCode).toBe("as");
    }
  });

  test("reconstructs end-of-timeline text equal to the real document's current text", () => {
    const result = runPipeline(CAPTURED_SIMPLE_DOC.envelope);
    if (result.kind !== "ok") throw new Error(`expected ok pipeline, got ${result.kind}`);
    const finalText = textAtRevisionIndex(result.replayIndex, result.revisions.length);
    expect(finalText).toBe(CAPTURED_SIMPLE_DOC.expectedFinalText);
    expect(finalText).toBe("Probe one two three. Second sentence. Third one.");
  });

  test("strips the live `)]}'` guard and decodes the framed wire text identically", () => {
    // Re-frame the parsed envelope exactly as it arrives off the wire.
    const framed = `)]}'\n${JSON.stringify(CAPTURED_SIMPLE_DOC.envelope)}`;
    const result = runPipeline(framed);
    if (result.kind !== "ok") throw new Error(`expected ok pipeline, got ${result.kind}`);
    const finalText = textAtRevisionIndex(result.replayIndex, result.revisions.length);
    expect(finalText).toBe(CAPTURED_SIMPLE_DOC.expectedFinalText);
  });
});
