// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Endpoint URL construction (plan T2 / A.1, A.5). The `revisions/load` URL
// template lives ONLY here. CONFIRMED by the §24 live capture (2026-06-12): the
// single-account `…/document/d/{id}/revisions/load?…` shape returns 200 JSON, and
// the multi-account `/document/u/{N}/d/…` path variant is now LIVE-CONFIRMED (Firefox, two
// signed-in accounts; §24 Q8) — a `/document/u/1/d/` read returned 200 `application/json`,
// and `detectUserIndex`/`buildRevisionsLoadUrl` were re-verified against the live
// `/document/u/1/d/` URL. Hardcoded single-account paths break on multi-login sessions, so the
// variant must be detected or requests silently fail (the documented 2017 breakage).

import type { DocId, RevisionId } from "@/lib/core/domain/ids";
import type { DocumentKind } from "@/lib/core/domain/kind";
import { pathPrefixForKind } from "@/lib/core/domain/kind";

const DOCS_ORIGIN = "https://docs.google.com";

/** Parameters for a `revisions/load` request. `userIndex` is the `/document/u/{N}/d/` slot. */
export interface RevisionsLoadParams {
  readonly docId: DocId;
  readonly start: RevisionId;
  readonly end: RevisionId;
  // null = single-account path (no `/u/{N}/d/`); a number selects the slot (A.5).
  readonly userIndex: number | null;
  // Document kind selects the `/document/` vs `/spreadsheets/` path prefix
  // (same host, same template otherwise). Defaults to "doc".
  readonly kind?: DocumentKind;
}

/**
 * Build the `revisions/load` changelog URL (A.1). CONFIRMED live 2026-06-12 — the
 * single-account and `/document/u/{N}/d/` (§24 Q8) shapes both return 200 `application/json`.
 */
export function buildRevisionsLoadUrl(params: RevisionsLoadParams): string {
  if (params.userIndex !== null && (!Number.isInteger(params.userIndex) || params.userIndex < 0)) {
    throw new TypeError("buildRevisionsLoadUrl: userIndex must be a non-negative integer or null");
  }
  const userSegment = params.userIndex !== null ? `/u/${params.userIndex}` : "";
  const query = new URLSearchParams({
    id: params.docId,
    start: String(params.start),
    end: String(params.end),
  });
  const prefix = pathPrefixForKind(params.kind ?? "doc");
  return `${DOCS_ORIGIN}/${prefix}${userSegment}/d/${params.docId}/revisions/load?${query.toString()}`;
}

/** Parameters for a `revisions/tiles` request (the version-history / userMap feed). */
export interface RevisionsTilesParams {
  readonly docId: DocId;
  // null = single-account path; a number selects the `/document/u/{N}/d/` slot (A.5).
  readonly userIndex: number | null;
  // Short-lived per-session credentials read fresh from the edit-page bootstrap.
  readonly token: string;
  readonly ouid: string;
  // Server caps the batch; 1500 matches the native version-history request.
  readonly revisionBatchSize?: number;
  // `/document/` vs `/spreadsheets/` path prefix; defaults to "doc".
  readonly kind?: DocumentKind;
}

/**
 * Build the `revisions/tiles` URL whose `)]}'`-framed `{ tileInfo, userMap, firstRev }`
 * body maps changelog author tokens to real display names (reverse-engineered live
 * 2026-06-18). The `token` + `ouid` are mandatory — without them the endpoint returns
 * an HTTP 400 HTML error page rather than JSON. Used on the real-identities path (default-on with opt-out).
 */
export function buildRevisionsTilesUrl(params: RevisionsTilesParams): string {
  if (params.userIndex !== null && (!Number.isInteger(params.userIndex) || params.userIndex < 0)) {
    throw new TypeError("buildRevisionsTilesUrl: userIndex must be a non-negative integer or null");
  }
  const userSegment = params.userIndex !== null ? `/u/${params.userIndex}` : "";
  const prefix = pathPrefixForKind(params.kind ?? "doc");
  const query = new URLSearchParams({
    id: params.docId,
    start: "1",
    revisionBatchSize: String(params.revisionBatchSize ?? 1500),
    showDetailedRevisions: "false",
    loadType: "0",
    token: params.token,
    ouid: params.ouid,
    includes_info_params: "true",
    cros_files: "false",
    nded: "false",
  });
  return `${DOCS_ORIGIN}/${prefix}${userSegment}/d/${params.docId}/revisions/tiles?${query.toString()}`;
}

