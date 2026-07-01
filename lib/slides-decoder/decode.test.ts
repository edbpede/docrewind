// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for the Slides (Punch) decoder: one arm per opcode, malformed-payload
// degradation to SlidesUnknownOp, the changelog tuple layout, and the chunkedSnapshot
// base decode. Synthetic ops mirror the live grammar (capture 2026-07-01).

import { describe, expect, test } from "bun:test";
import { decodeSlidesOperations, decodeSlidesSnapshot } from "./decode";
import { type SlidesOperation, unsafeAsPageId, unsafeAsShapeId } from "./types";

/** Wrap a single op payload into a live changelog tuple. */
function entry(
  op: unknown,
  meta: { rev?: number; user?: string; sess?: string; time?: number } = {},
): unknown {
  return [op, meta.time ?? 1000, meta.user ?? "u1", meta.rev ?? 1, meta.sess ?? "s1"];
}

function decodeOne(op: unknown): SlidesOperation {
  const revisions = decodeSlidesOperations({ changelog: [entry(op)] });
  const first = revisions[0];
  if (first === undefined) throw new Error("no revision decoded");
  const only = first.operations[0];
  if (only === undefined) throw new Error("no op decoded");
  return only;
}

describe("changelog tuple + metadata", () => {
  test("reads op / time / userId / revisionId / sessionId by position", () => {
    const revisions = decodeSlidesOperations({
      changelog: [entry([20], { rev: 7, user: "alice", sess: "sess9", time: 12345 })],
    });
    const r = revisions[0];
    expect(Number(r?.revisionId)).toBe(7);
    expect(String(r?.userId)).toBe("alice");
    expect(String(r?.sessionId)).toBe("sess9");
    expect(r?.time).toBe(12345);
    expect(r?.modelVersionMismatch).toBe(false);
  });

  test("falls back to index+1 when the revision id is missing/invalid", () => {
    const revisions = decodeSlidesOperations({ changelog: [[[20], 1, "u", 0, "s"]] });
    expect(Number(revisions[0]?.revisionId)).toBe(1);
  });

  test("null identity fields decode to null", () => {
    const revisions = decodeSlidesOperations({ changelog: [[[20], null, null, 3, null]] });
    expect(revisions[0]?.userId).toBeNull();
    expect(revisions[0]?.sessionId).toBeNull();
    expect(revisions[0]?.time).toBeNull();
  });

  test("supports the synthetic object-entry form", () => {
    const revisions = decodeSlidesOperations({
      changelog: [{ op: [20], revision_id: 4, user_id: "bob", session_id: "z", time: 9 }],
    });
    expect(Number(revisions[0]?.revisionId)).toBe(4);
    expect(String(revisions[0]?.userId)).toBe("bob");
  });

  test("reads a top-level array as the changelog", () => {
    const revisions = decodeSlidesOperations([entry([20])]);
    expect(revisions.length).toBe(1);
  });

  test("empty / non-record input decodes to an empty list", () => {
    expect(decodeSlidesOperations(null)).toEqual([]);
    expect(decodeSlidesOperations({})).toEqual([]);
  });
});

