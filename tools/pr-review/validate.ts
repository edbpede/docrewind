// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Deterministic post-processing of the model's review (plan §7 step list). The
// model's structured output is advisory; this pipeline is what actually decides
// what gets posted. Applied in order:
//   1. confidence gate (< REVIEW_MIN_CONFIDENCE -> drop)
//   2. anchor validation against the parsed diff (invalid (path,line,side) -> drop;
//      invalid multi-line start -> demote to single-line)
//   3. build the display body: strip chain-of-thought, fold "why it matters" +
//      optional "suggested" into the body, apply the suggestion-block policy,
//      truncate safely
//   4. dedupe against prior bot comments and within the batch (fingerprint)
//   5. sort by severity then confidence, cap to REVIEW_MAX_COMMENTS
//   6. embed the hidden dedupe marker
//
// Everything that drops a comment records a reason for the sanitized summary log.

import { dropDuplicates, withMarker } from "./dedupe";
import { type AnchorIndex, isValidAnchor, sameHunk } from "./diff";
import { type Review, type ReviewComment, type Side, severityRank } from "./schema";

/** A comment ready to send to GitHub's create-review API. */
export interface PostComment {
  readonly path: string;
  readonly line: number;
  readonly side: Side;
  readonly start_line?: number;
  readonly start_side?: Side;
  readonly body: string;
}

export interface DropReason {
  readonly path: string;
  readonly line: number;
  readonly reason: string;
}

export interface ValidationResult {
  readonly comments: readonly PostComment[];
  readonly drops: readonly DropReason[];
}

export interface ValidateOptions {
  readonly anchors: AnchorIndex;
  readonly minConfidence: number;
  readonly maxComments: number;
  readonly allowSuggestions: boolean;
  readonly priorFingerprints: ReadonlySet<string>;
}

/** Remove any chain-of-thought leakage before a body is posted. */
function stripThink(body: string): string {
  return body.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Convert ```suggestion fences to plain code when suggestions are disabled. */
function applySuggestionPolicy(body: string, allow: boolean): string {
  if (allow) {
    return body;
  }
  return body.replace(/```suggestion/gi, "```");
}

/** Truncate to `max` chars without leaving a dangling/unclosed code fence. */
function safeTruncate(body: string, max: number): string {
  if (body.length <= max) {
    return body;
  }
  let cut = `${body.slice(0, max - 1)}…`;
  const fenceCount = (cut.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    cut = `${cut}\n\`\`\``;
  }
  return cut;
}

/** Fold the model's structured fields into one Markdown comment body. */
function buildBody(comment: ReviewComment, allowSuggestions: boolean): string {
  const parts = [stripThink(comment.body)];
  if (comment.why_it_matters.trim()) {
    parts.push(`**Why it matters:** ${comment.why_it_matters.trim()}`);
  }
  if (comment.suggested_fix?.trim()) {
    parts.push(`**Suggested:**\n${comment.suggested_fix.trim()}`);
  }
  const folded = applySuggestionPolicy(parts.join("\n\n"), allowSuggestions);
  return safeTruncate(folded, 1400);
}

/**
 * Validate a comment's anchor against the diff. Returns the anchor fields to use
 * (possibly demoted to single-line), or null if it cannot be anchored at all.
 */
function resolveAnchor(
  comment: ReviewComment,
  anchors: AnchorIndex,
): { line: number; side: Side; start?: { line: number; side: Side } } | null {
  const fileAnchors = anchors.get(comment.path);
  if (!fileAnchors) {
    return null;
  }
  if (!isValidAnchor(fileAnchors, comment.line, comment.side)) {
    return null;
  }

  // Multi-line: keep only if start is valid, on the same side, before the end,
  // and within the same hunk. Otherwise demote to a single-line comment.
  if (
    comment.start_line !== null &&
    comment.start_side !== null &&
    comment.start_side === comment.side &&
    comment.start_line < comment.line &&
    isValidAnchor(fileAnchors, comment.start_line, comment.start_side) &&
    sameHunk(fileAnchors, comment.start_line, comment.line, comment.side)
  ) {
    return {
      line: comment.line,
      side: comment.side,
      start: { line: comment.start_line, side: comment.start_side },
    };
  }
  return { line: comment.line, side: comment.side };
}

/** Run the full post-processing pipeline over a parsed review. */
export function processReview(review: Review, options: ValidateOptions): ValidationResult {
  const drops: DropReason[] = [];

  // 1 + 2 + 3: gate, anchor, build body.
  type Staged = { post: PostComment; comment: ReviewComment };
  const staged: Staged[] = [];

  for (const comment of review.comments) {
    if (comment.confidence < options.minConfidence) {
      drops.push({
        path: comment.path,
        line: comment.line,
        reason: `low-confidence (${comment.confidence} < ${options.minConfidence})`,
      });
      continue;
    }

    const anchor = resolveAnchor(comment, options.anchors);
    if (!anchor) {
      drops.push({ path: comment.path, line: comment.line, reason: "invalid-anchor" });
      continue;
    }

    const body = buildBody(comment, options.allowSuggestions);
    const post: PostComment = anchor.start
      ? {
          path: comment.path,
          line: anchor.line,
          side: anchor.side,
          start_line: anchor.start.line,
          start_side: anchor.start.side,
          body,
        }
      : { path: comment.path, line: anchor.line, side: anchor.side, body };

    staged.push({ post, comment });
  }

  // 4: dedupe (fingerprint over path/line/side/body) vs prior + within batch.
  const deduped = dropDuplicates(
    staged.map((s) => ({ ...s.post, _comment: s.comment })),
    options.priorFingerprints,
  );
  const beforeDedupe = staged.length;
  if (deduped.length < beforeDedupe) {
    // Record which ones collapsed for the summary (best-effort, by difference).
    const keptKeys = new Set(deduped.map((d) => `${d.comment.path}:${d.comment.line}`));
    for (const s of staged) {
      const key = `${s.post.path}:${s.post.line}`;
      if (!keptKeys.has(key)) {
        drops.push({ path: s.post.path, line: s.post.line, reason: "duplicate" });
      }
    }
  }

  // 5: sort by severity (critical first) then confidence desc, cap.
  const ranked = deduped
    .map((d) => ({ post: d.comment, fp: d.fp, src: d.comment._comment }))
    .sort((a, b) => {
      const sev = severityRank(a.src.severity) - severityRank(b.src.severity);
      return sev !== 0 ? sev : b.src.confidence - a.src.confidence;
    });

  const overCap = ranked.slice(options.maxComments);
  for (const item of overCap) {
    drops.push({ path: item.post.path, line: item.post.line, reason: "over-cap" });
  }
  const capped = ranked.slice(0, options.maxComments);

  // 6: embed the hidden dedupe marker into the final body.
  const comments: PostComment[] = capped.map((item) => {
    const { _comment, ...post } = item.post;
    return { ...post, body: withMarker(post.body, item.fp) };
  });

  return { comments, drops };
}
