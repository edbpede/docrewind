// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Branded identifier types + validating smart constructors (plan T1 / R8).
//
// Branding here is *safety*, not decoration: each `as*` constructor validates
// the id shape and throws on malformed input, so a malformed id can never flow
// into the pure core unnoticed. Where a value crosses a genuinely trusted
// internal boundary (already validated upstream), the matching `unsafeAs*`
// blind-cast is permitted with a one-line rationale — never a silent `as`.

/** Google Docs document id (the `/d/{docId}/` path segment). */
export type DocId = string & { readonly __brand: "DocId" };
/** Fine-grained revision number (1-indexed, monotonically increasing). */
export type RevisionId = number & { readonly __brand: "RevisionId" };
/** Editing-session id grouping a run of revisions by one author. */
export type SessionId = string & { readonly __brand: "SessionId" };
/** Opaque per-document author id (never a real-world identity). */
export type UserId = string & { readonly __brand: "UserId" };

// Google document ids are URL-safe base64-ish tokens: letters, digits, `_`, `-`.
const DOC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Validate and brand a document id. Throws on empty / non-`[A-Za-z0-9_-]`. */
export function asDocId(value: string): DocId {
  if (value.length === 0 || !DOC_ID_PATTERN.test(value)) {
    throw new TypeError("asDocId: expected a non-empty [A-Za-z0-9_-] string");
  }
  return value as DocId;
}

/** Validate and brand a revision number. Throws on non-integer / non-positive. */
export function asRevisionId(value: number): RevisionId {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("asRevisionId: expected a positive integer");
  }
  return value as RevisionId;
}

/** Validate and brand a session id. Throws on empty / whitespace-only. */
export function asSessionId(value: string): SessionId {
  if (value.trim().length === 0) {
    throw new TypeError("asSessionId: expected a non-empty string");
  }
  return value as SessionId;
}

/** Validate and brand a user id. Throws on empty / whitespace-only. */
export function asUserId(value: string): UserId {
  if (value.trim().length === 0) {
    throw new TypeError("asUserId: expected a non-empty string");
  }
  return value as UserId;
}

// --- Trusted-boundary blind casts -------------------------------------------
// These skip validation by design; use ONLY for values already validated
// upstream (e.g. a RevisionId derived inside reconstruction from an id the
// decoder already branded). Each call site should justify why revalidation is
// redundant. They keep validation pressure off hot loops without scattering
// raw `as Brand` casts through the codebase.

/** Blind-cast: caller guarantees `value` is an already-validated doc id. */
export function unsafeAsDocId(value: string): DocId {
  return value as DocId;
}

/** Blind-cast: caller guarantees `value` is an already-validated revision number. */
export function unsafeAsRevisionId(value: number): RevisionId {
  return value as RevisionId;
}

/** Blind-cast: caller guarantees `value` is an already-validated session id. */
export function unsafeAsSessionId(value: string): SessionId {
  return value as SessionId;
}

/** Blind-cast: caller guarantees `value` is an already-validated user id. */
export function unsafeAsUserId(value: string): UserId {
  return value as UserId;
}

/**
 * The synthetic pre-history revision id (0). It marks the EndOfBody sentinel and
 * any base/template content that predates the fetched changelog window (seeded
 * from a `chunkedSnapshot`). It is NEVER a real wire RevisionId — `asRevisionId`
 * rejects 0 — so the blind cast is intentional and unique to this sentinel. Lives
 * in the shared id layer so both the decoder and the reconstruction core can name
 * the same "before history began" id without crossing module boundaries.
 */
export const PRE_HISTORY_REVISION: RevisionId = unsafeAsRevisionId(0);
