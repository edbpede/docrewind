// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { validateReviewOutput } from "./schema";
import type { ReviewOutput } from "./types";

function validOutput(): ReviewOutput {
  return {
    schema_version: "1.0",
    summary: "A short, valid summary describing the change conservatively.",
    should_post_review: true,
    review_event: "COMMENT",
    comments: [
      {
        path: "src/x.ts",
        line: 10,
        side: "RIGHT",
        body: "This looks risky.",
        severity: "high",
        category: "bug",
        confidence: 0.9,
        rationale: "explained",
      },
    ],
    dropped_or_uncertain_findings: [],
  };
}

describe("validateReviewOutput", () => {
  test("accepts a valid output", () => {
    const r = validateReviewOutput(validOutput());
    expect(r.ok).toBe(true);
  });

  test("accepts an empty comments array (zero findings is valid)", () => {
    const o = validOutput();
    o.comments = [];
    expect(validateReviewOutput(o).ok).toBe(true);
  });

  test("rejects a missing required field", () => {
    const o = validOutput() as unknown as Record<string, unknown>;
    delete o.summary;
    const r = validateReviewOutput(o);
    expect(r.ok).toBe(false);
  });

  test("rejects review_event other than COMMENT", () => {
    const o = validOutput() as unknown as Record<string, unknown>;
    o.review_event = "APPROVE";
    expect(validateReviewOutput(o).ok).toBe(false);
  });

  test("rejects more than 50 comments", () => {
    const o = validOutput();
    const one = o.comments[0];
    if (!one) throw new Error("fixture");
    o.comments = Array.from({ length: 51 }, () => ({ ...one }));
    expect(validateReviewOutput(o).ok).toBe(false);
  });

  test("rejects an unknown additional property", () => {
    const o = validOutput() as unknown as Record<string, unknown>;
    o.injected = "nope";
    expect(validateReviewOutput(o).ok).toBe(false);
  });

  test("rejects an out-of-range confidence", () => {
    const o = validOutput();
    const one = o.comments[0];
    if (!one) throw new Error("fixture");
    one.confidence = 2;
    expect(validateReviewOutput(o).ok).toBe(false);
  });
});
