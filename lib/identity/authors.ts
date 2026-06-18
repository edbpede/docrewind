// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Author derivation (PRD §9.7). One pure pass over the decoded revisions that
// yields the distinct contributors — in first-seen order — each carrying its
// content-free tallies plus, when `realIdentities` is on, its resolved display
// name / email / collaborator colour. Shared by the insights colophon
// (SummaryInsights) AND the replay surface's authorship attribution (the writing
// caret + segment highlighting), so BOTH read the same opaque author keys, the
// same "Author N" numbering, and the same colours — never the raw Gaia token.
//
// PURE by design (no Solid, no DOM): the reactive wrappers (`createMemo`) live in
// the components; this module is the testable derivation they both call.

import type { DecodedRevision } from "../domain/model";
import { authorLabel } from "../i18n/strings";
import type { IdentityMap } from "./resolve";

/** One distinct contributor, keyed by its opaque author token (never the raw id). */
export interface AuthorEntry {
  /** The opaque author token (changelog tuple position [2]); a stable join key. */
  readonly key: string;
  /** Resolved display name, or the opaque "Author N" fallback. Never the raw Gaia token. */
  readonly label: string;
  /** The viewer's own email when known; null for collaborators (the feed has none). */
  readonly email: string | null;
  /** Google's assigned collaborator colour (hex), when the source carried one. */
  readonly color: string | null;
  /** Count of revisions attributed to this author. */
  readonly edits: number;
  /** First / last attributed revision time (epoch ms), or null when untimed. */
  readonly firstTime: number | null;
  readonly lastTime: number | null;
}

/**
 * Derive the distinct authors of a revision list.
 *
 * Authors appear in first-seen order so the opaque "Author N" numbering stays
 * stable; each distinct author token yields exactly ONE entry, so a single person
 * is one entry even across many editing sessions. Real-identity attributes are
 * consulted ONLY when `realIdentities` is on and a resolution exists; otherwise the
 * entry falls back to its opaque label and carries no name/email/colour.
 */
export function deriveAuthors(
  revisions: readonly DecodedRevision[],
  realIdentities: boolean,
  identities: IdentityMap,
): readonly AuthorEntry[] {
  interface Tally {
    readonly key: string;
    edits: number;
    first: number | null;
    last: number | null;
  }
  const order: Tally[] = [];
  const byId = new Map<string, Tally>();
  for (const revision of revisions) {
    const id = revision.userId;
    if (id === null) {
      continue;
    }
    let tally = byId.get(id);
    if (tally === undefined) {
      tally = { key: id, edits: 0, first: null, last: null };
      byId.set(id, tally);
      order.push(tally);
    }
    tally.edits += 1;
    if (revision.time !== null) {
      const time = Number(revision.time);
      tally.first = tally.first === null ? time : Math.min(tally.first, time);
      tally.last = tally.last === null ? time : Math.max(tally.last, time);
    }
  }
  return order.map((tally, index) => {
    const identity = realIdentities ? identities[tally.key] : undefined;
    return {
      key: tally.key,
      label: identity?.name ?? authorLabel(index),
      email: identity?.email ?? null,
      color: identity?.color ?? null,
      edits: tally.edits,
      firstTime: tally.first,
      lastTime: tally.last,
    } satisfies AuthorEntry;
  });
}
