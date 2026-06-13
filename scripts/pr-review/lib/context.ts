// SPDX-License-Identifier: AGPL-3.0-or-later
//
// context.ts — pure assembly of the Stage-1 PR context (plan §4, §9, §11).
//
// Kept separate from the gh-api I/O (collect-pr-context.ts) so the truncation,
// anchorable-set construction, and existing-comment mapping are unit-testable
// without touching the network. Everything here is a pure function of its
// inputs. Patch-less files (binary/oversized — no `patch` from the files API)
// are excluded from BOTH the diff sent to the model and the anchorable set, so a
// finding on such a file has zero anchorable lines (C4).

import { buildAnchorIndex, parseFilePatch } from "./diff";
import type { ExistingComment, FileAnchorRecord, PrContext } from "./types";

/** A changed-file entry as returned by `gh api .../pulls/{n}/files`. */
export interface RawFile {
  filename: string;
  status: string;
  patch?: string | null;
}

/** A review comment as returned by `gh api .../pulls/{n}/comments`. */
export interface RawReviewComment {
  path: string;
  body: string;
  /** Null when GitHub has marked the comment outdated (lines moved). */
  line: number | null;
  original_line?: number | null;
  user?: { login?: string } | null;
}

export interface PrMeta {
  title: string;
  author: string;
  body: string;
  base_ref: string;
  head_ref: string;
}

export interface BuildContextParams {
  meta: PrMeta;
  files: readonly RawFile[];
  existingComments: readonly RawReviewComment[];
  repo: string;
  pullNumber: number;
  diffedSha: string;
  maxDiffBytes: number;
  /** Hidden marker the poster appends so we can recognise our own comments. */
  botMarker: string;
  /** Fallback author login used when the marker is absent (e.g. legacy comments). */
  botLogin: string;
}

/** Reconstruct a `diff --git` block for one file from its bare patch. */
export function reconstructFileBlock(path: string, patch: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, patch].join("\n");
}

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Select which patched files fit within maxDiffBytes, dropping the LARGEST
 * first (so many small files survive a single huge file). Returns the included
 * files in their original order plus the omitted paths for the summary note.
 */
function selectWithinBudget(
  patched: readonly RawFile[],
  maxDiffBytes: number,
): { included: RawFile[]; omitted: string[] } {
  const blocks = patched.map((f) => ({
    file: f,
    size: byteLen(reconstructFileBlock(f.filename, f.patch ?? "")),
  }));
  // Greedy smallest-first: include while the running total stays in budget.
  const bySizeAsc = [...blocks].sort((a, b) => a.size - b.size);
  const includedSet = new Set<RawFile>();
  let total = 0;
  for (const b of bySizeAsc) {
    if (total + b.size > maxDiffBytes) continue; // skip (it's among the largest)
    total += b.size;
    includedSet.add(b.file);
  }
  const included = patched.filter((f) => includedSet.has(f));
  const omitted = patched.filter((f) => !includedSet.has(f)).map((f) => f.filename);
  return { included, omitted };
}

/** Decide whether an existing review comment is one of ours (for dedupe). */
function isOwnComment(c: RawReviewComment, marker: string, botLogin: string): boolean {
  if (marker && c.body.includes(marker)) return true;
  return (c.user?.login ?? "") === botLogin;
}

/**
 * Build the full Stage-1 context object plus the unified diff text to feed the
 * model. Pure: no I/O. The anchor index is derived ONLY from included (patched,
 * in-budget) files.
 */
export function buildPrContext(params: BuildContextParams): {
  context: PrContext;
  diffText: string;
} {
  const patched = params.files.filter((f) => typeof f.patch === "string" && f.patch.length > 0);
  const { included, omitted } = selectWithinBudget(patched, params.maxDiffBytes);

  const fileDiffs = included.map((f) => parseFilePatch(f.filename, f.patch ?? ""));
  const anchorIndex = buildAnchorIndex(fileDiffs);
  const anchorable_files: FileAnchorRecord[] = anchorIndex.map((a) => ({
    path: a.path,
    right: a.right,
    left: a.left,
  }));

  const diffText = included.map((f) => reconstructFileBlock(f.filename, f.patch ?? "")).join("\n");

  const existing_bot_comments: ExistingComment[] = params.existingComments
    .filter((c) => isOwnComment(c, params.botMarker, params.botLogin))
    .map((c) => ({
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      body: c.body,
      // `line === null` means GitHub flagged it outdated (the code moved).
      outdated: c.line === null,
    }));

  const context: PrContext = {
    diffed_sha: params.diffedSha,
    pull_number: params.pullNumber,
    repo: params.repo,
    title: params.meta.title,
    author: params.meta.author,
    body: params.meta.body,
    base_ref: params.meta.base_ref,
    head_ref: params.meta.head_ref,
    anchorable_files,
    existing_bot_comments,
    diff_truncated: omitted.length > 0,
    truncated_paths: omitted,
  };
  return { context, diffText };
}
