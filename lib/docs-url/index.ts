// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Docs/Sheets/Slides-URL parsing (plan §1.6 / A.5). PURE: extracts the branded
// `DocId` and the multi-account slot from a `/document/d/{id}/`, `/spreadsheets/d/{id}/`
// OR `/presentation/d/{id}/` path (also their `/u/{N}/` multi-account variants),
// and tags the document `kind`. Matches against the pathname only so a `/d/` or
// `/u/N/` embedded in a query or fragment can't spoof detection. No browser /
// fetch / Worker here.

import { asDocId, type DocId } from "../domain/ids";
import type { DocumentKind } from "../domain/kind";
import { detectUserIndex } from "../protocol/endpoints";

/** A parsed Docs/Sheets URL: the document id, its multi-account slot, and kind (A.5). */
export interface DocsUrlInfo {
  readonly docId: DocId;
  readonly userIndex: number | null;
  readonly kind: DocumentKind;
}

// The `/document/d/{id}`, `/spreadsheets/d/{id}` or `/presentation/d/{id}` segment
// (with an optional `/u/{N}/` multi-account slot); group 1 is the kind prefix,
// group 2 the id (then validated by `asDocId`).
const DOC_ID_PATH = /\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([^/]+)/;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // Relative/path-only inputs throw in `new URL` (no base): re-parse against the
    // Docs origin so the WHATWG parser still isolates the pathname (dropping any
    // query/fragment), preserving the pathname-only guarantee for these inputs.
    try {
      return new URL(url, "https://docs.google.com").pathname;
    } catch {
      return url;
    }
  }
}

/** The raw id segment + document kind, or null when the path matches no known shape. */
function matchDocument(url: string): { raw: string; kind: DocumentKind } | null {
  const match = DOC_ID_PATH.exec(pathOf(url));
  const raw = match?.[2];
  if (raw === undefined) return null;
  const prefix = match?.[1];
  const kind: DocumentKind =
    prefix === "spreadsheets" ? "sheet" : prefix === "presentation" ? "slides" : "doc";
  return { raw, kind };
}

/**
 * Extract the branded {@link DocId} from a Docs/Sheets URL, or `null` when the
 * URL is not a recognizable document/spreadsheet page or the id fails validation.
 */
export function extractDocId(url: string): DocId | null {
  const match = matchDocument(url);
  if (match === null) return null;
  try {
    return asDocId(match.raw);
  } catch {
    return null;
  }
}

/**
 * Parse a Docs/Sheets URL into its {@link DocsUrlInfo}, or `null` when it isn't a
 * recognizable Google document/spreadsheet URL.
 */
export function parseDocsUrl(url: string): DocsUrlInfo | null {
  const match = matchDocument(url);
  if (match === null) return null;
  let docId: DocId;
  try {
    docId = asDocId(match.raw);
  } catch {
    return null;
  }
  return { docId, userIndex: detectUserIndex(url), kind: match.kind };
}
