// SPDX-License-Identifier: AGPL-3.0-or-later
//
// workflows.test.ts — a mechanical security guard over the workflow files
// (plan §11/§12 go/no-go gate). These assertions encode the load-bearing
// fork-safety invariants (C1/C2/C3) so a future edit that, say, checks out the
// fork head in the secret-holding job, or leaks the NanoGPT key into Stage 1,
// fails the build instead of shipping a critical vuln.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const wf = (name: string): string =>
  readFileSync(join(repoRoot, ".github", "workflows", name), "utf8");

const collect = wf("pr-review-collect.yml");
const post = wf("pr-review-post.yml");

describe("Stage 1 (collect) — untrusted context, no secrets (C1)", () => {
  test("carries no secret reference at all", () => {
    expect(collect.includes("secrets.")).toBe(false);
  });

  test("has read-only pull-requests permission, never write", () => {
    expect(collect).toContain("pull-requests: read");
    expect(collect.includes("pull-requests: write")).toBe(false);
  });

  test("never checks out the fork head/merge ref — only the trusted base sha", () => {
    expect(collect.includes("github.event.pull_request.head.sha }}\n          ref")).toBe(false);
    // The only checkout ref is the base sha.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression in an assertion.
    expect(collect).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(collect.includes("ref: ${{ github.event.pull_request.head")).toBe(false);
  });

  test("debounces with cancel-in-progress", () => {
    expect(collect).toContain("cancel-in-progress: true");
  });
});

describe("Stage 2 (post) — trusted context, write token (C1/C2/C3)", () => {
  test("has write + actions:read permissions (C2 cross-run artifact download)", () => {
    expect(post).toContain("pull-requests: write");
    expect(post).toContain("actions: read");
  });

  test("checkout uses NO fork-derived ref (defaults to base default branch, C1)", () => {
    expect(post.includes("ref: ${{ github.event.workflow_run.head")).toBe(false);
    expect(post.includes("head_branch")).toBe(false);
    expect(post).toContain("persist-credentials: false");
  });

  test("the NanoGPT secret is mapped ONLY to OPENAI_API_KEY, at point of use", () => {
    const secretLines = post.split("\n").filter((l) => l.includes("secrets.NANOGPT_API_KEY"));
    expect(secretLines.length).toBe(1);
    expect(secretLines[0]).toContain("OPENAI_API_KEY");
  });

  test("identity is re-derived from the trusted workflow_run head SHA (C3)", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression in an assertion.
    expect(post).toContain("TRUSTED_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}");
    expect(post).toContain("verify-identity.ts");
  });

  test("the post step is non-blocking (continue-on-error)", () => {
    expect(post).toContain("continue-on-error: true");
  });

  test("the workflow_run job does not cancel-in-progress (keeps the secret-holding run)", () => {
    expect(post.includes("cancel-in-progress")).toBe(false);
  });

  test("install + Goose happen before the timed run-goose step (M-A)", () => {
    const installIdx = post.indexOf("download_cli.sh");
    const runIdx = post.indexOf("run-goose-review.ts");
    expect(installIdx).toBeGreaterThan(-1);
    expect(runIdx).toBeGreaterThan(installIdx);
  });
});

describe("third-party action pinning", () => {
  test("every non-actions/* third-party use is either SHA-pinned or flagged to pin", () => {
    for (const text of [collect, post]) {
      for (const line of text.split("\n")) {
        const m = line.match(/uses:\s*([^@\s]+)@(\S+)/);
        if (!m) continue;
        const ref = m[2] ?? "";
        const isSha = /^[0-9a-f]{40}$/.test(ref);
        const flagged = line.includes("SECURITY: pin");
        expect(isSha || flagged).toBe(true);
      }
    }
  });
});
