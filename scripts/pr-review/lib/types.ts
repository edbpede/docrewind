// SPDX-License-Identifier: AGPL-3.0-or-later
//
// types.ts — shared shapes for the PR-review pipeline. These mirror the JSON
// schema (schema/review-output.base.schema.json) on the TypeScript side so the
// deterministic stages (validate, anchor, dedupe, post) share one vocabulary.
// The ajv validator (lib/schema.ts) remains the authority over untrusted model
// output; these types describe data that has already crossed that boundary.

export type Side = "LEFT" | "RIGHT";

/** Empty-review behaviour: post the no-suggestions note, or stay silent. */
export type EmptyReviewModeLike = "note" | "silent";

export type Severity = "low" | "medium" | "high" | "critical";

export type Category =
  | "bug"
  | "security"
  | "data_loss"
  | "concurrency"
  | "api_misuse"
  | "edge_case"
  | "confusing_behavior"
  | "doc_inconsistency";

/** A single inline finding as emitted by the model (post-schema-validation). */
export interface ReviewComment {
  path: string;
  line: number;
  side: Side;
  start_line?: number;
  start_side?: Side;
  body: string;
  severity: Severity;
  category: Category;
  confidence: number;
  rationale: string;
  /** Advisory only — the authoritative key is computed in lib/dedupe.ts. */
  dedupe_key?: string;
}

export interface DroppedFinding {
  path: string;
  line?: number;
  reason: string;
}

/** The full structured object the model produces (schema-validated). */
export interface ReviewOutput {
  schema_version: "1.0";
  summary: string;
  should_post_review: boolean;
  review_event: "COMMENT";
  comments: ReviewComment[];
  dropped_or_uncertain_findings: DroppedFinding[];
  model_used?: string;
  fallback_attempts?: number;
}

/** An existing review comment already posted by the bot (for dedupe). */
export interface ExistingComment {
  path: string;
  line: number | null;
  body: string;
  /** GitHub marks a comment outdated when later pushes move its lines. */
  outdated?: boolean;
}

/** Per-file anchor eligibility, persisted in pr-context.json. */
export interface FileAnchorRecord {
  path: string;
  right: number[];
  left: number[];
}

/** Collector output (Stage 1). All fields are UNTRUSTED data in Stage 2. */
export interface PrContext {
  /** SHA the diff + anchor index were built from. */
  diffed_sha: string;
  /** Advisory PR number — Stage 2 re-derives the authoritative value. */
  pull_number: number;
  repo: string;
  title: string;
  author: string;
  body: string;
  base_ref: string;
  head_ref: string;
  /** Files that have a patch (anchorable). Patch-less files are excluded. */
  anchorable_files: FileAnchorRecord[];
  existing_bot_comments: ExistingComment[];
  /** True when the diff was truncated to fit MAX_DIFF_BYTES. */
  diff_truncated: boolean;
  /** Paths omitted by truncation, for the summary note. */
  truncated_paths: string[];
}

/** Wrapper output (Stage 2, run-goose-review.ts). */
export interface ReviewRaw {
  ok: boolean;
  output?: ReviewOutput;
  reason?: string;
  model_used: string | null;
  fallback_attempts: number;
}

/** Trusted identity re-derived in verify-identity.ts (C3). */
export interface TrustedIdentity {
  pull_number: number;
  head_sha: string;
  repo: string;
}

/** The deterministic, postable comment shape sent to GitHub. */
export interface PostableComment {
  path: string;
  line: number;
  side: Side;
  start_line?: number;
  start_side?: Side;
  body: string;
}

/** Validator output (review-final.json). */
export interface ReviewFinal {
  should_post: boolean;
  event: "COMMENT";
  commit_id: string | null;
  summary: string;
  comments: PostableComment[];
  dropped_or_uncertain_findings: DroppedFinding[];
}
