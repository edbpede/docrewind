// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { buildReviewPayload } from "../github";
import { DEFAULT_COMMENT_REVIEW_BODY } from "../policy";
import type { PostComment } from "../validate";

describe("buildReviewPayload", () => {
  it("collapses to a summary-only COMMENT review when no comments survive", () => {
    const payload = buildReviewPayload("sha123", [], "All good.");
    expect(payload).toEqual({
      commit_id: "sha123",
      body: "All good.",
      event: "COMMENT",
      comments: [],
    });
  });

  it("uses the default summary body when the summary is empty", () => {
    const payload = buildReviewPayload("sha123", [], "   ");
    expect(payload.body).toBe(DEFAULT_COMMENT_REVIEW_BODY);
  });

  it("uses the default review body when a COMMENT review with comments has an empty summary", () => {
    const comment: PostComment = { path: "a.ts", line: 2, side: "RIGHT", body: "issue" };
    const payload = buildReviewPayload("sha123", [comment], "   ");
    expect(payload.body).toBe(DEFAULT_COMMENT_REVIEW_BODY);
    expect(payload.comments).toHaveLength(1);
  });

  it("sanitizes model-authored summary and inline comment text before posting", () => {
    const comment: PostComment = {
      path: "a.ts",
      line: 2,
      side: "RIGHT",
      body: "Visible <think>hidden comment reasoning</think> body",
    };

    const payload = buildReviewPayload(
      "sha123",
      [comment],
      "Summary <think>hidden summary reasoning</think> text",
    );

    expect(payload.body).toBe("Summary text");
    expect(payload.comments[0]?.body).toBe("Visible body");
    expect(JSON.stringify(payload)).not.toContain("<think>");
    expect(JSON.stringify(payload)).not.toContain("hidden");
  });

  it("maps single-line comments and omits start fields", () => {
    const comment: PostComment = { path: "a.ts", line: 2, side: "RIGHT", body: "issue" };
    const payload = buildReviewPayload("sha", [comment], "summary");
    expect(payload.event).toBe("COMMENT");
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]).toEqual({ path: "a.ts", line: 2, side: "RIGHT", body: "issue" });
    expect("start_line" in (payload.comments[0] ?? {})).toBe(false);
  });

  it("includes start_line/start_side for multi-line comments", () => {
    const comment: PostComment = {
      path: "a.ts",
      line: 3,
      side: "RIGHT",
      start_line: 2,
      start_side: "RIGHT",
      body: "range issue",
    };
    const payload = buildReviewPayload("sha", [comment], "summary");
    expect(payload.comments[0]).toMatchObject({ start_line: 2, start_side: "RIGHT" });
  });
});
