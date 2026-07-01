// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Kind-agnostic revision metadata (plan §1 Chosen-option / ADR). The single
// structural supertype that BOTH `DecodedRevision` (Docs) and
// `SheetsDecodedRevision` (Sheets) satisfy. It carries ONLY the attribution /
// timing fields the metadata-derived analysis reads — session grouping
// (`sameSession`, the session span, userId/sessionId) and pause detection
// (`derivePauses`, `time`). It deliberately omits `.operations`: the op-derived
// analysis (length/position curves, char totals, large-edit detection) is a
// kind-specific extractor injected separately, because the Docs and Sheets op
// unions are disjoint.
//
// PURE: imports nothing from the extension runtime; only the shared branded id
// types. Lives in `lib/core/replay-core` so both cores name one common metadata
// shape without crossing into each other's decode grammar.

import type { RevisionId, SessionId, UserId } from "@/lib/core/domain/ids";

/**
 * The metadata fields common to every decoded revision, regardless of document
 * kind. Both `DecodedRevision` and `SheetsDecodedRevision` are assignable to
 * this type (they add a kind-specific `operations` field on top).
 */
export interface RevisionMeta {
  readonly revisionId: RevisionId;
  readonly userId: UserId | null;
  readonly sessionId: SessionId | null;
  /** Epoch ms; null when the wire omitted the timestamp. */
  readonly time: number | null;
}
