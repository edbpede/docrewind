// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unified-diff parsing and anchor indexing (plan §8). GitHub's review API anchors
// inline comments with `line` + `side` (never the brittle legacy `position`). To
// post a comment we must prove the (path, line, side) triple lands on a real
// changed line, otherwise GitHub rejects the whole review with a 422. This module
// turns Octokit's per-file `patch` strings into a lookup the validator can query.
//
// We feed each file's patch to `parse-diff` with a synthesized header so the
// parser reliably emits one file with computed old/new line numbers, then index:
//   add  line  -> valid on RIGHT
//   del  line  -> valid on LEFT
//   norm line  -> valid on both sides but DEPRIORITIZED (prefer changed lines)
// The path key is the caller-supplied filename (post-rename), matching how GitHub
// anchors renamed files.

import parse from "parse-diff";

/** A hunk's line ranges, used to enforce same-hunk multi-line anchors. */
export interface Hunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
}

/** Valid anchor lines for one file, split by side and changed-vs-context. */
export interface FileAnchors {
  /** New-file line numbers added in the diff (preferred RIGHT anchors). */
  readonly right: Set<number>;
  /** Old-file line numbers deleted in the diff (preferred LEFT anchors). */
  readonly left: Set<number>;
  /** New-file context lines — valid RIGHT anchors but deprioritized. */
  readonly rightContext: Set<number>;
  /** Old-file context lines — valid LEFT anchors but deprioritized. */
  readonly leftContext: Set<number>;
  readonly hunks: readonly Hunk[];
}

export type AnchorIndex = ReadonlyMap<string, FileAnchors>;

/** A changed file as returned by Octokit (`patch` absent for binary/large). */
export interface PatchedFile {
  readonly path: string;
  readonly patch: string | undefined;
}

/**
 * Build a synthetic single-file unified diff so parse-diff attributes every hunk
 * to one file regardless of whether GitHub's `patch` included git headers.
 */
function synthesize(path: string, patch: string): string {
  const body = patch.endsWith("\n") ? patch : `${patch}\n`;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}`;
}

/** Build the per-file anchor index from a list of changed files + patches. */
export function buildAnchorIndex(files: readonly PatchedFile[]): AnchorIndex {
  const index = new Map<string, FileAnchors>();

  for (const file of files) {
    if (file.patch === undefined || file.patch.trim() === "") {
      continue;
    }

    const parsed = parse(synthesize(file.path, file.patch));
    const first = parsed[0];
    if (first === undefined) {
      continue;
    }

    const anchors: FileAnchors = {
      right: new Set<number>(),
      left: new Set<number>(),
      rightContext: new Set<number>(),
      leftContext: new Set<number>(),
      hunks: [],
    };
    const hunks: Hunk[] = [];

    for (const chunk of first.chunks) {
      hunks.push({
        oldStart: chunk.oldStart,
        oldLines: chunk.oldLines,
        newStart: chunk.newStart,
        newLines: chunk.newLines,
      });

      for (const change of chunk.changes) {
        switch (change.type) {
          case "add":
            anchors.right.add(change.ln);
            break;
          case "del":
            anchors.left.add(change.ln);
            break;
          case "normal":
            anchors.rightContext.add(change.ln2);
            anchors.leftContext.add(change.ln1);
            break;
        }
      }
    }

    index.set(file.path, { ...anchors, hunks });
  }

  return index;
}

/** True if `line` is a valid anchor on `side` (changed or context) for the file. */
export function isValidAnchor(anchors: FileAnchors, line: number, side: "RIGHT" | "LEFT"): boolean {
  if (side === "RIGHT") {
    return anchors.right.has(line) || anchors.rightContext.has(line);
  }
  return anchors.left.has(line) || anchors.leftContext.has(line);
}

/** True if both endpoints of a multi-line range fall inside the same hunk. */
export function sameHunk(
  anchors: FileAnchors,
  startLine: number,
  endLine: number,
  side: "RIGHT" | "LEFT",
): boolean {
  for (const hunk of anchors.hunks) {
    const start = side === "RIGHT" ? hunk.newStart : hunk.oldStart;
    const lines = side === "RIGHT" ? hunk.newLines : hunk.oldLines;
    const end = start + lines - 1;
    if (startLine >= start && endLine <= end) {
      return true;
    }
  }
  return false;
}
