// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import type { ChangedFile } from "../github";
import {
  DIFF_CHAR_BUDGET,
  filterFiles,
  globToRegExp,
  isSecuritySensitive,
  matchesAnyGlob,
  selectWithinBudget,
} from "../main";

function file(path: string, patchLen = 10): ChangedFile {
  return {
    path,
    status: "modified",
    patch: "x".repeat(patchLen),
    additions: 1,
    deletions: 0,
  };
}

describe("globToRegExp / matchesAnyGlob", () => {
  it("matches **/*.ext at any depth", () => {
    expect(globToRegExp("**/*.png").test("a/b/c.png")).toBe(true);
    expect(globToRegExp("**/*.png").test("c.png")).toBe(true);
    expect(globToRegExp("**/*.png").test("c.jpg")).toBe(false);
  });

  it("matches a root-only literal", () => {
    expect(globToRegExp("bun.lock").test("bun.lock")).toBe(true);
    expect(globToRegExp("bun.lock").test("nested/bun.lock")).toBe(false);
  });

  it("matches a directory prefix glob", () => {
    expect(matchesAnyGlob("dist/x/y.js", ["dist/**"])).toBe(true);
    expect(matchesAnyGlob("src/x.js", ["dist/**"])).toBe(false);
  });

  it("does not let * cross a path separator", () => {
    expect(globToRegExp("lib/*.ts").test("lib/a.ts")).toBe(true);
    expect(globToRegExp("lib/*.ts").test("lib/sub/a.ts")).toBe(false);
  });
});

describe("isSecuritySensitive", () => {
  it("flags the always-include areas", () => {
    expect(isSecuritySensitive("entrypoints/background.ts")).toBe(true);
    expect(isSecuritySensitive("lib/protocol/parse.ts")).toBe(true);
    expect(isSecuritySensitive("lib/retrieval/run.ts")).toBe(true);
    expect(isSecuritySensitive("lib/db.ts")).toBe(true);
    expect(isSecuritySensitive("lib/timeline/x.ts")).toBe(false);
  });
});

describe("filterFiles", () => {
  it("excludes generated/lockfile and binary (missing-patch) files", () => {
    const files: ChangedFile[] = [
      file("lib/a.ts"),
      file("bun.lock"),
      { path: "icon.png", status: "added", patch: undefined, additions: 0, deletions: 0 },
    ];
    const kept = filterFiles(files, ["bun.lock", "**/*.png"], []);
    expect(kept.map((f) => f.path)).toEqual(["lib/a.ts"]);
  });

  it("respects an include allowlist when provided", () => {
    const files = [file("lib/a.ts"), file("docs/readme.md")];
    const kept = filterFiles(files, [], ["lib/**"]);
    expect(kept.map((f) => f.path)).toEqual(["lib/a.ts"]);
  });
});

describe("selectWithinBudget", () => {
  it("keeps everything when under budget", () => {
    const files = [file("lib/a.ts"), file("lib/b.ts")];
    const result = selectWithinBudget(files, DIFF_CHAR_BUDGET);
    expect(result.selected).toHaveLength(2);
    expect(result.capped).toBe(false);
  });

  it("always includes security-sensitive files and caps the rest", () => {
    const files = [
      file("lib/protocol/p.ts", 50),
      file("lib/timeline/big.ts", 200),
      file("lib/timeline/small.ts", 30),
    ];
    // Budget admits the security file + the small one, but not the big one.
    const result = selectWithinBudget(files, 100);
    const paths = result.selected.map((f) => f.path);
    expect(paths).toContain("lib/protocol/p.ts");
    expect(paths).toContain("lib/timeline/small.ts");
    expect(paths).not.toContain("lib/timeline/big.ts");
    expect(result.capped).toBe(true);
  });

  it("includes a security file even if it alone exceeds the budget", () => {
    const files = [file("lib/db.ts", 500)];
    const result = selectWithinBudget(files, 100);
    expect(result.selected.map((f) => f.path)).toEqual(["lib/db.ts"]);
    expect(result.capped).toBe(false);
  });
});
