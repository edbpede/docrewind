// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { buildReviewPayload, type PostFn, postReview, type ReviewPayload } from "./poster";
import type { ReviewFinal, TrustedIdentity } from "./types";

const identity: TrustedIdentity = { pull_number: 42, head_sha: "trusted-sha", repo: "o/r" };
const MARKER = "<!-- docrewind-pr-reviewer -->";

function final(over: Partial<ReviewFinal> = {}): ReviewFinal {
  return {
    should_post: true,
    event: "COMMENT",
    commit_id: "advisory-sha",
    summary: "Looks mostly good.",
    comments: [{ path: "src/x.ts", line: 10, side: "RIGHT", body: "issue" }],
    dropped_or_uncertain_findings: [],
    ...over,
  };
}

describe("buildReviewPayload", () => {
  test("always uses the trusted identity SHA as commit_id, not the advisory one", () => {
    const p = buildReviewPayload(final(), identity, MARKER);
    expect(p.commit_id).toBe("trusted-sha");
    expect(p.event).toBe("COMMENT");
    expect(p.body).toContain(MARKER);
    expect(p.comments).toHaveLength(1);
  });

  test("uses just the marker as body when summary is empty", () => {
    const p = buildReviewPayload(final({ summary: "" }), identity, MARKER);
    expect(p.body).toBe(MARKER);
  });
});

describe("postReview", () => {
  test("posts via the injected function and reports comments", () => {
    let captured: { repo: string; pull: number; payload: ReviewPayload } | null = null;
    const post: PostFn = (repo, pull, payload) => {
      captured = { repo, pull, payload };
    };
    const r = postReview(final(), identity, MARKER, post);
    expect(r).toEqual({ posted: true, reason: "review_with_comments" });
    expect(captured).not.toBeNull();
    const c = captured as { repo: string; pull: number } | null;
    expect(c?.repo).toBe("o/r");
    expect(c?.pull).toBe(42);
  });

  test("note-only review reports note_only", () => {
    const post: PostFn = () => {};
    const r = postReview(
      final({ comments: [], summary: "No suggestions." }),
      identity,
      MARKER,
      post,
    );
    expect(r).toEqual({ posted: true, reason: "note_only" });
  });

  test("should_post:false is a clean no-op (nothing posted)", () => {
    let called = false;
    const post: PostFn = () => {
      called = true;
    };
    const r = postReview(final({ should_post: false }), identity, MARKER, post);
    expect(r).toEqual({ posted: false, reason: "should_post_false" });
    expect(called).toBe(false);
  });
});
