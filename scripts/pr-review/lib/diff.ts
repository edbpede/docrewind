// SPDX-License-Identifier: AGPL-3.0-or-later
//
// diff.ts — unified-diff parser -> anchor index (plan §4, §9, Critic C4).
//
// This is the load-bearing trusted core: GitHub's reviews API only accepts an
// inline comment whose (line, side) falls INSIDE an actual diff hunk for a file
// that has a `patch`. We mirror that exactly — not "any line in the file":
//
//   RIGHT eligibility = added (`+`) and context (` `) lines, numbered in the
//                       NEW file (the side a reviewer comments on for new code).
//   LEFT  eligibility = deleted (`-`) and context (` `) lines, numbered in the
//                       OLD file (the side for removed code).
//
// Files without a `patch` (binary, or over GitHub's diff-size cap) have ZERO
// anchorable lines — every finding on them is dropped, never snapped to a
// neighbour. The parser is pure and total: malformed input yields empty sets
// rather than throwing, so a single weird file can never crash the pipeline.

/** A parsed hunk header span. Lengths default to 1 when omitted (`@@ -1 +1 @@`). */
export interface Hunk {
  readonly oldStart: number;
  readonly oldLen: number;
  readonly newStart: number;
  readonly newLen: number;
}

/** Per-file diff with the eligible-line sets used for anchor validation. */
export interface FileDiff {
  readonly path: string;
  readonly hunks: Hunk[];
  /** Eligible NEW-file line numbers (added + context) — comment side RIGHT. */
  readonly rightLines: ReadonlySet<number>;
  /** Eligible OLD-file line numbers (deleted + context) — comment side LEFT. */
  readonly leftLines: ReadonlySet<number>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
// `diff --git a/<old> b/<new>` — the new path (group 2) is authoritative for renames.
const GIT_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const PLUS_FILE = /^\+\+\+ (?:b\/)?(.+)$/;

function parseHunkHeader(line: string): Hunk | null {
  const m = HUNK_HEADER.exec(line);
  if (!m) return null;
  const oldStart = Number(m[1]);
  const oldLen = m[2] === undefined ? 1 : Number(m[2]);
  const newStart = Number(m[3]);
  const newLen = m[4] === undefined ? 1 : Number(m[4]);
  return { oldStart, oldLen, newStart, newLen };
}

/**
 * Parse a single file's `patch` body (the value gh returns in
 * `pulls/{n}/files[].patch`, which starts at the first `@@` and omits the
 * `diff --git`/`+++` headers). Returns a FileDiff with eligibility sets.
 *
 * An empty or undefined patch (patch-less file: binary/oversized) yields empty
 * sets — the file is structurally unanchorable.
 */
export function parseFilePatch(path: string, patch: string | undefined | null): FileDiff {
  const hunks: Hunk[] = [];
  const rightLines = new Set<number>();
  const leftLines = new Set<number>();
  if (!patch) return { path, hunks, rightLines, leftLines };

  let newLine = 0;
  let oldLine = 0;
  for (const raw of patch.split("\n")) {
    const header = parseHunkHeader(raw);
    if (header) {
      hunks.push(header);
      newLine = header.newStart;
      oldLine = header.oldStart;
      continue;
    }
    // Outside any hunk (shouldn't occur in a bare patch) — skip.
    if (hunks.length === 0) continue;

    const marker = raw.length > 0 ? raw[0] : " ";
    if (marker === "\\") continue; // "\ No newline at end of file"
    if (marker === "+") {
      rightLines.add(newLine);
      newLine += 1;
    } else if (marker === "-") {
      leftLines.add(oldLine);
      oldLine += 1;
    } else {
      // Context line (leading space, or a blank diff line): present on both sides.
      rightLines.add(newLine);
      leftLines.add(oldLine);
      newLine += 1;
      oldLine += 1;
    }
  }
  return { path, hunks, rightLines, leftLines };
}

/**
 * Parse a combined unified diff (the `.diff` media type, with `diff --git` and
 * `+++ b/<path>` headers) into a path-keyed map of FileDiffs. Used when the
 * collector has the whole-PR diff text rather than per-file patches.
 */
export function parseUnifiedDiff(diffText: string): Map<string, FileDiff> {
  const result = new Map<string, FileDiff>();
  const lines = diffText.split("\n");

  let path: string | null = null;
  let body: string[] = [];

  const flush = (): void => {
    if (path !== null && body.length > 0) {
      result.set(path, parseFilePatch(path, body.join("\n")));
    }
    body = [];
  };

  for (const line of lines) {
    const git = GIT_HEADER.exec(line);
    if (git) {
      flush();
      // Prefer the new path; renames overwrite it via the +++ header below.
      path = git[2] ?? null;
      continue;
    }
    const plus = PLUS_FILE.exec(line);
    if (plus) {
      const p = plus[1];
      // `/dev/null` marks a deletion — keep the git-header path in that case.
      if (p && p !== "/dev/null") path = p;
      continue;
    }
    if (
      line.startsWith("@@") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ") ||
      line.startsWith("\\")
    ) {
      if (path !== null) body.push(line);
    }
  }
  flush();
  return result;
}

/** The minimal per-file anchor record persisted in pr-context.json. */
export interface FileAnchors {
  readonly path: string;
  readonly right: number[];
  readonly left: number[];
}

/** Serialize FileDiffs into a stable, JSON-friendly anchor index (sorted). */
export function buildAnchorIndex(files: Iterable<FileDiff>): FileAnchors[] {
  const out: FileAnchors[] = [];
  for (const f of files) {
    out.push({
      path: f.path,
      right: [...f.rightLines].sort((a, b) => a - b),
      left: [...f.leftLines].sort((a, b) => a - b),
    });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
