// SPDX-License-Identifier: AGPL-3.0-or-later
//
// gh.ts — thin wrapper over the GitHub CLI (`gh api`) used by the Stage-1
// collector and the Stage-2 identity check. We shell out to `gh` rather than
// hand-rolling HTTP so auth + pagination + base-URL handling come for free in
// CI (where GH_TOKEN is exported into the environment).
//
// These helpers are the ONLY I/O seam in collect/verify; the data-shaping logic
// lives in pure modules (context.ts) so it can be tested without the network.

import { execFileSync } from "node:child_process";

export interface GhOptions {
  /** Extra env (e.g. GH_TOKEN). Merged over process.env. */
  env?: Record<string, string | undefined>;
  /** Stdin to feed the process (e.g. a JSON body for `gh api --input -`). */
  input?: string;
}

/** Run `gh <args...>` and return stdout as a string. Throws on non-zero exit. */
export function gh(args: readonly string[], opts: GhOptions = {}): string {
  return execFileSync("gh", args as string[], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...opts.env },
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
}

/** `gh api <path> [extra...]` parsed as JSON of the caller's expected shape. */
export function ghApiJson<T>(path: string, extra: readonly string[] = [], opts: GhOptions = {}): T {
  const out = gh(["api", path, ...extra], opts);
  return JSON.parse(out) as T;
}

/**
 * `gh api --paginate <path>` returning a flat array. `--paginate` concatenates
 * pages; with `--slurp` gh wraps them into a single JSON array of pages, so we
 * flatten one level. We pass `-H 'Accept: application/vnd.github+json'`.
 */
export function ghApiPaginate<T>(path: string, opts: GhOptions = {}): T[] {
  const out = gh(["api", "--paginate", "--slurp", path], opts);
  const pages = JSON.parse(out) as T[][];
  return pages.flat();
}
