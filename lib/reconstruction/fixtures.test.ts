// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeOperations } from "../decoder/decode";
import { FIXTURES } from "../fixtures/corpus";
import { buildLinearInsertCorpus } from "../fixtures/perf";
import { applyRevision } from "./apply";
import { createModel, type DocumentModel } from "./model";
import { buildReplayIndex, textAtRevisionIndex } from "./snapshot";
import { currentText, stateAt } from "./text";

function reconstruct(changelog: ReadonlyArray<Record<string, unknown>>): DocumentModel {
  const model = createModel();
  for (const revision of decodeOperations({ changelog })) {
    applyRevision(model, revision);
  }
  return model;
}

describe("[x:hand-derived] decode -> reconstruct equals hand-derived text", () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      expect(currentText(reconstruct(fixture.changelog))).toBe(fixture.expectedFinalText);
    });
  }
});

describe("[x:internal] snapshot-scrub round-trip equals linear replay", () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      const revisions = decodeOperations({ changelog: fixture.changelog });
      const index = buildReplayIndex(revisions, 2); // force multiple snapshots
      // End-of-timeline snapshot text equals a fresh full linear replay.
      expect(textAtRevisionIndex(index, revisions.length)).toBe(
        currentText(reconstruct(fixture.changelog)),
      );
    });
  }
});

describe("perf-shaped fixture — O(N) stateAt guard (R3)", () => {
  const COUNT = 10_000;
  const { changelog, expectedFinalText } = buildLinearInsertCorpus(COUNT);
  const model = reconstruct(changelog);

  test("reconstructs the full ~10k-revision corpus", () => {
    const text = currentText(model);
    expect(text).toHaveLength(COUNT);
    expect(text).toBe(expectedFinalText);
  });

  test("stateAt is a pure single-pass filter (no per-revision mutation)", () => {
    const before = model.chars.length;
    // Two reads must be identical AND must not mutate the model.
    expect(currentText(model)).toBe(currentText(model));
    expect(model.chars.length).toBe(before);
    // Time-travel midpoint: first half of the inserts, single O(N) filter.
    const half = COUNT / 2;
    const mid = stateAt(model, half);
    expect(mid).toHaveLength(half);
    expect(mid).toBe(expectedFinalText.slice(0, half));
    expect(model.chars.length).toBe(before);
  });
});
