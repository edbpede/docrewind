// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The document-kind discriminator (plan §1 Chosen-option). It lives at the
// BOUNDARY types — URL info, endpoint builders, publication, replay data,
// messaging — and NEVER inside a core's op union or model: each core stays
// closed-world over its own grammar, while the kind tag routes which core /
// transport prefix / viewport a given document uses.
//
// PURE: a single string-literal union, no runtime, no imports.

/** Which Google editor a captured document belongs to. */
export type DocumentKind = "doc" | "sheet";

/** Runtime guard for the untyped boundaries (worker/messaging) the tag crosses. */
export function isDocumentKind(value: unknown): value is DocumentKind {
  return value === "doc" || value === "sheet";
}

/** The URL path prefix Google uses for each kind (`/document/` vs `/spreadsheets/`). */
export function pathPrefixForKind(kind: DocumentKind): "document" | "spreadsheets" {
  return kind === "sheet" ? "spreadsheets" : "document";
}
