// SPDX-License-Identifier: AGPL-3.0-or-later
//
// anchors.ts — deterministic anchor validation (plan §9, Critic C4).
//
// A comment is POSTABLE iff its path is in the anchorable changed-file set AND
// its (line, side) falls inside that file's hunk-range set. Multi-line ranges
// must share one side, with start_line <= line and both endpoints eligible.
// We never "snap to nearest line" (fail safe): an unanchorable finding is
// dropped and routed to dropped_or_uncertain_findings, never repositioned.

import type { FileAnchorRecord, Side } from "./types";

/** The minimal anchor shape we validate (a ReviewComment is a superset). */
export interface AnchorInput {
  path: string;
  line: number;
  side: Side;
  start_line?: number;
  start_side?: Side;
}

export type AnchorVerdict = { ok: true } | { ok: false; reason: string };

/** Index the per-file anchor records into side-keyed Sets for O(1) checks. */
export class AnchorIndex {
  private readonly byPath = new Map<string, { right: Set<number>; left: Set<number> }>();

  constructor(files: readonly FileAnchorRecord[]) {
    for (const f of files) {
      this.byPath.set(f.path, { right: new Set(f.right), left: new Set(f.left) });
    }
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  private eligible(path: string, side: Side, line: number): boolean {
    const rec = this.byPath.get(path);
    if (!rec) return false;
    return (side === "RIGHT" ? rec.right : rec.left).has(line);
  }

  /**
   * Validate one anchor against the index. Returns a structured verdict so the
   * caller can record the exact drop reason in the audit trail.
   */
  validate(c: AnchorInput): AnchorVerdict {
    // Path hygiene: reject traversal and absolute paths before anything else.
    if (isUnsafePath(c.path)) return { ok: false, reason: "unsafe_path" };
    if (!this.has(c.path)) return { ok: false, reason: "path_not_in_changed_set" };

    if (!Number.isInteger(c.line) || c.line < 1) {
      return { ok: false, reason: "invalid_line" };
    }
    if (!this.eligible(c.path, c.side, c.line)) {
      return { ok: false, reason: "line_outside_hunk" };
    }

    // Multi-line range: requires a matching start_side, same side, start<=line,
    // and the start endpoint must also be eligible on that side.
    if (c.start_line !== undefined || c.start_side !== undefined) {
      if (c.start_line === undefined || c.start_side === undefined) {
        return { ok: false, reason: "incomplete_multiline_range" };
      }
      if (c.start_side !== c.side) return { ok: false, reason: "multiline_side_mismatch" };
      if (c.start_line > c.line) return { ok: false, reason: "multiline_start_after_end" };
      if (!this.eligible(c.path, c.start_side, c.start_line)) {
        return { ok: false, reason: "multiline_start_outside_hunk" };
      }
    }
    return { ok: true };
  }
}

/**
 * Reject paths that are absolute, climb out of the repo (`..`), are empty, or
 * contain NUL — none of which can name a real changed file. The anchorable set
 * is the primary guard; this is defence in depth against injected paths.
 */
export function isUnsafePath(path: string): boolean {
  if (path.length === 0) return true;
  if (path.includes("\0")) return true;
  if (path.startsWith("/")) return true;
  if (path.startsWith("../") || path.includes("/../") || path.endsWith("/..") || path === "..") {
    return true;
  }
  return false;
}
