// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rich/suggesting-doc op-grammar regression (§24 Q7 follow-up, 2026-06-12). Locks
// in the live finding that a rich Google Doc's `revisions/load` changelog carries
// embedded-object entity ops (`ae`/`te`/`ue`) and suggestion-entity/style ops
// (`astss`/`sue`) the decoder does not structurally model — they MUST degrade to
// UnknownOp via the open-world funnel (never abort), while the suggestion text ops
// the grammar DOES model (`iss`/`msfd`) decode to their typed variants. Crucially,
// isolating the unrecognized ops leaves the reconstructed text correct: they
// contribute no characters, so the surrounding character indices stay aligned.
// See lib/core/fixtures/captured-rich.ts.

import { describe, expect, test } from "bun:test";
import { textAtRevisionIndex } from "@/lib/core/docs/reconstruction/snapshot";
import { CAPTURED_RICH_DOC, RICH_DOC_UNKNOWN_OPCODES } from "@/lib/core/fixtures/captured-rich";
import { runPipeline } from "@/lib/core/worker/pipeline";
import { decodeOperations } from "./decode";

describe("captured rich/suggesting doc — §24 Q7 (2026-06-12)", () => {
  test("isolates the live entity/suggestion-entity ops via the open-world UnknownOp path", () => {
    const decoded = decodeOperations(CAPTURED_RICH_DOC.envelope);
    // Map each revision's single top-level op to its decoded discriminator.
    const opByRevision = new Map<
      number,
      ReturnType<typeof decodeOperations>[number]["operations"][number]
    >();
    for (const r of decoded) {
      const op = r.operations[0];
      if (op !== undefined) opByRevision.set(Number(r.revisionId), op);
    }
    // ae (rev 3), ue (rev 5), sue (rev 8) → UnknownOp, each carrying ONLY its wire
    // op-code (privacy-safe; no embedded payload text). te (rev 4) is now a
    // recognized PlaceEntity and astss (rev 7) a paragraph-scope ApplyStyle.
    const unknownByRev: Record<number, string> = {
      3: "ae",
      5: "ue",
      8: "sue",
    };
    for (const [rev, opCode] of Object.entries(unknownByRev)) {
      const op = opByRevision.get(Number(rev));
      expect(op?.ty).toBe("unknown");
      if (op?.ty === "unknown") expect(op.opCode).toBe(opCode);
    }
    // te (rev 4) decodes to a typed PlaceEntity (embedded-object placement).
    expect(opByRevision.get(4)?.ty).toBe("te");
    // astss (rev 7) decodes to a typed ApplyStyle (suggestion, paragraph scope).
    const astss = opByRevision.get(7);
    expect(astss?.ty).toBe("as");
    if (astss?.ty === "as") {
      expect(astss.scope).toBe("paragraph");
      expect(astss.suggested).toBe(true);
    }
    // The set of unrecognized codes matches the fixture's documented inventory.
    const liveUnknown = decoded
      .map((r) => r.operations[0])
      .filter((op) => op?.ty === "unknown")
      .map((op) => (op?.ty === "unknown" ? op.opCode : ""))
      .sort();
    expect(liveUnknown).toEqual([...RICH_DOC_UNKNOWN_OPCODES].sort());
  });

  test("decodes the modeled suggestion ops (iss insert, msfd mark-for-deletion) to typed variants", () => {
    const decoded = decodeOperations(CAPTURED_RICH_DOC.envelope);
    // iss is revision 6, msfd is revision 9 (1-based revisionId from tuple [3]).
    const iss = decoded.find((r) => Number(r.revisionId) === 6)?.operations[0];
    const msfd = decoded.find((r) => Number(r.revisionId) === 9)?.operations[0];
    expect(iss).toEqual({ ty: "iss", s: " plus suggestion", ibi: 11 });
    expect(msfd).toEqual({ ty: "msfd", si: 1, ei: 6 });
  });

  test("reconstructs coherent end-of-timeline text despite the unrecognized ops", () => {
    const result = runPipeline(CAPTURED_RICH_DOC.envelope);
    if (result.kind !== "ok") throw new Error(`expected ok pipeline, got ${result.kind}`);
    const finalText = textAtRevisionIndex(result.replayIndex, result.revisions.length);
    // The iss suggestion text is present; the msfd-marked "Draft " span is excluded
    // from the accepted-view text; the entity ops contribute no characters and do
    // NOT shift the surrounding indices.
    expect(finalText).toBe(CAPTURED_RICH_DOC.expectedFinalText);
    expect(finalText).toBe("text plus suggestion");
  });
});
