// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GitHub REST wrapper via Octokit (plan §9). The bot is API-only: it fetches PR
// metadata and the diff over the API and NEVER checks out or executes PR code,
// which is what makes running under `pull_request_target` on fork PRs safe (§12).
//
// All writes go through ONE grouped review (`POST /pulls/{n}/reviews` with
// event: "COMMENT") to minimize secondary-rate-limit exposure. Read calls
// paginate. A light retry honors Retry-After / x-ratelimit-reset on 403/429.
//
// `buildReviewPayload` is a pure, network-free function (unit-tested in §13):
// given the head SHA, the validated comments, and a summary, it produces the
// exact request body — collapsing to a summary-only review when no comments
// survive validation.

import { Octokit } from "@octokit/rest";
import type { Logger } from "./logger";
import { postedReviewBody, sanitizePostedText } from "./policy";
import type { PostComment } from "./validate";

/** PR metadata needed to anchor and gate the review. */
export interface PullMeta {
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
  readonly headSha: string;
  readonly baseRef: string;
  readonly headRef: string;
  /** `owner/repo` of the head; null for some fork shapes. Used by the gate. */
  readonly headRepoFullName: string | null;
}

/** A changed file from `GET /pulls/{n}/files`. */
export interface ChangedFile {
  readonly path: string;
  readonly status: string;
  readonly patch: string | undefined;
  readonly additions: number;
  readonly deletions: number;
}

/** The exact body sent to `POST /pulls/{n}/reviews`. */
export interface ReviewPayload {
  readonly commit_id: string;
  readonly body: string;
  readonly event: "COMMENT";
  readonly comments: ReadonlyArray<{
    readonly path: string;
    readonly line: number;
    readonly side: string;
    readonly start_line?: number;
    readonly start_side?: string;
    readonly body: string;
  }>;
}

/** Build the grouped-review request body; summary-only when no comments survive. */
export function buildReviewPayload(
  headSha: string,
  comments: readonly PostComment[],
  summary: string,
): ReviewPayload {
  const body = postedReviewBody(summary);
  if (comments.length === 0) {
    return {
      commit_id: headSha,
      body,
      event: "COMMENT",
      comments: [],
    };
  }
  return {
    commit_id: headSha,
    body,
    event: "COMMENT",
    comments: comments.map((c) =>
      c.start_line !== undefined && c.start_side !== undefined
        ? {
            path: c.path,
            line: c.line,
            side: c.side,
            start_line: c.start_line,
            start_side: c.start_side,
            body: sanitizePostedText(c.body),
          }
        : { path: c.path, line: c.line, side: c.side, body: sanitizePostedText(c.body) },
    ),
  };
}

const MAX_FILES = 3000;

export interface GitHubClient {
  getPull(): Promise<PullMeta>;
  listFiles(): Promise<ChangedFile[]>;
  listExistingReviewCommentBodies(): Promise<string[]>;
  createReview(payload: ReviewPayload): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Retry a read/write once on 403/429, honoring Retry-After / rate-reset. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, logger: Logger): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if ((status === 403 || status === 429) && attempt < 2) {
        const headers = (error as { response?: { headers?: Record<string, string> } }).response
          ?.headers;
        const retryAfter = headers?.["retry-after"];
        const reset = headers?.["x-ratelimit-reset"];
        const remaining = headers?.["x-ratelimit-remaining"];
        let waitMs = 60_000;
        if (retryAfter) {
          waitMs = Number.parseInt(retryAfter, 10) * 1000;
        } else if (remaining === "0" && reset) {
          waitMs = Math.max(0, Number.parseInt(reset, 10) * 1000 - Date.now());
        }
        logger.warn("github rate limited; backing off", { status, attempt, waitMs });
        await sleep(Math.min(waitMs, 120_000));
        continue;
      }
      throw error;
    }
  }
}

/** Construct the live Octokit-backed client for one PR. */
export function createGitHubClient(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  logger: Logger,
): GitHubClient {
  const octokit = new Octokit({ auth: token });

  return {
    async getPull(): Promise<PullMeta> {
      const { data } = await withRateLimitRetry(
        () => octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
        logger,
      );
      return {
        title: data.title,
        body: data.body ?? "",
        draft: data.draft ?? false,
        headSha: data.head.sha,
        baseRef: data.base.ref,
        headRef: data.head.ref,
        headRepoFullName: data.head.repo?.full_name ?? null,
      };
    },

    async listFiles(): Promise<ChangedFile[]> {
      const files = await withRateLimitRetry(
        () =>
          octokit.paginate(octokit.rest.pulls.listFiles, {
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 100,
          }),
        logger,
      );
      return files.slice(0, MAX_FILES).map((file) => ({
        path: file.filename,
        status: file.status,
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
      }));
    },

    async listExistingReviewCommentBodies(): Promise<string[]> {
      const comments = await withRateLimitRetry(
        () =>
          octokit.paginate(octokit.rest.pulls.listReviewComments, {
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 100,
          }),
        logger,
      );
      return comments.map((comment) => comment.body);
    },

    async createReview(payload: ReviewPayload): Promise<void> {
      await withRateLimitRetry(
        () =>
          octokit.rest.pulls.createReview({
            owner,
            repo,
            pull_number: pullNumber,
            commit_id: payload.commit_id,
            body: payload.body,
            event: payload.event,
            comments: payload.comments.map((c) => ({ ...c })),
          }),
        logger,
      );
    },
  };
}
