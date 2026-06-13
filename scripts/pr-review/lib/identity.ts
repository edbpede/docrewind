// SPDX-License-Identifier: AGPL-3.0-or-later
//
// identity.ts — trusted identity reconciliation (plan §4 identity model, C3).
//
// THE LOAD-BEARING SECURITY INVARIANT: the Stage-1 artifact is untrusted data,
// INCLUDING its control fields. A malicious fork can write any pull_number /
// head_sha into pr-context.json. Stage 2 (which holds the write token) therefore
// re-derives the authoritative identity from the trusted workflow_run event and
// an authenticated gh lookup, then cross-checks the artifact's claims and FAILS
// CLOSED on any mismatch. The artifact's identity fields are advisory only.
//
// One immutable SHA underlies the diff, the anchor index, and the posting
// commit_id: the trusted workflow_run.head_sha MUST equal the SHA Stage 1
// recorded as diffed_sha, or we refuse to post.

import type { TrustedIdentity } from "./types";

/** A PR as returned by `gh api repos/{repo}/commits/{sha}/pulls`. */
export interface CommitPull {
  number: number;
  head: { sha: string };
}

export interface ReconcileParams {
  /** From the trusted workflow_run event. */
  trustedHeadSha: string;
  repo: string;
  /** The artifact's (untrusted) claimed values. */
  artifactPullNumber: number;
  artifactDiffedSha: string;
  /** Authenticated lookup result for the trusted SHA. */
  resolvedPulls: readonly CommitPull[];
}

export type ReconcileResult =
  | { ok: true; identity: TrustedIdentity }
  | { ok: false; reason: string };

/**
 * Reconcile the untrusted artifact identity against trusted-derived values.
 * Pure and total; the caller turns `ok:false` into a non-zero exit (post
 * nothing). Order of checks is chosen so the most security-relevant mismatch
 * (SHA drift) is reported first.
 */
export function reconcileIdentity(p: ReconcileParams): ReconcileResult {
  // 1. The diff/anchor index MUST have been built from the trusted SHA.
  if (p.artifactDiffedSha !== p.trustedHeadSha) {
    return { ok: false, reason: "diffed_sha_mismatch" };
  }
  // 2. Resolve the authoritative PR number from the trusted SHA.
  const match = p.resolvedPulls.find((pr) => pr.head.sha === p.trustedHeadSha);
  if (!match) {
    return { ok: false, reason: "pr_not_resolved_from_trusted_sha" };
  }
  // 3. Cross-check the artifact's claimed PR number against the trusted one.
  if (p.artifactPullNumber !== match.number) {
    return { ok: false, reason: "pull_number_mismatch" };
  }
  return {
    ok: true,
    identity: { pull_number: match.number, head_sha: p.trustedHeadSha, repo: p.repo },
  };
}
