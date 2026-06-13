// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { AnchorIndex, isUnsafePath } from "./anchors";
import type { FileAnchorRecord } from "./types";

const files: FileAnchorRecord[] = [
  { path: "src/a.ts", right: [10, 11, 12], left: [10, 11] },
  { path: "src/b.ts", right: [1, 2, 3], left: [] },
];

const idx = new AnchorIndex(files);

describe("AnchorIndex.validate", () => {
  test("accepts an in-hunk RIGHT anchor", () => {
    expect(idx.validate({ path: "src/a.ts", line: 11, side: "RIGHT" })).toEqual({ ok: true });
  });

  test("accepts an in-hunk LEFT anchor", () => {
    expect(idx.validate({ path: "src/a.ts", line: 10, side: "LEFT" })).toEqual({ ok: true });
  });

  test("drops a line outside every hunk (no snapping)", () => {
    const v = idx.validate({ path: "src/a.ts", line: 99, side: "RIGHT" });
    expect(v).toEqual({ ok: false, reason: "line_outside_hunk" });
  });

  test("drops a path not in the changed set", () => {
    expect(idx.validate({ path: "src/missing.ts", line: 1, side: "RIGHT" })).toEqual({
      ok: false,
      reason: "path_not_in_changed_set",
    });
  });

  test("drops a RIGHT anchor that only exists on the LEFT side", () => {
    // src/b.ts has no LEFT lines; asking LEFT:1 must fail.
    expect(idx.validate({ path: "src/b.ts", line: 1, side: "LEFT" })).toEqual({
      ok: false,
      reason: "line_outside_hunk",
    });
  });

  describe("multi-line ranges", () => {
    test("accepts same-side ascending range fully in-hunk", () => {
      expect(
        idx.validate({
          path: "src/a.ts",
          line: 12,
          side: "RIGHT",
          start_line: 10,
          start_side: "RIGHT",
        }),
      ).toEqual({ ok: true });
    });

    test("rejects mismatched sides", () => {
      expect(
        idx.validate({
          path: "src/a.ts",
          line: 12,
          side: "RIGHT",
          start_line: 10,
          start_side: "LEFT",
        }),
      ).toEqual({ ok: false, reason: "multiline_side_mismatch" });
    });

    test("rejects start_line after end line", () => {
      expect(
        idx.validate({
          path: "src/a.ts",
          line: 10,
          side: "RIGHT",
          start_line: 12,
          start_side: "RIGHT",
        }),
      ).toEqual({ ok: false, reason: "multiline_start_after_end" });
    });

    test("rejects a start endpoint outside the hunk", () => {
      expect(
        idx.validate({
          path: "src/a.ts",
          line: 12,
          side: "RIGHT",
          start_line: 5,
          start_side: "RIGHT",
        }),
      ).toEqual({ ok: false, reason: "multiline_start_outside_hunk" });
    });

    test("rejects an incomplete range (start_line without start_side)", () => {
      expect(idx.validate({ path: "src/a.ts", line: 12, side: "RIGHT", start_line: 10 })).toEqual({
        ok: false,
        reason: "incomplete_multiline_range",
      });
    });
  });

  test("rejects path traversal before any index lookup", () => {
    expect(idx.validate({ path: "../etc/passwd", line: 10, side: "RIGHT" })).toEqual({
      ok: false,
      reason: "unsafe_path",
    });
  });
});

describe("isUnsafePath", () => {
  test.each([
    ["", true],
    ["/etc/passwd", true],
    ["../x", true],
    ["a/../../b", true],
    ["src/ok.ts", false],
    ["deep/nested/ok.ts", false],
  ])("isUnsafePath(%p) === %p", (p, expected) => {
    expect(isUnsafePath(p as string)).toBe(expected);
  });
});
