// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared test fixtures and stubs (no network). Not a test file itself.

import type { Logger } from "../logger";
import type { ReviewComment } from "../schema";

/** A Logger that swallows output, for tests that don't assert on logs. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  redact: (value) => value,
};

/** A representative GitHub `patch` for one file (4 new lines, 1 deletion). */
export const SAMPLE_PATCH = ["@@ -1,3 +1,4 @@", " line1", "-old2", "+new2", "+new3", " line3"].join(
  "\n",
);

/** Build a fully-populated ReviewComment, overriding only what a test needs. */
export function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: "lib/example.ts",
    line: 2,
    side: "RIGHT",
    start_line: null,
    start_side: null,
    body: "Possible null dereference here.",
    severity: "high",
    category: "bug",
    confidence: 0.9,
    why_it_matters: "Could crash at runtime.",
    suggested_fix: null,
    uses_suggestion_block: false,
    ...overrides,
  };
}
