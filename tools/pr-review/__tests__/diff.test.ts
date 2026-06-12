// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { buildAnchorIndex, isValidAnchor, sameHunk } from "../diff";
import { SAMPLE_PATCH } from "./helpers";

describe("buildAnchorIndex", () => {
  it("maps add/del/context lines to the correct sides", () => {
    const index = buildAnchorIndex([{ path: "a.ts", patch: SAMPLE_PATCH }]);
    const anchors = index.get("a.ts");
    expect(anchors).toBeDefined();
    if (!anchors) {
      return;
    }
    // +new2, +new3 -> RIGHT 2,3 ; -old2 -> LEFT 2 ; context on both (deprioritized).
    expect([...anchors.right].sort()).toEqual([2, 3]);
    expect([...anchors.left]).toEqual([2]);
    expect(anchors.rightContext.has(1)).toBe(true);
    expect(anchors.rightContext.has(4)).toBe(true);
    expect(anchors.leftContext.has(1)).toBe(true);
    expect(anchors.hunks).toHaveLength(1);
    expect(anchors.hunks[0]).toMatchObject({ newStart: 1, newLines: 4, oldStart: 1, oldLines: 3 });
  });

  it("skips files with no patch (binary/large)", () => {
    const index = buildAnchorIndex([{ path: "img.png", patch: undefined }]);
    expect(index.has("img.png")).toBe(false);
  });

  it("keys renamed files by the provided (new) path", () => {
    const index = buildAnchorIndex([{ path: "lib/new-name.ts", patch: SAMPLE_PATCH }]);
    expect(index.has("lib/new-name.ts")).toBe(true);
  });

  it("handles CRLF patches", () => {
    const crlf = SAMPLE_PATCH.split("\n").join("\r\n");
    const index = buildAnchorIndex([{ path: "a.ts", patch: crlf }]);
    expect(index.get("a.ts")?.right.has(2)).toBe(true);
  });

  it("handles multiple hunks", () => {
    const multi = [
      "@@ -1,1 +1,2 @@",
      " ctx",
      "+added-at-2",
      "@@ -10,1 +10,3 @@",
      " ctx10",
      "+added-at-11",
      "+added-at-12",
    ].join("\n");
    const anchors = buildAnchorIndex([{ path: "m.ts", patch: multi }]).get("m.ts");
    expect(anchors?.hunks).toHaveLength(2);
    expect(anchors?.right.has(2)).toBe(true);
    expect(anchors?.right.has(11)).toBe(true);
    expect(anchors?.right.has(12)).toBe(true);
  });
});

describe("isValidAnchor", () => {
  const anchors = buildAnchorIndex([{ path: "a.ts", patch: SAMPLE_PATCH }]).get("a.ts");

  it("accepts a real added line on RIGHT", () => {
    expect(anchors && isValidAnchor(anchors, 2, "RIGHT")).toBe(true);
  });

  it("accepts a deleted line on LEFT", () => {
    expect(anchors && isValidAnchor(anchors, 2, "LEFT")).toBe(true);
  });

  it("rejects a line that is not in the diff", () => {
    expect(anchors && isValidAnchor(anchors, 99, "RIGHT")).toBe(false);
  });

  it("discriminates by side: new line 4 is RIGHT context but absent on LEFT", () => {
    // The trailing context "line3" sits at new line 4 (RIGHT) but old line 3, so
    // line 4 is a valid RIGHT anchor yet not a valid LEFT anchor.
    expect(anchors && isValidAnchor(anchors, 4, "RIGHT")).toBe(true);
    expect(anchors && isValidAnchor(anchors, 4, "LEFT")).toBe(false);
  });
});

describe("sameHunk", () => {
  const anchors = buildAnchorIndex([{ path: "a.ts", patch: SAMPLE_PATCH }]).get("a.ts");

  it("accepts a range inside one hunk", () => {
    expect(anchors && sameHunk(anchors, 2, 3, "RIGHT")).toBe(true);
  });

  it("rejects a range spilling outside the hunk", () => {
    expect(anchors && sameHunk(anchors, 2, 50, "RIGHT")).toBe(false);
  });
});
