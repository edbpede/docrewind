// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { buildAnchorIndex, parseFilePatch, parseUnifiedDiff } from "./diff";

describe("parseFilePatch", () => {
  test("single hunk: added + context land on RIGHT in new-file numbering", () => {
    // @@ -1,2 +1,3 @@ : line 1 context, line 2 added, line 3 context.
    const patch = ["@@ -1,2 +1,3 @@", " const a = 1;", "+const b = 2;", " const c = 3;"].join("\n");
    const fd = parseFilePatch("src/x.ts", patch);
    expect([...fd.rightLines].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    // context lines also anchor on LEFT in old-file numbering (1 and 2).
    expect([...fd.leftLines].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(fd.hunks).toHaveLength(1);
  });

  test("deletions anchor on LEFT in old-file numbering only", () => {
    const patch = ["@@ -10,3 +10,2 @@", " keep();", "-removeMe();", " tail();"].join("\n");
    const fd = parseFilePatch("a.ts", patch);
    // old: 10 keep, 11 removed, 12 tail -> LEFT {10,11,12}
    expect([...fd.leftLines].sort((a, b) => a - b)).toEqual([10, 11, 12]);
    // new: 10 keep, 11 tail -> RIGHT {10,11}
    expect([...fd.rightLines].sort((a, b) => a - b)).toEqual([10, 11]);
  });

  test("multi-hunk file accumulates both hunks", () => {
    const patch = ["@@ -1,1 +1,2 @@", " a", "+b", "@@ -50,1 +51,2 @@", " z", "+y"].join("\n");
    const fd = parseFilePatch("m.ts", patch);
    expect(fd.hunks).toHaveLength(2);
    expect(fd.rightLines.has(2)).toBe(true);
    expect(fd.rightLines.has(52)).toBe(true);
    // A line between the hunks is NOT eligible.
    expect(fd.rightLines.has(25)).toBe(false);
  });

  test("default-length hunk header (@@ -1 +1 @@) treated as len 1", () => {
    const fd = parseFilePatch("d.ts", ["@@ -1 +1 @@", "-old", "+new"].join("\n"));
    expect([...fd.rightLines]).toEqual([1]);
    expect([...fd.leftLines]).toEqual([1]);
  });

  test("'no newline at end of file' marker is ignored", () => {
    const fd = parseFilePatch(
      "n.ts",
      ["@@ -1 +1 @@", "+x", "\\ No newline at end of file"].join("\n"),
    );
    expect([...fd.rightLines]).toEqual([1]);
  });

  test("patch-less file (binary/oversized) yields empty anchor sets (C4)", () => {
    const fd = parseFilePatch("logo.png", undefined);
    expect(fd.rightLines.size).toBe(0);
    expect(fd.leftLines.size).toBe(0);
    expect(fd.hunks).toHaveLength(0);
  });
});

describe("parseUnifiedDiff (combined diff with headers)", () => {
  test("splits multiple files and keys by new path", () => {
    const diff = [
      "diff --git a/src/one.ts b/src/one.ts",
      "index 111..222 100644",
      "--- a/src/one.ts",
      "+++ b/src/one.ts",
      "@@ -1,1 +1,2 @@",
      " keep",
      "+added",
      "diff --git a/src/two.ts b/src/two.ts",
      "--- a/src/two.ts",
      "+++ b/src/two.ts",
      "@@ -5,1 +5,1 @@",
      "-gone",
      "+here",
    ].join("\n");
    const map = parseUnifiedDiff(diff);
    expect([...map.keys()].sort()).toEqual(["src/one.ts", "src/two.ts"]);
    expect(map.get("src/one.ts")?.rightLines.has(2)).toBe(true);
    expect(map.get("src/two.ts")?.leftLines.has(5)).toBe(true);
  });

  test("rename uses the new (b/) path", () => {
    const diff = [
      "diff --git a/old/name.ts b/new/name.ts",
      "--- a/old/name.ts",
      "+++ b/new/name.ts",
      "@@ -1 +1 @@",
      "+x",
    ].join("\n");
    const map = parseUnifiedDiff(diff);
    expect(map.has("new/name.ts")).toBe(true);
  });
});

describe("buildAnchorIndex", () => {
  test("emits sorted, JSON-friendly per-file arrays", () => {
    const a = parseFilePatch("b.ts", ["@@ -1 +1,2 @@", " x", "+y"].join("\n"));
    const b = parseFilePatch("a.ts", ["@@ -1 +1 @@", "+z"].join("\n"));
    const idx = buildAnchorIndex([a, b]);
    expect(idx.map((f) => f.path)).toEqual(["a.ts", "b.ts"]); // sorted
    expect(idx[1]?.right).toEqual([1, 2]);
  });
});
