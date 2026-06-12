// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { REVIEW_JSON_SCHEMA, reviewSchema } from "../schema";
import { makeComment } from "./helpers";

describe("reviewSchema", () => {
  const base = {
    summary: "Looks fine.",
    risk_level: "low" as const,
    review_decision: "comment" as const,
    comments: [makeComment()],
  };

  it("accepts a valid review object", () => {
    const result = reviewSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects a bad severity enum", () => {
    const result = reviewSchema.safeParse({
      ...base,
      comments: [makeComment({ severity: "blocker" as never })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bad risk_level enum", () => {
    const result = reviewSchema.safeParse({ ...base, risk_level: "extreme" as never });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    const result = reviewSchema.safeParse({
      ...base,
      comments: [makeComment({ confidence: 1.5 })],
    });
    expect(result.success).toBe(false);
  });

  it("accepts nullable start_line / start_side / suggested_fix", () => {
    const result = reviewSchema.safeParse({
      ...base,
      comments: [makeComment({ start_line: null, start_side: null, suggested_fix: null })],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { risk_level: _omit, ...withoutRisk } = base;
    const result = reviewSchema.safeParse(withoutRisk);
    expect(result.success).toBe(false);
  });
});

describe("REVIEW_JSON_SCHEMA", () => {
  it("is strict json_schema with additionalProperties:false (extra props rejected)", () => {
    expect(REVIEW_JSON_SCHEMA.type).toBe("json_schema");
    expect(REVIEW_JSON_SCHEMA.json_schema.strict).toBe(true);
    expect(REVIEW_JSON_SCHEMA.json_schema.schema.additionalProperties).toBe(false);
    expect(
      REVIEW_JSON_SCHEMA.json_schema.schema.properties.comments.items.additionalProperties,
    ).toBe(false);
  });
});
