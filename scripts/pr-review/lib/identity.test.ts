// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { type CommitPull, reconcileIdentity } from "./identity";

const SHA = "deadbeef";
const pulls: CommitPull[] = [{ number: 42, head: { sha: SHA } }];

describe("reconcileIdentity", () => {
  test("accepts a matching artifact and resolves the trusted PR number", () => {
    const r = reconcileIdentity({
      trustedHeadSha: SHA,
      repo: "o/r",
      artifactPullNumber: 42,
      artifactDiffedSha: SHA,
      resolvedPulls: pulls,
    });
    expect(r).toEqual({ ok: true, identity: { pull_number: 42, head_sha: SHA, repo: "o/r" } });
  });

  test("fails closed when the artifact diffed a different SHA", () => {
    const r = reconcileIdentity({
      trustedHeadSha: SHA,
      repo: "o/r",
      artifactPullNumber: 42,
      artifactDiffedSha: "other",
      resolvedPulls: pulls,
    });
    expect(r).toEqual({ ok: false, reason: "diffed_sha_mismatch" });
  });

  test("fails closed when no PR resolves from the trusted SHA", () => {
    const r = reconcileIdentity({
      trustedHeadSha: SHA,
      repo: "o/r",
      artifactPullNumber: 42,
      artifactDiffedSha: SHA,
      resolvedPulls: [],
    });
    expect(r).toEqual({ ok: false, reason: "pr_not_resolved_from_trusted_sha" });
  });

  test("fails closed when the artifact claims a different PR number (C3 attack)", () => {
    const r = reconcileIdentity({
      trustedHeadSha: SHA,
      repo: "o/r",
      artifactPullNumber: 9999, // malicious fork claim
      artifactDiffedSha: SHA,
      resolvedPulls: pulls,
    });
    expect(r).toEqual({ ok: false, reason: "pull_number_mismatch" });
  });
});
