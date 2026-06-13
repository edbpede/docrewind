// SPDX-License-Identifier: AGPL-3.0-or-later
//
// post-github-review.ts — Stage 2 poster (plan §9, §11). Reads review-final.json
// + identity.json and posts exactly one COMMENT review via `gh api`, using the
// TRUSTED identity SHA/number (never the artifact's). DRY_RUN=1 prints the
// payload instead of posting. Never throws uncaught: the workflow step runs with
// continue-on-error, and a missing identity (verify-identity failed closed)
// simply posts nothing.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_MARKER } from "./lib/config";
import { gh } from "./lib/gh";
import { type PostFn, postReview, type ReviewPayload } from "./lib/poster";
import type { ReviewFinal, TrustedIdentity } from "./lib/types";

/** Post via `gh api -X POST .../reviews --input -` (payload on stdin). */
const ghPost: PostFn = (repo, pullNumber, payload: ReviewPayload) => {
  const args = [
    "api",
    "-X",
    "POST",
    `repos/${repo}/pulls/${pullNumber}/reviews`,
    "-H",
    "Accept: application/vnd.github+json",
    "--input",
    "-",
  ];
  // The JSON payload is fed on stdin (gh `--input -`), never interpolated into
  // argv — no shell, no injection surface from untrusted comment bodies.
  gh(args, { input: JSON.stringify(payload) });
};

const dryRunPost: PostFn = (repo, pullNumber, payload) => {
  console.log(`[post-github-review] DRY_RUN — would POST to ${repo}#${pullNumber}:`);
  console.log(JSON.stringify(payload, null, 2));
};

export async function main(): Promise<void> {
  const dir = process.env.OUT_DIR ?? process.cwd();
  const identityPath = join(dir, "identity.json");
  if (!existsSync(identityPath)) {
    console.error(
      "[post-github-review] no identity.json (identity failed closed) — posting nothing.",
    );
    return;
  }
  const identity = JSON.parse(readFileSync(identityPath, "utf8")) as TrustedIdentity;
  const final = JSON.parse(readFileSync(join(dir, "review-final.json"), "utf8")) as ReviewFinal;

  const post = process.env.DRY_RUN === "1" ? dryRunPost : ghPost;
  const result = postReview(final, identity, BOT_MARKER, post);
  console.log(`[post-github-review] posted=${result.posted} (${result.reason})`);
}

if (import.meta.main) {
  main().catch((err) => {
    // Never fail the PR: log and exit 0 (the workflow also sets continue-on-error).
    console.error(err instanceof Error ? err.message : String(err));
  });
}
