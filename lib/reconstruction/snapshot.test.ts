// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeOperations } from "../decoder/decode";
import { applyRevision } from "./apply";
import { createModel } from "./model";
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
