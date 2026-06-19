// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeOperations, decodeSnapshot } from "../decoder/decode";
import { applyOperation, applyRevision } from "./apply";
import { BASE_REVISION, createModel } from "./model";
import { buildReplayIndex, textAtRevisionIndex } from "./snapshot";
import { currentText } from "./text";

const CORPUS = {
  changelog: [
    { ty: "is", s: "Hello", ibi: 1, revision_id: 1 },
    { ty: "is", s: " world", ibi: 6, revision_id: 2 }, // "Hello world"
    { ty: "ds", si: 1, ei: 6, revision_id: 3 }, // "world"
    { ty: "iss", s: "!", ibi: 6, revision_id: 4 }, // "world!"
    { ty: "msfd", si: 1, ei: 5, revision_id: 5 }, // "!"
    { ty: "usfd", si: 1, ei: 5, revision_id: 6 }, // "world!"
  ],
};

function linearTextAfter(n: number): string {
  const revisions = decodeOperations(CORPUS);
  const model = createModel();
  for (let i = 0; i < n; i++) {
    const revision = revisions[i];
    if (revision !== undefined) applyRevision(model, revision);
  }
  return currentText(model);
}

describe("snapshot — scrub round-trip equivalence (R3)", () => {
  test("snapshot-assisted text equals linear replay at every revision (cadence < length)", () => {
    const revisions = decodeOperations(CORPUS);
    const index = buildReplayIndex(revisions, 2); // force multiple snapshots
    for (let n = 0; n <= revisions.length; n++) {
      expect(textAtRevisionIndex(index, n)).toBe(linearTextAfter(n));
    }
  });

  test("end-of-timeline snapshot text equals full linear replay", () => {
    const revisions = decodeOperations(CORPUS);
    const index = buildReplayIndex(revisions, 2);
    expect(textAtRevisionIndex(index, revisions.length)).toBe("world!");
    expect(textAtRevisionIndex(index, revisions.length)).toBe(linearTextAfter(revisions.length));
  });

  test("intermediate scrub points reconstruct the expected hand-derived text", () => {
    const index = buildReplayIndex(decodeOperations(CORPUS), 2);
    expect(textAtRevisionIndex(index, 2)).toBe("Hello world");
    expect(textAtRevisionIndex(index, 3)).toBe("world");
    expect(textAtRevisionIndex(index, 4)).toBe("world!");
    expect(textAtRevisionIndex(index, 5)).toBe("!");
  });
});

describe("snapshot — base content seeding (chunkedSnapshot)", () => {
  // A 9-char base ("TEMPLATE ") seeded from a chunkedSnapshot, then two edits that
  // assume that base is present (ibi=10 is the live position just past it).
  const BASE_OPS = decodeSnapshot({
    chunkedSnapshot: [[{ ty: "is", s: "TEMPLATE ", ibi: 1 }]],
    changelog: [],
  });
  const EDITS = decodeOperations({
    changelog: [
      { ty: "is", s: "edit", ibi: 10, revision_id: 1 },
      { ty: "ds", si: 1, ei: 9, revision_id: 2 }, // delete the template prefix
    ],
  });

  test("snapshot(0) is the seeded base document, not an empty one", () => {
    const index = buildReplayIndex(EDITS, 2, BASE_OPS);
    expect(textAtRevisionIndex(index, 0)).toBe("TEMPLATE ");
  });

  test("changelog edits align to the seeded base positions", () => {
    const index = buildReplayIndex(EDITS, 2, BASE_OPS);
    expect(textAtRevisionIndex(index, 1)).toBe("TEMPLATE edit");
    expect(textAtRevisionIndex(index, 2)).toBe("edit"); // template deleted
  });

  test("snapshot-assisted scrub equals a fresh seeded linear replay at every index", () => {
    const index = buildReplayIndex(EDITS, 1, BASE_OPS); // cadence=1 forces caching each step
    for (let n = 0; n <= EDITS.length; n++) {
      const linear = createModel();
      for (const op of BASE_OPS) applyOperation(linear, op, BASE_REVISION);
      for (let i = 0; i < n; i++) {
        const revision = EDITS[i];
        if (revision !== undefined) applyRevision(linear, revision);
      }
      expect(textAtRevisionIndex(index, n)).toBe(currentText(linear));
    }
  });

  test("empty baseOps reproduces the from-empty behaviour (no regression)", () => {
    const index = buildReplayIndex(EDITS, 2, []);
    // With no base, the rev-1 ibi=10 clamps to the empty doc's end -> "edit".
    expect(textAtRevisionIndex(index, 1)).toBe("edit");
  });
});
