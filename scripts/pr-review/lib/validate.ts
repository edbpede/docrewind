// SPDX-License-Identifier: AGPL-3.0-or-later
//
// validate.ts — the deterministic disposal stage (plan §9, §10, §12).
//
// Takes the model's (already schema-validated) output plus the trusted Stage-1
// context and decides what may actually post:
//   1. anchor-check every comment against the real diff; drop unanchorable
//      findings into the audit trail (never snap).
//   2. comment-body hygiene: drop bodies carrying injected secrets/abuse.
//   3. severity threshold (default medium+); below-threshold -> audit.
//   4. dedupe against existing bot comments and within the batch.
//   5. sort by (severity desc, confidence desc) and cap at MAX_COMMENTS, routing
//      overflow to the audit list with a one-line summary note.
//   6. empty result -> post the note (default) or stay silent, per config.
//
// Pure: the I/O wrapper (validate-review-output.ts) feeds it parsed JSON.

import { AnchorIndex } from "./anchors";
import { dedupeFindings } from "./dedupe";
import type {
  DroppedFinding,
  EmptyReviewModeLike,
  PostableComment,
  PrContext,
  ReviewComment,
  ReviewFinal,
  ReviewOutput,
  Severity,
} from "./types";

export interface ValidateConfig {
  severityThreshold: Severity;
  severityRank: Record<Severity, number>;
  maxComments: number;
  emptyReviewMode: EmptyReviewModeLike;
  emptyReviewBody: string;
  botMarker: string;
}

// Fake-secret / injected-credential patterns. A model body should never contain
// a real-looking token; if it does, it is injected content, not a finding.
const SUSPICIOUS_BODY =
  /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function isSuspiciousBody(body: string): boolean {
  return SUSPICIOUS_BODY.test(body);
}

function appendMarker(body: string, marker: string): string {
  return `${body}\n\n${marker}`;
}

function toPostable(c: ReviewComment, marker: string): PostableComment {
  const out: PostableComment = {
    path: c.path,
    line: c.line,
    side: c.side,
    body: appendMarker(c.body, marker),
  };
  if (c.start_line !== undefined && c.start_side !== undefined) {
    out.start_line = c.start_line;
    out.start_side = c.start_side;
  }
  return out;
}

/**
 * Build the final, postable review from model output + trusted context. Returns
 * review-final.json's shape. commit_id is set to the context's diffed SHA as an
 * advisory value; the poster overrides it with the trusted identity SHA.
 */
export function buildReviewFinal(
  output: ReviewOutput,
  context: PrContext,
  cfg: ValidateConfig,
): ReviewFinal {
  const index = new AnchorIndex(context.anchorable_files);
  const dropped: DroppedFinding[] = [...output.dropped_or_uncertain_findings];
  const threshold = cfg.severityRank[cfg.severityThreshold];

  // 1+2+3: anchor, hygiene, severity.
  const surviving: ReviewComment[] = [];
  for (const c of output.comments) {
    const verdict = index.validate(c);
    if (!verdict.ok) {
      dropped.push({ path: c.path, line: c.line, reason: `anchor:${verdict.reason}` });
      continue;
    }
    if (isSuspiciousBody(c.body)) {
      dropped.push({ path: c.path, line: c.line, reason: "suspicious_body" });
      continue;
    }
    if (cfg.severityRank[c.severity] < threshold) {
      dropped.push({ path: c.path, line: c.line, reason: `below_threshold:${c.severity}` });
      continue;
    }
    surviving.push(c);
  }

  // 4: dedupe against existing bot comments + within the batch.
  const { kept } = dedupeFindings(surviving, context.existing_bot_comments);

  // 5: sort by severity desc, confidence desc; cap; overflow -> audit.
  const sorted = [...kept].sort(
    (a, b) =>
      cfg.severityRank[b.severity] - cfg.severityRank[a.severity] || b.confidence - a.confidence,
  );
  const capped = sorted.slice(0, cfg.maxComments);
  const overflow = sorted.slice(cfg.maxComments);
  for (const c of overflow) {
    dropped.push({ path: c.path, line: c.line, reason: "over_max_comments" });
  }

  const comments = capped.map((c) => toPostable(c, cfg.botMarker));

  // 6: assemble summary + post decision.
  const notes: string[] = [];
  if (context.diff_truncated && context.truncated_paths.length > 0) {
    notes.push(
      `Note: the diff was truncated; ${context.truncated_paths.length} large file(s) were not reviewed.`,
    );
  }
  if (overflow.length > 0) {
    notes.push(`+${overflow.length} more lower-priority finding(s) omitted.`);
  }

  if (comments.length === 0) {
    if (cfg.emptyReviewMode === "silent") {
      return {
        should_post: false,
        event: "COMMENT",
        commit_id: context.diffed_sha,
        summary: "",
        comments: [],
        dropped_or_uncertain_findings: dropped,
      };
    }
    return {
      should_post: true,
      event: "COMMENT",
      commit_id: context.diffed_sha,
      summary: cfg.emptyReviewBody,
      comments: [],
      dropped_or_uncertain_findings: dropped,
    };
  }

  const summary = [output.summary, ...notes].join(" ").trim();
  return {
    should_post: true,
    event: "COMMENT",
    commit_id: context.diffed_sha,
    summary,
    comments,
    dropped_or_uncertain_findings: dropped,
  };
}

/** The result when the model produced nothing usable (raw.ok === false). */
export function emptyFailureFinal(context: PrContext, cfg: ValidateConfig): ReviewFinal {
  // Honor the maintainer decision: in `note` mode the run stays visible.
  if (cfg.emptyReviewMode === "silent") {
    return {
      should_post: false,
      event: "COMMENT",
      commit_id: context.diffed_sha,
      summary: "",
      comments: [],
      dropped_or_uncertain_findings: [],
    };
  }
  return {
    should_post: true,
    event: "COMMENT",
    commit_id: context.diffed_sha,
    summary: cfg.emptyReviewBody,
    comments: [],
    dropped_or_uncertain_findings: [],
  };
}