/**
 * A Google Docs page surface that embeds the `"info_params":{token,ouid}` bootstrap the
 * `revisions/tiles` harvest needs. The three differ ONLY in the access they require, so the
 * harvest can fall back across them when a credentialed read of one is blocked:
 *   • `edit`    — the editor bootstrap (the default; an author reading their own doc).
 *   • `grading` — the surface Google Classroom authorizes an educator to read a *turned-in*
 *                 student submission through. A direct `/edit` can be access-blocked for such a
 *                 doc (the educator was granted access via the grading context, not as an editor),
 *                 yet `/grading` — and `revisions/load`/`revisions/tiles` — still resolve.
 *   • `view`    — the read-only viewer bootstrap (a commenter/viewer grant).
 * All three were LIVE-CONFIRMED 2026-06-19 to carry both `token` and `ouid` for the same doc.
 */
export type DocBootstrapSurface = "edit" | "grading" | "view";

/**
 * Ordered identity-token sources for the tiles harvest: try `edit` first (the common case — one
 * fetch, behaviour unchanged), then the access-aligned fallbacks. A surface that 4xx's or yields
 * no token is skipped to the next; the first that yields `info_params` wins. Ordered so a normal
 * doc never incurs a second request.
 */
export const IDENTITY_BOOTSTRAP_SURFACES: readonly DocBootstrapSurface[] = [
  "edit",
  "grading",
  "view",
];

/**
 * Build a Google Docs page URL for one bootstrap-bearing {@link DocBootstrapSurface}
 * (A.5 multi-account aware — the `/document/u/{N}/d/` slot is included when `userIndex` is set).
 * Used by discovery (reads `"revision":N` off `/edit`) and the identity harvest (reads the
 * `info_params` token+ouid, falling back across surfaces — see {@link IDENTITY_BOOTSTRAP_SURFACES}).
 */
export function buildDocBootstrapUrl(
  docId: DocId,
  userIndex: number | null,
  surface: DocBootstrapSurface,
  kind: DocumentKind = "doc",
): string {
  if (userIndex !== null && (!Number.isInteger(userIndex) || userIndex < 0)) {
    throw new TypeError("buildDocBootstrapUrl: userIndex must be a non-negative integer or null");
  }
  const userSegment = userIndex !== null ? `/u/${userIndex}` : "";
  return `${DOCS_ORIGIN}/${pathPrefixForKind(kind)}${userSegment}/d/${docId}/${surface}`;
}

// Extracts the multi-account slot from a `/document/u/{N}/d/`,
// `/spreadsheets/u/{N}/d/` or `/presentation/u/{N}/d/` path segment (A.5).
const USER_INDEX_PATTERN = /\/(?:document|spreadsheets|presentation)\/u\/(\d+)\/d\//;

/**
 * Detect the multi-account account slot in a Google URL, or null when none is present.
 *
 * Two shapes carry the slot:
 *   1. The Docs `/document/u/{N}/d/` PATH segment (A.5; LIVE-CONFIRMED §24 Q8,
 *      2026-06-12 — a real `/document/u/1/d/` URL yields `1` and reads 200 JSON).
 *   2. The `authuser={N}` QUERY param. Google Classroom embeds a student's doc as
 *      `…/document/d/{id}/grading?authuser={N}` (LIVE-CONFIRMED 2026-06-19, educator
 *      grading view), and some Docs deep links select the account this way too.
 *
 * The path form wins when both appear (it is the more specific slot). The path is
 * matched against the pathname ONLY, so a `/document/u/{N}/d/` buried in a query or
 * fragment can't masquerade as the slot; the query form is read via `searchParams`,
 * which likewise can't be spoofed by path content.
 */
export function detectUserIndex(url: string): number | null {
  let parsed: URL | null;
  try {
    parsed = new URL(url);
  } catch {
    // Relative/path-only inputs: resolve against the Docs origin so the WHATWG parser
    // still isolates pathname + query (the base host is irrelevant — only the path and
    // `authuser` are read). Truly unparseable input falls back to a raw path match.
    try {
      parsed = new URL(url, DOCS_ORIGIN);
    } catch {
      parsed = null;
    }
  }
  const pathname = parsed ? parsed.pathname : url;
  const pathMatch = USER_INDEX_PATTERN.exec(pathname);
  if (pathMatch?.[1] !== undefined) {
    return Number.parseInt(pathMatch[1], 10);
  }
  const authuser = parsed?.searchParams.get("authuser");
  if (authuser !== null && authuser !== undefined && /^\d+$/.test(authuser)) {
    return Number.parseInt(authuser, 10);
  }
  return null;
}
