// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Parser/decoder version stamp (plan §1.2 / §1.4). PARSER_VERSION keys decoded-
// cache invalidation: when the decode grammar or reconstruction semantics change
// in a way that makes previously-decoded data stale, bump this constant. The
// cache layer (lib/platform/db.ts) invalidates stored `decoded`/`snapshots`/`timeline`
// whose recorded parser version is lower, while RETAINING raw chunks when safe so
// a re-decode needs no network re-fetch (PRD §10.6, §9.8).
//
// It lives in lib/core/docs/decoder (a pure dir) so the decode pipeline and the storage
// layer share one source of truth without the storage layer reaching into the
// browser-coupled side of the tree.

/** Monotonic decode-pipeline version. Bump on any decode/reconstruct change. */
export const PARSER_VERSION = 1;
