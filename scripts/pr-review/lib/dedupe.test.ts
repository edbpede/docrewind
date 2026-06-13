// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { computeDedupeKey, dedupeFindings, normalizeBody } from "./dedupe";
import type { ExistingComment, ReviewComment } from "./types";

function comment(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: "src/x.ts",
    line: 10,
    side: "RIGHT",
    body: "Possible null deref here.",
    severity: "high",
    category: "bug",
    confidence: 0.9,
    rationale: "r",
    ...over,
  };
}

describe("normalizeBody", () => {
  test("collapses whitespace, strips backticks, lowercases", () => {
    expect(normalizeBody("Use   `foo`\n\tBAR")).toBe("use foo bar");
  });
});

describe("computeDedupeKey", () => {
  test("is stable across cosmetic body differences (model ladder, M-C)", () => {
    const a = computeDedupeKey("src/x.ts", 10, "Use `foo` here");
    const b = computeDedupeKey("src/x.ts", 10, "use foo   here");
    expect(a).toBe(b);
  });

  test("differs by path and line", () => {
    expect(computeDedupeKey("a", 1, "x")).not.toBe(computeDedupeKey("a", 2, "x"));
    expect(computeDedupeKey("a", 1, "x")).not.toBe(computeDedupeKey("b", 1, "x"));
  });

  test("ignores the model's self-reported dedupe_key entirely", () => {
    // Two findings with different model dedupe_keys but identical content collapse.
    const c1 = comment({ dedupe_key: "model-key-1" });
    const c2 = comment({ dedupe_key: "model-key-2" });
    const r = dedupeFindings([c1, c2], []);
    expect(r.kept).toHaveLength(1);
  });
});

describe("dedupeFindings", () => {
  test("skips a finding matching a non-outdated existing bot comment", () => {
    const existing: ExistingComment[] = [
      { path: "src/x.ts", line: 10, body: "Possible NULL deref here.", outdated: false },
    ];
    const r = dedupeFindings([comment()], existing);
    expect(r.kept).toHaveLength(0);
    expect(r.skippedKeys).toHaveLength(1);
  });

  test("does NOT skip when the existing comment is outdated", () => {
    const existing: ExistingComment[] = [
      { path: "src/x.ts", line: 10, body: "Possible null deref here.", outdated: true },
    ];
    const r = dedupeFindings([comment()], existing);
    expect(r.kept).toHaveLength(1);
  });

  test("collapses duplicate findings within one batch", () => {
    const r = dedupeFindings([comment(), comment()], []);
    expect(r.kept).toHaveLength(1);
    expect(r.skippedKeys).toHaveLength(1);
  });
});
