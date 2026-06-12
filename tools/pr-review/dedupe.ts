// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate-comment prevention (plan §9). On every re-run (a PR `synchronize`
// push, a re-label, a `/review` re-trigger) we must not re-post findings we have
// already left. Each posted comment body carries a hidden HTML-comment marker
// fingerprinting (path, line, side, normalized-body); GitHub renders HTML
// comments invisibly. Before posting we list prior bot comments, extract their
// fingerprints, and drop any candidate whose fingerprint already exists — and we
// also de-dup within the current batch.

import { createHash } from "node:crypto";

/** Marker schema version; bump if the fingerprint inputs change. */
export const MARKER_VERSION = "v1";

const MARKER_RE = /<!--\s*docrewind-ai-review:v\d+:fp=([0-9a-f]+)\s*-->/g;

/** Minimal shape needed to fingerprint a comment. */
export interface FingerprintInput {
  readonly path: string;
  readonly line: number;
  readonly side: string;
  readonly body: string;
}

/** Collapse whitespace and lowercase so trivial body edits still match. */
function normalizeBody(body: string): string {
  return body.replace(MARKER_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Stable 16-hex-char fingerprint of a finding's identity. */
export function fingerprint(input: FingerprintInput): string {
  const material = [input.path, String(input.line), input.side, normalizeBody(input.body)].join(
    " ",
  );
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/** The hidden marker line embedded in a posted comment body. */
export function markerFor(fp: string): string {
  return `<!-- docrewind-ai-review:${MARKER_VERSION}:fp=${fp} -->`;
}

/** Append the hidden marker to a comment body (on its own trailing line). */
export function withMarker(body: string, fp: string): string {
  return `${body}\n\n${markerFor(fp)}`;
}

/** Extract all fingerprints embedded in a set of prior comment bodies. */
export function extractFingerprints(bodies: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const body of bodies) {
    for (const match of body.matchAll(MARKER_RE)) {
      const fp = match[1];
      if (fp !== undefined) {
        out.add(fp);
      }
    }
  }
  return out;
}

/**
 * Filter candidates against prior fingerprints and against each other, returning
 * the survivors paired with their fingerprint (ready for marker embedding).
 */
export function dropDuplicates<T extends FingerprintInput>(
  candidates: readonly T[],
  priorFingerprints: ReadonlySet<string>,
): Array<{ readonly comment: T; readonly fp: string }> {
  const seen = new Set<string>(priorFingerprints);
  const kept: Array<{ readonly comment: T; readonly fp: string }> = [];
  for (const comment of candidates) {
    const fp = fingerprint(comment);
    if (seen.has(fp)) {
      continue;
    }
    seen.add(fp);
    kept.push({ comment, fp });
  }
  return kept;
}
