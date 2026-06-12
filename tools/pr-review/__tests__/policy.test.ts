// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { DEFAULT_COMMENT_REVIEW_BODY, postedReviewBody, sanitizePostedText } from "../policy";

describe("sanitizePostedText", () => {
  it("removes think blocks and normalizes outer whitespace", () => {
    expect(sanitizePostedText("  Keep.\r\n<think>secret\nreasoning</think>\n\n\nNext.  \n")).toBe(
      "Keep.\n\nNext.",
    );
  });

  it("removes an unterminated think block through the end of the text", () => {
    expect(sanitizePostedText("Visible. <think>hidden\nreasoning")).toBe("Visible.");
  });

  it("guarantees non-empty grouped review bodies", () => {
    expect(postedReviewBody(" <think>only hidden</think> ")).toBe(DEFAULT_COMMENT_REVIEW_BODY);
  });
});
