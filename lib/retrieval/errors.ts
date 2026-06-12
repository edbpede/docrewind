// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Retrieval error taxonomy (plan §1.4 / PRD §10.7). A privacy-safe, exhaustive
// classification of every way retrieval can fail. Errors carry ONLY a category,
// a user-facing message, a recoverability flag, and a suggested action — NEVER a
// raw response body or any document fragment (PRD §13.7). This module is pure:
// no network I/O, no Web Worker, and no extension-API access (purity-guarded).

/** The closed set of retrieval failure categories (PRD §10.7). */
export type RetrievalErrorCategory =
  | "unsupported-page"
  | "missing-doc-id"
  | "insufficient-permission"
  | "endpoint-unavailable"
  | "unsupported-format"
  | "network-failure"
  | "quota-failure"
  | "reconstruction-failure"
  | "cancellation";

/**
 * A classified retrieval failure. Plain, structured-cloneable data so it can
 * cross the messaging boundary to the UI. Deliberately content-free.
 */
export interface RetrievalError {
  readonly category: RetrievalErrorCategory;
  readonly userMessage: string;
  readonly recoverable: boolean;
  readonly suggestedAction: string;
}

/**
 * Map a category to its full {@link RetrievalError} descriptor. The `never`
 * default makes this an exhaustiveness gate: adding a category without an arm
 * here is a compile error.
 */
export function retrievalError(category: RetrievalErrorCategory): RetrievalError {
  switch (category) {
    case "unsupported-page":
      return {
        category,
        userMessage: "This page isn't a Google Docs document, so there's nothing to replay.",
        recoverable: false,
        suggestedAction: "Open a Google Docs document and try again.",
      };
    case "missing-doc-id":
      return {
        category,
        userMessage: "DocRewind couldn't read this document's id from the page.",
        recoverable: false,
        suggestedAction: "Reload the document page and try again.",
      };
    case "insufficient-permission":
      return {
        category,
        userMessage: "You don't appear to have access to this document's revision history.",
        recoverable: false,
        suggestedAction: "Sign in with an account that can edit the document.",
      };
    case "endpoint-unavailable":
      return {
        category,
        userMessage: "Revision retrieval is currently unavailable.",
        recoverable: true,
        suggestedAction: "Try again later.",
      };
    case "unsupported-format":
      return {
        category,
        userMessage:
          "DocRewind didn't recognize the revision data format and stopped to stay safe.",
        recoverable: false,
        suggestedAction: "Report this document so support for its format can be added.",
      };
    case "network-failure":
      return {
        category,
        userMessage: "A network problem interrupted retrieval.",
        recoverable: true,
        suggestedAction: "Check your connection and try again.",
      };
    case "quota-failure":
      return {
        category,
        userMessage: "There isn't enough local storage to hold this document's history.",
        recoverable: true,
        suggestedAction: "Clear cached documents in settings and try again.",
      };
    case "reconstruction-failure":
      return {
        category,
        userMessage: "DocRewind couldn't reconstruct this document from its revisions.",
        recoverable: false,
        suggestedAction: "Report this document so the issue can be investigated.",
      };
    case "cancellation":
      return {
        category,
        userMessage: "Retrieval was cancelled.",
        recoverable: true,
        suggestedAction: "Start retrieval again whenever you're ready.",
      };
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

/**
 * Narrow an unknown thrown value to a {@link RetrievalError}. Lets a thrown
 * classified error cross a `catch` boundary without being flattened — the only
 * property that distinguishes it is a `category` from the closed set.
 */
export function isRetrievalError(value: unknown): value is RetrievalError {
  if (typeof value !== "object" || value === null) return false;
  const category = (value as { category?: unknown }).category;
  return (
    category === "unsupported-page" ||
    category === "missing-doc-id" ||
    category === "insufficient-permission" ||
    category === "endpoint-unavailable" ||
    category === "unsupported-format" ||
    category === "network-failure" ||
    category === "quota-failure" ||
    category === "reconstruction-failure" ||
    category === "cancellation"
  );
}

// --- Result helper ----------------------------------------------------------
// A tiny Result type so the orchestrator can return a typed success/failure
// without throwing across the async chunk loop.

/** Success or a classified failure. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Wrap a success value. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap a failure value. */
export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
