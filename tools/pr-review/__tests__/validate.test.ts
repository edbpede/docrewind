// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { buildAnchorIndex } from "../diff";
import type { Review } from "../schema";
import { processReview, type ValidateOptions } from "../validate";
import { makeComment, SAMPLE_PATCH } from "./helpers";

const anchors = buildAnchorIndex([{ path: "a.ts", patch: SAMPLE_PATCH }]);

function options(overrides: Partial<ValidateOptions> = {}): ValidateOptions {
  return {
    anchors,
    minConfidence: 0.75,
    maxComments: 5,
    allowSuggestions: false,
    priorFingerprints: new Set(),
    ...overrides,
  };
}

function review(comments: Review["comments"]): Review {
  return { summary: "s", risk_level: "low", review_decision: "comment", comments };
}

describe("processReview", () => {
  it("drops low-confidence comments", () => {
    const result = processReview(
      review([makeComment({ path: "a.ts", line: 2, confidence: 0.4 })]),
      options(),
    );
    expect(result.comments).toHaveLength(0);
    expect(result.drops[0]?.reason).toContain("low-confidence");
  });

  it("drops comments whose anchor is not in the diff", () => {
    const result = processReview(review([makeComment({ path: "a.ts", line: 999 })]), options());
    expect(result.comments).toHaveLength(0);
    expect(result.drops[0]?.reason).toBe("invalid-anchor");
  });

  it("drops comments on an unknown file", () => {
    const result = processReview(review([makeComment({ path: "ghost.ts", line: 2 })]), options());
    expect(result.comments).toHaveLength(0);
  });

  it("keeps a valid anchored comment and embeds the dedupe marker", () => {
    const result = processReview(review([makeComment({ path: "a.ts", line: 2 })]), options());
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.body).toContain("docrewind-ai-review:v1:fp=");
    expect(result.comments[0]?.body).toContain("Why it matters");
  });

  it("keeps a valid same-hunk multi-line anchor", () => {
    const result = processReview(
      review([makeComment({ path: "a.ts", line: 3, start_line: 2, start_side: "RIGHT" })]),
      options(),
    );
    expect(result.comments[0]?.start_line).toBe(2);
    expect(result.comments[0]?.start_side).toBe("RIGHT");
  });

  it("demotes an invalid multi-line start to single-line", () => {
    const result = processReview(
      review([makeComment({ path: "a.ts", line: 2, start_line: 999, start_side: "RIGHT" })]),
      options(),
    );
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.start_line).toBeUndefined();
  });

  it("caps to maxComments and records over-cap drops", () => {
    const many = [2, 3].flatMap((line) =>
      [0.95, 0.9].map((confidence, idx) =>
        makeComment({ path: "a.ts", line, confidence, body: `issue ${line}-${idx}` }),
      ),
    );
    const result = processReview(review(many), options({ maxComments: 1 }));
    expect(result.comments).toHaveLength(1);
    expect(result.drops.some((d) => d.reason === "over-cap")).toBe(true);
  });

  it("sorts critical findings ahead of lower severities", () => {
    const result = processReview(
      review([
        makeComment({ path: "a.ts", line: 2, severity: "low", body: "low one" }),
        makeComment({ path: "a.ts", line: 3, severity: "critical", body: "critical one" }),
      ]),
      options({ maxComments: 1 }),
    );
    expect(result.comments[0]?.body).toContain("critical one");
  });

  it("drops comments already posted (prior fingerprint)", () => {
    const first = processReview(review([makeComment({ path: "a.ts", line: 2 })]), options());
    const body = first.comments[0]?.body ?? "";
    const fp = /fp=([0-9a-f]+)/.exec(body)?.[1] ?? "";
    const result = processReview(
      review([makeComment({ path: "a.ts", line: 2 })]),
      options({ priorFingerprints: new Set([fp]) }),
    );
    expect(result.comments).toHaveLength(0);
    expect(result.drops.some((d) => d.reason === "duplicate")).toBe(true);
  });

  it("strips think blocks from every posted model-authored comment field", () => {
    const result = processReview(
      review([
        makeComment({
          path: "a.ts",
          line: 2,
          body: "Visible body. <think>hidden body reasoning</think>",
          why_it_matters: "Visible why. <think>hidden why reasoning</think>",
          suggested_fix: "Visible fix. <think>hidden fix reasoning</think>",
        }),
      ]),
      options(),
    );

    const body = result.comments[0]?.body ?? "";
    expect(body).toContain("Visible body.");
    expect(body).toContain("Visible why.");
    expect(body).toContain("Visible fix.");
    expect(body).not.toContain("<think>");
    expect(body).not.toContain("hidden body reasoning");
    expect(body).not.toContain("hidden why reasoning");
    expect(body).not.toContain("hidden fix reasoning");
  });

  it("converts suggestion blocks to plain fences when disabled", () => {
    const result = processReview(
      review([
        makeComment({
          path: "a.ts",
          line: 2,
          body: "Fix:\n```suggestion\nconst y = 2;\n```",
        }),
      ]),
      options({ allowSuggestions: false }),
    );
    expect(result.comments[0]?.body).not.toContain("```suggestion");
  });
});
