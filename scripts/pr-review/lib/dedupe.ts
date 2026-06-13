// SPDX-License-Identifier: AGPL-3.0-or-later
//
// dedupe.ts — deterministic dedupe keys (plan §9, Critic M-C).
//
// The model's self-reported `dedupe_key` is IGNORED: it is unstable across the
// model-fallback ladder (each model phrases it differently), so it cannot gate
// re-post suppression. Instead we compute the authoritative key in code from
// (path + anchored line + a normalized body fingerprint). The same finding
// produced by two different models therefore collapses to one key, and a finding
// already posted by the bot on an earlier push is skipped on re-run.

import { createHash } from "node:crypto";
import type { ExistingComment, ReviewComment } from "./types";

/**
 * Normalize a comment body for fingerprinting: lowercase, drop backticks (so a
 * model wrapping code in fences vs not still matches), and collapse all runs of
 * whitespace to single spaces. Stable and order-independent within a line.
 */
export function normalizeBody(body: string): string {
  return body.toLowerCase().replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The authoritative dedupe key: path + anchored line + an 8-hex-char SHA-1
 * fingerprint of the normalized body. Short hash keeps logs readable; collision
 * risk is irrelevant at PR-review comment volumes.
 */
export function computeDedupeKey(path: string, line: number, body: string): string {
  const fingerprint = createHash("sha1").update(normalizeBody(body)).digest("hex").slice(0, 8);
  return `${path}:${line}:${fingerprint}`;
}

export interface DedupeResult {
  kept: ReviewComment[];
  /** Keys skipped because they duplicate an existing bot comment or each other. */
  skippedKeys: string[];
}

/**
 * Drop findings that (a) duplicate a non-outdated existing bot comment, or
 * (b) duplicate an earlier finding in the same batch. Existing-comment keys are
 * computed the same way (path + line + fingerprint) so the comparison is
 * symmetric. Outdated existing comments do not suppress — the code moved, so a
 * fresh comment is appropriate.
 */
export function dedupeFindings(
  comments: readonly ReviewComment[],
  existing: readonly ExistingComment[],
): DedupeResult {
  const seen = new Set<string>();
  for (const e of existing) {
    if (e.outdated) continue;
    if (e.line === null) continue;
    seen.add(computeDedupeKey(e.path, e.line, e.body));
  }

  const kept: ReviewComment[] = [];
  const skippedKeys: string[] = [];
  for (const c of comments) {
    const key = computeDedupeKey(c.path, c.line, c.body);
    if (seen.has(key)) {
      skippedKeys.push(key);
      continue;
    }
    seen.add(key);
    kept.push(c);
  }
  return { kept, skippedKeys };
}
