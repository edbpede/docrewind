// SPDX-License-Identifier: AGPL-3.0-or-later
//
// verify-identity.ts — Stage 2 trusted identity gate (plan §11, C3).
//
// Runs in the trusted base context BEFORE the model or the poster. It resolves
// the PR number from the trusted workflow_run.head_sha via an authenticated gh
// lookup (workflow_run.pull_requests[] is empty for fork PRs), cross-checks the
// untrusted artifact's claims, and EITHER writes identity.json (trusted SHA +
// PR number, the only values the poster trusts) OR exits non-zero so the job
// fails closed and posts nothing.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ghApiJson } from "./lib/gh";
import { type CommitPull, reconcileIdentity } from "./lib/identity";
import type { PrContext } from "./lib/types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(`verify-identity: missing required env ${name}`);
  }
  return v;
}

export async function main(): Promise<void> {
  const repo = requireEnv("REPO");
  const trustedHeadSha = requireEnv("TRUSTED_HEAD_SHA");
  const dir = process.env.OUT_DIR ?? process.cwd();

  const artifact = JSON.parse(readFileSync(join(dir, "pr-context.json"), "utf8")) as PrContext;

  // Authenticated: which PRs have this exact commit as their head?
  const resolvedPulls = ghApiJson<CommitPull[]>(`repos/${repo}/commits/${trustedHeadSha}/pulls`);

  const result = reconcileIdentity({
    trustedHeadSha,
    repo,
    artifactPullNumber: artifact.pull_number,
    artifactDiffedSha: artifact.diffed_sha,
    resolvedPulls,
  });

  if (!result.ok) {
    console.error(`[verify-identity] FAIL CLOSED: ${result.reason} — posting nothing.`);
    process.exit(1);
  }

  writeFileSync(join(dir, "identity.json"), `${JSON.stringify(result.identity, null, 2)}\n`);
  console.log(
    `[verify-identity] OK: PR #${result.identity.pull_number} @ ${result.identity.head_sha}`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