describe("structural ops", () => {
  test("txn flattens into a single txn op with typed sub-ops", () => {
    const op = decodeOne([4, [[20], [45]]]);
    expect(op.op).toBe("txn");
    if (op.op !== "txn") throw new Error("expected txn");
    expect(op.ops.map((o) => o.op)).toEqual(["marker", "default-style"]);
  });

  test("txn with a non-array body degrades to unknown", () => {
    expect(decodeOne([4, "nope"]).op).toBe("unknown");
  });

  test("page-size reads [w, h]", () => {
    const op = decodeOne([1, [365760, 205740], [274320, 365760]]);
    expect(op).toEqual({ op: "page-size", width: 365760, height: 205740 });
  });

  test("page-size with non-positive dims degrades to unknown", () => {
    expect(decodeOne([1, [0, 100], []]).op).toBe("unknown");
    expect(decodeOne([1, "x", []]).op).toBe("unknown");
  });

  test("create-shape reads id, type, transform, parent", () => {
    const op = decodeOne([3, "i0", 108, [2.84, 0, 0, 0.68, 12468, 29783], [55, 0], "p"]);
    expect(op).toEqual({
      op: "create-shape",
      shapeId: unsafeAsShapeId("i0"),
      parentId: unsafeAsPageId("p"),
      shapeType: 108,
      transform: {
        scaleX: 2.84,
        shearY: 0,
        shearX: 0,
        scaleY: 0.68,
        translateX: 12468,
        translateY: 29783,
      },
    });
  });

  test("create-shape with a short/absent transform keeps a null transform", () => {
    const op = decodeOne([3, "i0", 108, [1, 2, 3], [], "p"]);
    if (op.op !== "create-shape") throw new Error("expected create-shape");
    expect(op.transform).toBeNull();
  });

  test("create-shape missing id/type/parent degrades to unknown", () => {
    expect(decodeOne([3, "", 108, [], [], "p"]).op).toBe("unknown");
    expect(decodeOne([3, "i0", "x", [], [], "p"]).op).toBe("unknown");
    expect(decodeOne([3, "i0", 108, [], [], 42]).op).toBe("unknown");
  });

  test("define-page maps pageType 0/1/2 to slide/layout/master", () => {
    expect(decodeOne([12, "p", 0, 0, []])).toMatchObject({ op: "define-page", pageType: "slide" });
    expect(decodeOne([12, "l", 0, 1, []])).toMatchObject({ pageType: "layout" });
    expect(decodeOne([12, "m", 0, 2, []])).toMatchObject({ pageType: "master" });
  });

  test("define-page captures a theme palette", () => {
    const op = decodeOne([
      12,
      "simple-light-2",
      0,
      2,
      [0, ["Simple Light", ["#000000", "#FFFFFF"]], 4, "id"],
    ]);
    if (op.op !== "define-page") throw new Error("expected define-page");
    expect(op.theme).toEqual({ name: "Simple Light", palette: ["#000000", "#FFFFFF"] });
  });

  test("define-page with an unrecognized pageType degrades to unknown", () => {
    expect(decodeOne([12, "p", 0, 9, []]).op).toBe("unknown");
  });

  test("declare-placeholder reads page id (array or bare) + layout type", () => {
    expect(decodeOne([18, ["p"], [], [1, "simple-light-2", 2, "TITLE"], []])).toEqual({
      op: "declare-placeholder",
      pageId: unsafeAsPageId("p"),
      layoutType: "TITLE",
    });
    expect(decodeOne([18, "g1", [], [2, "TITLE_AND_BODY"], []])).toMatchObject({
      pageId: unsafeAsPageId("g1"),
      layoutType: "TITLE_AND_BODY",
    });
  });

  test("declare-placeholder without a page id degrades to unknown", () => {
    expect(decodeOne([18, [], [], [], []]).op).toBe("unknown");
  });
});

describe("text ops", () => {
  test("insert-text reads shape, offset, text", () => {
    expect(decodeOne([15, "i0", null, 3, "hi"])).toEqual({
      op: "insert-text",
      shapeId: unsafeAsShapeId("i0"),
      offset: 3,
      text: "hi",
    });
  });

  test("insert-text with non-string text or bad offset degrades to unknown", () => {
    expect(decodeOne([15, "i0", null, 3, 42]).op).toBe("unknown");
    expect(decodeOne([15, "i0", null, -1, "x"]).op).toBe("unknown");
  });

  test("delete-text reads half-open [start, end)", () => {
    expect(decodeOne([16, "i0", null, 0, 5])).toEqual({
      op: "delete-text",
      shapeId: unsafeAsShapeId("i0"),
      start: 0,
      end: 5,
    });
  });

  test("delete-text with a reversed range degrades to unknown", () => {
    expect(decodeOne([16, "i0", null, 5, 2]).op).toBe("unknown");
  });
});

describe("recognized-inert + unknown ops", () => {
  test.each<[unknown[], string]>([
    [[5], "shape-prop"],
    [[9], "create-page"],
    [[13, 0, 1, "m", "l"], "page-membership"],
    [[17, "i0", null, 0, 1, [], [], [], 1], "text-style"],
    [[20], "marker"],
    [[41, "i0", null, "list", []], "list-entity"],
    [[45, [], [], []], "default-style"],
  ])("op %o -> %s", (raw, expected) => {
    expect(decodeOne(raw).op as string).toBe(expected);
  });

  test("an unrecognized opcode degrades to unknown with a byte length", () => {
    const op = decodeOne([9999, "payload"]);
    if (op.op !== "unknown") throw new Error("expected unknown");
    expect(op.opCode).toBe("9999");
    expect(op.byteLength).toBeGreaterThan(0);
  });

  test("a non-array / non-numeric opcode degrades to unknown", () => {
    expect(decodeOne("nope").op).toBe("unknown");
    expect(decodeOne(["x"]).op).toBe("unknown");
  });
});

describe("chunkedSnapshot decode", () => {
  test("decodes a chunk of bare op arrays under the pre-history revision", () => {
    const ops = decodeSlidesSnapshot({
      chunkedSnapshot: [
        [
          [12, "p", 0, 0, []],
          [13, 0, 0, null, "p"],
        ],
      ],
    });
    expect(ops.map((o) => o.op)).toEqual(["define-page", "page-membership"]);
  });

  test("decodes bare top-level op arrays too", () => {
    const ops = decodeSlidesSnapshot({ chunkedSnapshot: [[12, "p", 0, 0, []]] });
    expect(ops[0]?.op).toBe("define-page");
  });

  test("missing chunkedSnapshot yields no ops", () => {
    expect(decodeSlidesSnapshot({})).toEqual([]);
    expect(decodeSlidesSnapshot(null)).toEqual([]);
  });
});
