// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Single source of truth for the review output contract (plan §7). Two
// representations are kept deliberately in lock-step:
//
//   1. `REVIEW_JSON_SCHEMA` — a JSON Schema object handed to NanoGPT via
//      `response_format: { type: "json_schema", strict: true }`. This is a *hint*
//      to the model, not a guarantee: NanoGPT returns the payload as a JSON
//      *string* and auto-rewrites optional props to nullable for OpenAI
//      compatibility, so `strict` is effectively advisory.
//   2. `reviewSchema` — the Zod schema that actually *gates* every response. This
//      is the load-bearing validator; the model's structured-output mode is not
//      trusted on its own.
//
// Keep the two in sync by hand. The enums below are the canonical severity /
// category / side vocabularies referenced by prompt.ts and validate.ts.

import { z } from "zod";

/** Severity ranking, ordered critical (highest) -> low (lowest). */
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Finding categories, including docrewind-specific concerns (privacy, etc.). */
export const CATEGORIES = [
  "bug",
  "security",
  "data-loss",
  "concurrency",
  "auth",
  "api-contract",
  "error-handling",
  "performance",
  "privacy",
  "docs",
  "maintainability",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Diff side: RIGHT = added/modified (new file), LEFT = deleted (old file). */
export const SIDES = ["RIGHT", "LEFT"] as const;
export type Side = (typeof SIDES)[number];

/** Whole-PR risk band reported in the summary. */
export const RISK_LEVELS = ["none", "low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Whether the model decided to post inline comments at all. */
export const REVIEW_DECISIONS = ["comment", "no_comment"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Hard limits mirrored between the JSON Schema and Zod. */
export const LIMITS = {
  summaryMax: 600,
  bodyMax: 1500,
  whyMax: 400,
  suggestedFixMax: 800,
  /** Model-side soft cap on returned comments; validate.ts applies the hard cap. */
  commentsMax: 20,
} as const;

/** Zod schema for a single proposed inline comment. */
export const reviewCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().min(1),
  side: z.enum(SIDES),
  start_line: z.number().int().min(1).nullable(),
  start_side: z.enum(SIDES).nullable(),
  body: z.string().min(1).max(LIMITS.bodyMax),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  why_it_matters: z.string().max(LIMITS.whyMax),
  suggested_fix: z.string().max(LIMITS.suggestedFixMax).nullable(),
  uses_suggestion_block: z.boolean(),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

/** Zod schema for the whole model response. The real validation gate (§7/§10). */
export const reviewSchema = z.object({
  summary: z.string().max(LIMITS.summaryMax),
  risk_level: z.enum(RISK_LEVELS),
  review_decision: z.enum(REVIEW_DECISIONS),
  comments: z.array(reviewCommentSchema).max(LIMITS.commentsMax),
});
export type Review = z.infer<typeof reviewSchema>;

/**
 * JSON Schema passed to NanoGPT's `response_format`. Mirrors `reviewSchema`.
 * `additionalProperties: false` + every field `required` is the OpenAI
 * strict-mode convention (optional fields are expressed as nullable unions).
 */
export const REVIEW_JSON_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "pr_review",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "risk_level", "review_decision", "comments"],
      properties: {
        summary: { type: "string", maxLength: LIMITS.summaryMax },
        risk_level: { type: "string", enum: [...RISK_LEVELS] },
        review_decision: { type: "string", enum: [...REVIEW_DECISIONS] },
        comments: {
          type: "array",
          maxItems: LIMITS.commentsMax,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "path",
              "line",
              "side",
              "start_line",
              "start_side",
              "body",
              "severity",
              "category",
              "confidence",
              "why_it_matters",
              "suggested_fix",
              "uses_suggestion_block",
            ],
            properties: {
              path: { type: "string" },
              line: { type: "integer", minimum: 1 },
              side: { type: "string", enum: [...SIDES] },
              start_line: { type: ["integer", "null"], minimum: 1 },
              start_side: { type: ["string", "null"], enum: [...SIDES, null] },
              body: { type: "string", maxLength: LIMITS.bodyMax },
              severity: { type: "string", enum: [...SEVERITIES] },
              category: { type: "string", enum: [...CATEGORIES] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              why_it_matters: { type: "string", maxLength: LIMITS.whyMax },
              suggested_fix: { type: ["string", "null"], maxLength: LIMITS.suggestedFixMax },
              uses_suggestion_block: { type: "boolean" },
            },
          },
        },
      },
    },
  },
} as const;

/** Numeric rank for a severity (lower = more severe), for stable sorting. */
export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}
