// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Docs-URL parsing (plan §1.6 / A.5). PURE: extracts the branded `DocId` from a
// `/document/d/{id}/` or `/document/u/{N}/d/{id}/` path and the multi-account slot from a Google
// Docs URL. Matches against the pathname only so a `/d/` or `/u/N/` embedded in a
// query or fragment can't spoof detection. No browser / fetch / Worker here.

import { asDocId, type DocId } from "../domain/ids";
import { detectUserIndex } from "../protocol/endpoints";

/** A parsed Docs URL: the document id plus its multi-account slot (A.5). */
export interface DocsUrlInfo {
  readonly docId: DocId;
  readonly userIndex: number | null;
}

// The `/document/d/{id}` or `/document/u/{N}/d/{id}` segment; `{id}` is then validated by `asDocId`.
const DOC_ID_PATH = /\/document\/(?:u\/\d+\/)?d\/([^/]+)/;

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

/**
 * Extract the branded {@link DocId} from a Docs URL, or `null` when the URL is
 * not a Docs document page or the id fails validation.
 */
export function extractDocId(url: string): DocId | null {
  const match = DOC_ID_PATH.exec(pathOf(url));
  const raw = match?.[1];
  if (raw === undefined) return null;
  try {
    return asDocId(raw);
  } catch {
    return null;
  }
}

/**
 * Parse a Docs URL into its {@link DocsUrlInfo}, or `null` when it isn't a
 * recognizable Google Docs document URL.
 */
export function parseDocsUrl(url: string): DocsUrlInfo | null {
  const docId = extractDocId(url);
  if (docId === null) return null;
  return { docId, userIndex: detectUserIndex(url) };
}
