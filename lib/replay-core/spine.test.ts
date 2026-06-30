// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { buildReplayIndex, modelAtRevisionIndex, type ReplayDeps, type ReplayIndex } from "./spine";

// A trivial model + revision pair to exercise the generic spine in isolation:
// the model is an array of strings; each revision appends one token. Linear
// replay is the ground truth the snapshot-assisted lookup must match.
interface ListModel {
  items: string[];
}
interface AppendRevision {
  readonly token: string;
}

const DEPS: ReplayDeps<ListModel, AppendRevision> = {
  createModel: () => ({ items: [] }),
  cloneModel: (model) => ({ items: [...model.items] }),
  applyRevision: (model, revision) => {
    model.items.push(revision.token);
  },
};

function linearAfter(revisions: readonly AppendRevision[], n: number, base: string[] = []): string {
  const model: ListModel = { items: [...base] };
  for (let i = 0; i < n; i++) {
    const revision = revisions[i];
    if (revision !== undefined) DEPS.applyRevision(model, revision);
  }
  return model.items.join(",");
}

const REVS: AppendRevision[] = [
  { token: "a" },
  { token: "b" },
  { token: "c" },
  { token: "d" },
  { token: "e" },
];

describe("spine — snapshot-assisted equivalence", () => {
  test("matches linear replay at every revision (cadence < length)", () => {
    const index = buildReplayIndex(REVS, DEPS, 2);
    for (let n = 0; n <= REVS.length; n++) {
      expect(modelAtRevisionIndex(index, n, DEPS).items.join(",")).toBe(linearAfter(REVS, n));
    }
  });

  test("caches snapshots at index 0, every cadence, and the end", () => {
    const index = buildReplayIndex(REVS, DEPS, 2);
    expect([...index.snapshots.keys()].sort((a, b) => a - b)).toEqual([0, 2, 4, 5]);
    expect(index.cadence).toBe(2);
    expect(index.revisions).toBe(REVS);
  });

  test("clamps n below 0 and beyond the revision count", () => {
    const index = buildReplayIndex(REVS, DEPS, 2);
    expect(modelAtRevisionIndex(index, -5, DEPS).items).toEqual([]);
    expect(modelAtRevisionIndex(index, 99, DEPS).items.join(",")).toBe("a,b,c,d,e");
  });

  test("never mutates a cached snapshot across lookups", () => {
    const index = buildReplayIndex(REVS, DEPS, 2);
    const first = modelAtRevisionIndex(index, 5, DEPS);
    first.items.push("MUTATED");
    expect(modelAtRevisionIndex(index, 5, DEPS).items.join(",")).toBe("a,b,c,d,e");
  });
});

describe("spine — base seed (chunkedSnapshot analogue)", () => {
  test("snapshot(0) reflects the seeded base, and edits stack on top", () => {
    const seed = (model: ListModel) => {
      model.items.push("BASE");
    };
    const index = buildReplayIndex(REVS, DEPS, 2, seed);
    expect(modelAtRevisionIndex(index, 0, DEPS).items.join(",")).toBe("BASE");
    for (let n = 0; n <= REVS.length; n++) {
      expect(modelAtRevisionIndex(index, n, DEPS).items.join(",")).toBe(
        linearAfter(REVS, n, ["BASE"]),
      );
    }
  });
});

describe("spine — degenerate snapshot map", () => {
  test("falls back to a fresh base model when no snapshot ≤ n exists", () => {
    // Hand-built index whose snapshot map omits index 0, forcing the
    // `nearestSnapshotAtOrBefore` fresh-model fallback path.
    const index: ReplayIndex<ListModel, AppendRevision> = {
      revisions: REVS,
      cadence: 2,
      snapshots: new Map(),
    };
    expect(modelAtRevisionIndex(index, 3, DEPS).items.join(",")).toBe("a,b,c");
  });
});
