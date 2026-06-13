// SPDX-License-Identifier: AGPL-3.0-or-later
//
// collect-pr-context.ts — Stage 1 (plan §4, §11). Runs in the UNTRUSTED PR/fork
// context with NO secrets and a read-only token. It reads everything via
// `gh api` (no checkout of head/merge code is ever placed on disk) and emits two
// artifacts consumed downstream as pure data:
//
//   pr-context.json  — PR meta, the SHA the diff was built from, the anchorable
//                      file set + per-file hunk ranges, and existing bot comments.
//   pr.diff          — the reconstructed unified diff fed to the model.
//
// The data-shaping is delegated to lib/context.ts (pure, tested). This file is
// only the gh-api + filesystem seam, guarded by `import.meta.main` so tests can
// import nothing-with-side-effects from it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_LOGIN, BOT_MARKER, MAX_DIFF_BYTES } from "./lib/config";
import { buildPrContext, type PrMeta, type RawFile, type RawReviewComment } from "./lib/context";
import { ghApiJson, ghApiPaginate } from "./lib/gh";

interface RawPull {
  title: string;
  body: string | null;
  user: { login: string } | null;
  base: { ref: string };
  head: { ref: string; sha: string };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(`collect-pr-context: missing required env ${name}`);
  }
  return v;
}

export async function main(): Promise<void> {
  const repo = requireEnv("REPO");
  const pullNumber = Number(requireEnv("PR_NUMBER"));
  const headSha = requireEnv("HEAD_SHA");
  const outDir = process.env.OUT_DIR ?? process.cwd();

  const pull = ghApiJson<RawPull>(`repos/${repo}/pulls/${pullNumber}`);
  const files = ghApiPaginate<RawFile>(`repos/${repo}/pulls/${pullNumber}/files`);
  const comments = ghApiPaginate<RawReviewComment>(`repos/${repo}/pulls/${pullNumber}/comments`);

  const meta: PrMeta = {
    title: pull.title,
    author: pull.user?.login ?? "unknown",
    body: pull.body ?? "",
    base_ref: pull.base.ref,
    head_ref: pull.head.ref,
  };

  const { context, diffText } = buildPrContext({
    meta,
    files,
    existingComments: comments,
    repo,
    pullNumber,
    // Record the SHA we actually diffed; Stage 2 cross-checks it against the
    // trusted workflow_run.head_sha before posting (one immutable SHA).
    diffedSha: headSha,
    maxDiffBytes: MAX_DIFF_BYTES,
    botMarker: BOT_MARKER,
    botLogin: BOT_LOGIN,
  });

  writeFileSync(join(outDir, "pr-context.json"), `${JSON.stringify(context, null, 2)}\n`);
  writeFileSync(join(outDir, "pr.diff"), diffText);
  console.log(
    `[collect] pr-context.json + pr.diff written: ${context.anchorable_files.length} anchorable file(s)` +
      `${context.diff_truncated ? `, truncated ${context.truncated_paths.length}` : ""}`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
