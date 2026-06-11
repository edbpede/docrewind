// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeOperations } from "./decode";
import type { Operation } from "./types";

/** Decode a single-entry changelog and return its one operation (guarded). */
function onlyOp(parsed: unknown): Operation {
  const decoded = decodeOperations(parsed);
  expect(decoded).toHaveLength(1);
  const rev = decoded[0];
  if (rev === undefined) throw new Error("expected one revision");
  expect(rev.operations).toHaveLength(1);
  const op = rev.operations[0];
  if (op === undefined) throw new Error("expected one operation");
  return op;
}

function entry(op: Record<string, unknown>): unknown {
  return { changelog: [{ revision_id: 1, ...op }] };
}

describe("decodeOperations — text operations", () => {
  test("decodes InsertString (is)", () => {
    expect(onlyOp(entry({ ty: "is", s: "hello", ibi: 1 }))).toEqual({
      ty: "is",
      s: "hello",
      ibi: 1,
    });
  });

  test("decodes DeleteString (ds)", () => {
    expect(onlyOp(entry({ ty: "ds", si: 2, ei: 5 }))).toEqual({
      ty: "ds",
      si: 2,
      ei: 5,
    });
  });

  test("decodes suggestion ops (iss/dss/msfd/usfd)", () => {
    expect(onlyOp(entry({ ty: "iss", s: "x", ibi: 3 }))).toEqual({
      ty: "iss",
      s: "x",
      ibi: 3,
    });
    expect(onlyOp(entry({ ty: "dss", si: 1, ei: 2 }))).toEqual({
      ty: "dss",
      si: 1,
      ei: 2,
    });
    expect(onlyOp(entry({ ty: "msfd", si: 4, ei: 6 }))).toEqual({
      ty: "msfd",
      si: 4,
      ei: 6,
    });
    expect(onlyOp(entry({ ty: "usfd", si: 4, ei: 6 }))).toEqual({
      ty: "usfd",
      si: 4,
      ei: 6,
    });
  });
});

describe("decodeOperations — mlti recursion", () => {
  test("recurses depth-first over nested mts", () => {
    const op = onlyOp(
      entry({
        ty: "mlti",
        mts: [
          { ty: "is", s: "ab", ibi: 1 },
          { ty: "mlti", mts: [{ ty: "ds", si: 1, ei: 1 }] },
        ],
      }),
    );
    expect(op.ty).toBe("mlti");
    if (op.ty !== "mlti") return;
    expect(op.mts).toHaveLength(2);
    const [first, second] = op.mts;
    expect(first).toEqual({ ty: "is", s: "ab", ibi: 1 });
    expect(second?.ty).toBe("mlti");
    if (second?.ty !== "mlti") return;
    expect(second.mts[0]).toEqual({ ty: "ds", si: 1, ei: 1 });
  });
});

describe("decodeOperations — opaque placeholders", () => {
  test("decodes a known structure preserving position + revisionId", () => {
    const op = onlyOp(entry({ ty: "opaque", structure: "table", position: 7 }));
    expect(op).toEqual({
      ty: "opaque",
      structure: "table",
      position: 7,
      revisionId: 1 as never,
    });
  });

  test("degrades an unknown structure to UnknownOp", () => {
    const op = onlyOp(entry({ ty: "opaque", structure: "hologram", position: 2 }));
    expect(op.ty).toBe("unknown");
  });
});

describe("decodeOperations — unknown-op isolation + privacy (R5)", () => {
  test("UnknownOp carries opCode + byteLength only, never verbatim text", () => {
    const secret = "SENSITIVE_DOCUMENT_TEXT_42";
    const decoded = decodeOperations({
      changelog: [{ ty: "zz_future_op", payload: secret, revision_id: 9 }],
    });
    const op = decoded[0]?.operations[0];
    expect(op?.ty).toBe("unknown");
    if (op?.ty !== "unknown") return;
    expect(op.opCode).toBe("zz_future_op");
    expect(op.byteLength).toBeGreaterThan(0);
    expect(Object.keys(op).sort()).toEqual(["byteLength", "opCode", "revisionId", "ty"]);
    // The verbatim payload must not survive anywhere in the decoded output.
    expect(JSON.stringify(decoded)).not.toContain(secret);
  });

  test("degrades a known op with malformed fields to UnknownOp", () => {
    const op = onlyOp(entry({ ty: "is", s: "x" })); // missing ibi
    expect(op.ty).toBe("unknown");
    if (op.ty !== "unknown") return;
    expect(op.opCode).toBe("is");
  });

  test("handles a missing ty with a sentinel opCode", () => {
    const op = onlyOp(entry({ foo: "bar" }));
    expect(op.ty).toBe("unknown");
    if (op.ty !== "unknown") return;
    expect(op.opCode).toBe("(missing)");
  });

  test("degrades a delete-family op with a reversed range to UnknownOp", () => {
    const op = onlyOp(entry({ ty: "ds", si: 10, ei: 1 })); // si > ei
    expect(op.ty).toBe("unknown");
    if (op.ty !== "unknown") return;
    expect(op.opCode).toBe("ds");
  });

  test("degrades an mlti op with non-array mts to UnknownOp", () => {
    const op = onlyOp(entry({ ty: "mlti", mts: "not-array" }));
    expect(op.ty).toBe("unknown");
    if (op.ty !== "unknown") return;
    expect(op.opCode).toBe("mlti");
  });
});

describe("decodeOperations — revision metadata", () => {
  test("maps attribution + timing, defaulting absent fields to null", () => {
    const decoded = decodeOperations({
      changelog: [
        {
          ty: "is",
          s: "a",
          ibi: 1,
          revision_id: 5,
          user_id: "u-1",
          session_id: "s-1",
          time: 1718000000000,
        },
        { ty: "is", s: "b", ibi: 2 },
      ],
    });
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({
      userId: "u-1",
      sessionId: "s-1",
      time: 1718000000000,
    });
    // Second entry omits metadata: ids null, revisionId falls back to index+1.
    expect(decoded[1]?.userId).toBeNull();
    expect(decoded[1]?.sessionId).toBeNull();
    expect(decoded[1]?.time).toBeNull();
    expect(decoded[1]?.revisionId).toBe(2 as never);
  });

  test("returns no revisions for an unrecognized top-level shape", () => {
    expect(decodeOperations({ nope: true })).toEqual([]);
    expect(decodeOperations(null)).toEqual([]);
  });
});
