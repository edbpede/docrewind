// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import type { PrMeta } from "./context";
import { buildPrContext, type RawFile, reconstructFileBlock } from "./context";

const meta: PrMeta = {
  title: "Add retry",
  author: "alice",
  body: "body",
  base_ref: "main",
  head_ref: "feature",
};

const base = {
  meta,
  existingComments: [],
  repo: "o/r",
  pullNumber: 7,
  diffedSha: "abc123",
  maxDiffBytes: 1_000_000,
  botMarker: "<!-- docrewind-pr-reviewer -->",
  botLogin: "github-actions[bot]",
};

describe("buildPrContext", () => {
  test("builds the anchorable set from patched files only (C4)", () => {
    const files: RawFile[] = [
      { filename: "src/a.ts", status: "modified", patch: ["@@ -1 +1,2 @@", " x", "+y"].join("\n") },
      { filename: "logo.png", status: "added", patch: null }, // binary, no patch
    ];
    const { context, diffText } = buildPrContext({ ...base, files });
    expect(context.anchorable_files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(diffText).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(diffText).not.toContain("logo.png");
    expect(context.diff_truncated).toBe(false);
  });

  test("truncates by dropping the largest file when over budget", () => {
    const big = `@@ -1 +1,200 @@\n${Array.from({ length: 200 }, (_, i) => `+line ${i}`).join("\n")}`;
    const small = "@@ -1 +1,1 @@\n+tiny";
    const files: RawFile[] = [
      { filename: "big.ts", status: "modified", patch: big },
      { filename: "small.ts", status: "modified", patch: small },
    ];
    const { context, diffText } = buildPrContext({ ...base, files, maxDiffBytes: 200 });
    expect(context.diff_truncated).toBe(true);
    expect(context.truncated_paths).toContain("big.ts");
    expect(diffText).toContain("small.ts");
    expect(context.anchorable_files.map((f) => f.path)).toEqual(["small.ts"]);
  });

  test("recognises our own comments by hidden marker", () => {
    const { context } = buildPrContext({
      ...base,
      files: [],
      existingComments: [
        {
          path: "a.ts",
          line: 5,
          body: "keep <!-- docrewind-pr-reviewer -->",
          user: { login: "x" },
        },
        { path: "a.ts", line: 6, body: "someone else", user: { login: "human" } },
      ],
    });
    expect(context.existing_bot_comments).toHaveLength(1);
    expect(context.existing_bot_comments[0]?.line).toBe(5);
  });

  test("recognises our own comments by bot login when marker absent", () => {
    const { context } = buildPrContext({
      ...base,
      files: [],
      existingComments: [
        { path: "a.ts", line: 5, body: "legacy", user: { login: "github-actions[bot]" } },
      ],
    });
    expect(context.existing_bot_comments).toHaveLength(1);
  });

  test("marks line-null existing comments outdated", () => {
    const { context } = buildPrContext({
      ...base,
      files: [],
      existingComments: [
        {
          path: "a.ts",
          line: null,
          original_line: 9,
          body: "x <!-- docrewind-pr-reviewer -->",
          user: { login: "b" },
        },
      ],
    });
    expect(context.existing_bot_comments[0]).toMatchObject({ line: 9, outdated: true });
  });
});

describe("reconstructFileBlock", () => {
  test("wraps a bare patch with git headers", () => {
    const block = reconstructFileBlock("src/x.ts", "@@ -1 +1 @@\n+a");
    expect(block.startsWith("diff --git a/src/x.ts b/src/x.ts")).toBe(true);
    expect(block).toContain("+++ b/src/x.ts");
  });
});
