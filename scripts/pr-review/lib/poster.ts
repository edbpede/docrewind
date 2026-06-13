// SPDX-License-Identifier: AGPL-3.0-or-later
//
// poster.ts — build the single GitHub review payload (plan §9).
//
// One atomic `POST /pulls/{n}/reviews` with `event: "COMMENT"` and a comments[]
// array. The commit_id is ALWAYS the trusted identity SHA (re-derived in
// verify-identity.ts), never the artifact's advisory value — this is the field
// that pins the review to the exact reviewed commit and upholds the C3 identity
// invariant at the mutation point. Pure builder + an injectable POST seam so the
// payload shape is unit-tested without touching GitHub.

import type { PostableComment, ReviewFinal, TrustedIdentity } from "./types";

export interface ReviewPayload {
  commit_id: string;
  body: string;
  event: "COMMENT";
  comments: PostableComment[];
}

/**
 * Build the review payload from the validated result + trusted identity. The
 * review body carries the hidden bot marker so future runs recognise our own
 * summary review. `event` is hard-coded COMMENT regardless of any other input
 * (belt-and-suspenders against approve/request-changes).
 */
export function buildReviewPayload(
  final: ReviewFinal,
  identity: TrustedIdentity,
  marker: string,
): ReviewPayload {
  const body = final.summary.trim().length > 0 ? `${final.summary}\n\n${marker}` : marker;
  return {
    commit_id: identity.head_sha,
    body,
    event: "COMMENT",
    comments: final.comments,
  };
}

export type PostFn = (repo: string, pullNumber: number, payload: ReviewPayload) => void;

export interface PostResult {
  posted: boolean;
  reason: string;
}

/**
 * Decide-and-post. Returns a structured result instead of throwing so the
 * workflow step never fails the PR. `should_post:false` is a clean no-op;
 * DRY_RUN routing is handled by the caller via the injected post function.
 */
export function postReview(
  final: ReviewFinal,
  identity: TrustedIdentity,
  marker: string,
  post: PostFn,
): PostResult {
  if (!final.should_post) return { posted: false, reason: "should_post_false" };
  const payload = buildReviewPayload(final, identity, marker);
  post(identity.repo, identity.pull_number, payload);
  return {
    posted: true,
    reason: payload.comments.length > 0 ? "review_with_comments" : "note_only",
  };
}
