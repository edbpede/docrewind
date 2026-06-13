// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import type { PrContext, ReviewComment, ReviewOutput, Severity } from "./types";
import { buildReviewFinal, isSuspiciousBody, type ValidateConfig } from "./validate";

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function cfg(over: Partial<ValidateConfig> = {}): ValidateConfig {
  return {
    severityThreshold: "medium",
    severityRank: SEVERITY_RANK,
    maxComments: 25,
    emptyReviewMode: "note",
    emptyReviewBody: "Review completed. No suggestions at this time.",
    botMarker: "<!-- docrewind-pr-reviewer -->",
    ...over,
  };
}

function context(over: Partial<PrContext> = {}): PrContext {
  return {
    diffed_sha: "sha1",
    pull_number: 1,
    repo: "o/r",
    title: "t",
    author: "a",
    body: "b",
    base_ref: "main",
    head_ref: "f",
    anchorable_files: [{ path: "src/x.ts", right: [10, 11, 12], left: [] }],
    existing_bot_comments: [],
    diff_truncated: false,
    truncated_paths: [],
    ...over,
  };
}

function comment(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: "src/x.ts",
    line: 10,
    side: "RIGHT",
    body: "Real issue.",
    severity: "high",
    category: "bug",
    confidence: 0.9,
    rationale: "r",
    ...over,
  };
}

function output(comments: ReviewComment[], over: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    schema_version: "1.0",
    summary: "Summary of the change.",
    should_post_review: true,
    review_event: "COMMENT",
    comments,
    dropped_or_uncertain_findings: [],
    ...over,
  };
}

describe("buildReviewFinal", () => {
  test("keeps an anchorable, above-threshold comment and appends the bot marker", () => {
    const f = buildReviewFinal(output([comment()]), context(), cfg());
    expect(f.should_post).toBe(true);
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]?.body).toContain("<!-- docrewind-pr-reviewer -->");
  });

  test("drops an unanchorable comment into the audit list (no snapping)", () => {
    const f = buildReviewFinal(output([comment({ line: 999 })]), context(), cfg());
    expect(f.comments).toHaveLength(0);
    expect(f.dropped_or_uncertain_findings.some((d) => d.reason.startsWith("anchor:"))).toBe(true);
  });

  test("drops a below-threshold finding", () => {
    const f = buildReviewFinal(output([comment({ severity: "low" })]), context(), cfg());
    expect(f.comments).toHaveLength(0);
    expect(f.dropped_or_uncertain_findings.some((d) => d.reason.includes("below_threshold"))).toBe(
      true,
    );
  });

  test("empty result in note mode posts the no-suggestions note", () => {
    const f = buildReviewFinal(output([]), context(), cfg());
    expect(f.should_post).toBe(true);
    expect(f.summary).toBe("Review completed. No suggestions at this time.");
    expect(f.comments).toHaveLength(0);
  });

  test("empty result in silent mode does not post", () => {
    const f = buildReviewFinal(output([]), context(), cfg({ emptyReviewMode: "silent" }));
    expect(f.should_post).toBe(false);
  });

  test("caps at maxComments and routes overflow to the audit list + summary note", () => {
    const many = [10, 11, 12].map((line) => comment({ line, body: `issue at ${line}` }));
    const f = buildReviewFinal(output(many), context(), cfg({ maxComments: 2 }));
    expect(f.comments).toHaveLength(2);
    expect(f.dropped_or_uncertain_findings.some((d) => d.reason === "over_max_comments")).toBe(
      true,
    );
    expect(f.summary).toContain("more lower-priority");
  });

  test("sorts by severity then confidence before capping", () => {
    const cs = [
      comment({ line: 10, severity: "medium", confidence: 0.5, body: "m" }),
      comment({ line: 11, severity: "critical", confidence: 0.6, body: "c" }),
    ];
    const f = buildReviewFinal(output(cs), context(), cfg({ maxComments: 1 }));
    expect(f.comments[0]?.line).toBe(11); // critical wins
  });

  test("dedupes against an existing bot comment", () => {
    const ctx = context({
      existing_bot_comments: [{ path: "src/x.ts", line: 10, body: "Real issue.", outdated: false }],
    });
    const f = buildReviewFinal(output([comment()]), ctx, cfg());
    expect(f.comments).toHaveLength(0);
  });

  test("drops a body carrying an injected secret", () => {
    const bad = comment({ body: "leak ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 here" });
    const f = buildReviewFinal(output([bad]), context(), cfg());
    expect(f.comments).toHaveLength(0);
    expect(f.dropped_or_uncertain_findings.some((d) => d.reason === "suspicious_body")).toBe(true);
  });

  test("adds a truncation note when the diff was truncated", () => {
    const ctx = context({ diff_truncated: true, truncated_paths: ["big.ts"] });
    const f = buildReviewFinal(output([comment()]), ctx, cfg());
    expect(f.summary).toContain("truncated");
  });
});

describe("isSuspiciousBody", () => {
  test("flags token-like strings, ignores normal prose", () => {
    expect(isSuspiciousBody("normal review text")).toBe(false);
    expect(isSuspiciousBody("AKIAIOSFODNN7EXAMPLE")).toBe(true);
  });
});
